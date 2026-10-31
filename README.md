# kohaku-rg-js-wrapper

Node 22+ bindings for the Railgun crates in
[`ethereum/kohaku-rs@8db5f351f7ec27c5e202d1b62e50bb266eb65855`](https://github.com/ethereum/kohaku-rs/commit/8db5f351f7ec27c5e202d1b62e50bb266eb65855).
The npm package includes release-mode Node WASM and generated declarations. A
consumer does not need Rust, Cargo, or `wasm-bindgen` installed.

This package owns the JavaScript boundary around the Rust wallet. The consumer
owns mnemonic key derivation, encrypted checkpoint storage, RPC and Tor routing,
ERC-20 shield approvals, transaction submission, and user-facing progress.

## Open and sync a wallet

```ts
import {
  RailgunWallet,
  railgunKeyPaths,
  sendUserOperation,
  waitForUserOperationReceipt,
} from "kohaku-rg-js-wrapper";

const paths = railgunKeyPaths(0);
const spendingKey = await keystore.deriveAt(paths.spending);
const viewingKey = await keystore.deriveAt(paths.viewing);

const wallet = await RailgunWallet.open({
  chainId: 11155111n,
  rpcUrl,
  spendingKey,
  viewingKey,
  checkpointJson: await encryptedStore.readNewRailgunCheckpoint(),
  artifactBaseUrl: circuitBaseUrl,
  persistCheckpoint: (json) => encryptedStore.saveNewRailgunCheckpoint(json),
});

try {
  await wallet.syncTo(nextBlock); // Repeat in bounded windows for first resync.
  console.log(await wallet.balances());
  console.log(wallet.pendingPoi());
  const report = await wallet.processPendingPoi();
  console.log(report);
  await wallet.sync(); // Observe PPOI list inclusion after submissions.
} finally {
  wallet.close();
}
```

`checkpointJson` is the new Rust format. Existing CLI `rg-storage.json` must be
left intact and rebuilt into a separate encrypted checkpoint. A fresh wallet
can omit `checkpointJson` and sync from chain history. The persistence callback
is required and is awaited after sync, PPOI processing, and private operation
preparation; failed operations also save any coherent partial state. The
checkpoint contains private note material. Encrypt it at rest and never log it.

Sync fetches UTXOs, TXIDs, and PPOI lists and queues recoverable missing
historical proofs. `processPendingPoi()` sends queued proofs and reports
`submitted`, `waitingForTxid`, `waitingForInputPoi`, `failed`, and remaining
entries. **Submitted is not Valid.** Only later PPOI list inclusion establishes
`Valid`; the Rust wallet refuses to spend missing or unavailable notes. A
blocked shield cannot be turned into a valid proof by retrying.

## Shields and private spends

`buildShieldCalls(chainId, recipient, entries)` returns core-generated
transaction calls. Add ERC-20 approvals as needed and submit them through the
consumer's wallet. The core can reorder shield calls; use its returned order.

```ts
const prepared = await wallet.prepareUnshield({
  recipient: accountAddress,
  token: wallet.chain.wrappedBaseToken,
  amount: 1000000000000000n,
  unwrapNative: true,
  tailCalls: [{ target: destination, value: 1000000000000000n, data: "0x" }],
  accountPrivateKey,
  bundlerUrl,
});

// Journal prepared.userOpHash and the signed payload before sending.
const transport = { url: bundlerUrl, fetch: torAwareFetch };
await sendUserOperation(prepared, transport);
const receipt = await waitForUserOperationReceipt(prepared.userOpHash, transport);
if (!receipt.success) throw new Error("Railgun UserOperation reverted");
await wallet.sync();
```

`prepareTransfer` accepts a Railgun recipient, ERC-20 token, amount, memo, and
the account key and bundler URL. Both private spend methods use PPOI-valid
inputs and prepare signed EIP-7702 paymaster UserOperations in Rust. The fee
token is WETH. Unshield takes the desired received amount, adds the treasury
fee, and executes calls in this order: Railgun unshield, optional WETH
withdrawal, then user tail calls. Native unshield and tail calls require the
recipient to be the signing account. The bundler must support state overrides
for `eth_estimateUserOperationGas`.

`sendUserOperation` accepts an injected `fetch` and verifies the bundler's hash
against Rust's hash. An ambiguous send error carries `userOpHash`; check its
receipt before resubmitting. The consumer should also persist an operation
journal before send, so the exact signed payload survives a crash.

## Network and circuits

The Rust WASM layer uses the runtime's `globalThis.fetch` for its own RPC,
Subsquid, PPOI, bundler estimation, and artifact requests. Install the
consumer's Tor-aware fetch routing before opening or syncing a wallet. The
wrapper does not replace global fetch or assume the CLI's artifact mirror.
Pass `artifactBaseUrl` when a consumer hosts or maps the pinned circuits; the
Rust default points at its pinned artifact source. The provided fetch adapter
for `sendUserOperation` and receipt polling should use the same privacy route.

## Build and publish

The checked-in `vendor/wasm` files were built from the exact commit named in
`provenance.json`, using `cargo build --locked --release` for
`wasm32-unknown-unknown` and `wasm-bindgen 0.2.108 --target nodejs`. To
rebuild, install the Rust WASM target and matching `wasm-bindgen`, then run
`npm run build:wasm`. Set `KOHAKU_RS_DIR` to an unmodified checkout at the
pinned commit to avoid a clone, and `WASM_BINDGEN_BIN` if needed. The script
refuses a different or dirty Rust revision and updates the recorded checksums.

Run `npm ci`, `npm run build`, `npm test`, and `npm pack --dry-run` before
publishing. `prepack` repeats the build, tests, and provenance checksum check.
The package currently uses version `0.0.1`; publish only after the repository
and npm ownership are configured.
