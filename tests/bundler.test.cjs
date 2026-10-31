const assert = require("node:assert/strict");
const { test } = require("node:test");
const {
  BundlerSubmissionError,
  getUserOperationReceipt,
  sendUserOperation,
} = require("../dist/index.js");

const hash = `0x${"ab".repeat(32)}`;
const prepared = {
  signed: { userOp: { sender: "0x0000000000000000000000000000000000000001" }, entryPoint: "0x0000000000000000000000000000000000000002" },
  userOpHash: hash,
};

test("broadcast sends the Rust wire operation and checks the returned hash", async () => {
  const methods = [];
  const transport = {
    url: "https://bundler.example.invalid",
    fetch: async (_url, init) => {
      const request = JSON.parse(init.body);
      methods.push(request.method);
      if (request.method === "eth_sendUserOperation") {
        assert.deepEqual(request.params, [prepared.signed.userOp, prepared.signed.entryPoint]);
      }
      const result = request.method === "eth_sendUserOperation"
        ? hash
        : { userOpHash: hash, success: true, receipt: { transactionHash: hash } };
      return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    },
  };
  assert.equal(await sendUserOperation(prepared, transport), hash);
  assert.equal((await getUserOperationReceipt(hash, transport)).success, true);
  assert.deepEqual(methods, ["eth_sendUserOperation", "eth_getUserOperationReceipt"]);
});

test("ambiguous bundler send failure retains the hash needed for receipt polling", async () => {
  await assert.rejects(
    sendUserOperation(prepared, { url: "https://bundler.example.invalid", fetch: async () => { throw new Error("timeout"); } }),
    (error) => error instanceof BundlerSubmissionError && error.userOpHash === hash,
  );
});

test("receipt lookup rejects a different UserOperation hash", async () => {
  const transport = {
    url: "https://bundler.example.invalid",
    fetch: async () => new Response(JSON.stringify({
      jsonrpc: "2.0", id: 1,
      result: { userOpHash: `0x${"cd".repeat(32)}`, success: true },
    }), { status: 200, headers: { "content-type": "application/json" } }),
  };
  await assert.rejects(getUserOperationReceipt(hash, transport), /does not match/);
});
