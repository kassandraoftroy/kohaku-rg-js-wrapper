import { createHash } from "node:crypto";
import { readFileSync, existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const meta = JSON.parse(readFileSync(join(root, "provenance.json"), "utf8"));
const expectedCommit = "8db5f351f7ec27c5e202d1b62e50bb266eb65855";
if (meta.sourceCommit !== expectedCommit || meta.profile !== "release") {
  throw new Error("WASM provenance does not name the pinned release source");
}
const hash = (file) => createHash("sha256").update(readFileSync(file)).digest("hex");
const vendor = join(root, "vendor", "wasm");
for (const [name, expected] of [
  ["kohaku_railgun_wasm_bg.wasm", meta.wasmSha256],
  ["kohaku_railgun_wasm.js", meta.bindingsSha256],
]) {
  if (hash(join(vendor, name)) !== expected) {
    throw new Error(`Pinned WASM provenance mismatch: ${name}`);
  }
}
for (const file of [
  "kohaku_railgun_wasm.d.ts",
  "kohaku_railgun_wasm_bg.wasm.d.ts",
]) {
  if (!existsSync(join(vendor, file))) throw new Error(`Missing generated file: ${file}`);
}
console.log(`Verified kohaku-rs ${expectedCommit.slice(0, 8)} WASM and bindings`);
