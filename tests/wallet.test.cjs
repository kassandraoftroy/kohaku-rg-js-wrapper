const assert = require("node:assert/strict");
const { after, test } = require("node:test");
const {
  RailgunWallet,
  buildShieldCalls,
  chainConfig,
  deriveRailgunAddress,
  railgunKeyPaths,
} = require("../dist/index.js");

const originalFetch = globalThis.fetch;
after(() => { globalThis.fetch = originalFetch; });

globalThis.fetch = async (input, init) => {
  const request = JSON.parse(input instanceof Request ? await input.text() : init.body);
  assert.equal(request.method, "eth_chainId");
  const response = new Response(JSON.stringify({ jsonrpc: "2.0", id: request.id, result: "0xaa36a7" }), {
    status: 200,
    headers: { "content-type": "application/json" },
  });
  Object.defineProperty(response, "url", { value: input.url ?? String(input) });
  return response;
};

const spendingKey = `0x${"01".repeat(32)}`;
const viewingKey = `0x${"02".repeat(32)}`;
const expectedAddress = "0zk1qys4xfe9ucy0266kyfzdv8h322y282elqxmhjpvxl8ksctnm4f4jjunpd9kx0h6c57qnjacw4p73wh6k5d2xds6v0mxvhrv2jx6wudazthmq7ku0exeeg4uye6h";

test("pinned WASM derives the same address and paths as the old CLI wallet", () => {
  assert.deepEqual(railgunKeyPaths(), {
    spending: "m/44'/1984'/0'/0'/0'",
    viewing: "m/420'/1984'/0'/0'/0'",
  });
  assert.equal(deriveRailgunAddress(spendingKey, viewingKey, 11155111n), expectedAddress);
  const chain = chainConfig(11155111n);
  assert.equal(chain.chainId, 11155111n);
  assert.match(chain.wrappedBaseToken, /^0x[0-9a-fA-F]{40}$/);
});

test("session checkpoint survives reload and PPOI processing persists it", async () => {
  const saved = [];
  const options = {
    chainId: 11155111n,
    rpcUrl: "https://rpc.example.invalid",
    spendingKey,
    viewingKey,
    persistCheckpoint: async (value) => { saved.push(value); },
  };
  const wallet = await RailgunWallet.open(options);
  try {
    assert.equal(wallet.address, expectedAddress);
    assert.equal(wallet.syncedBlock, 0n);
    assert.deepEqual(await wallet.balances(), []);
    assert.deepEqual(wallet.pendingPoi(), []);
    const report = await wallet.processPendingPoi();
    assert.deepEqual(report, {
      pendingBefore: 0,
      submitted: [],
      waitingForTxid: [],
      waitingForInputPoi: [],
      failed: [],
      pendingAfter: 0,
    });
    assert.equal(saved.length, 1);
    assert.equal(saved[0], wallet.checkpointJson());
    const restored = await RailgunWallet.open({ ...options, checkpointJson: saved[0] });
    try {
      assert.equal(restored.address, expectedAddress);
      assert.deepEqual(JSON.parse(restored.checkpointJson()), JSON.parse(saved[0]));
    } finally { restored.close(); }
  } finally { wallet.close(); }
});

test("shield preparation returns native and ERC-20 calls without a sync", () => {
  const calls = buildShieldCalls(11155111n, expectedAddress, [
    { kind: "native", amount: 1000000000000000n },
    { kind: "erc20", token: "0x0000000000000000000000000000000000000001", amount: 42n },
  ]);
  assert.equal(calls.length, 2);
  assert.deepEqual(calls.map((call) => call.value).sort((a, b) => Number(a - b)), [0n, 1000000000000000n]);
  assert.ok(calls.every((call) => /^0x/.test(call.data)));
});
