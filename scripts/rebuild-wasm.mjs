import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const commit = "8db5f351f7ec27c5e202d1b62e50bb266eb65855";
const source = process.env.KOHAKU_RS_DIR
  ? resolve(process.env.KOHAKU_RS_DIR)
  : join(root, ".cache", "kohaku-rs");
const vendor = join(root, "vendor", "wasm");
const target = join(root, ".cache", "cargo-target");
const bindgen = process.env.WASM_BINDGEN_BIN || "wasm-bindgen";

function run(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, stdio: "inherit", encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited ${result.status}`);
}

function output(command, args, cwd = root) {
  const result = spawnSync(command, args, { cwd, encoding: "utf8" });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(result.stderr || `${command} exited ${result.status}`);
  return result.stdout.trim();
}

mkdirSync(dirname(source), { recursive: true });
if (!existsSync(join(source, ".git"))) {
  if (process.env.KOHAKU_RS_DIR) throw new Error("KOHAKU_RS_DIR must be a Git checkout");
  run("git", ["clone", "--filter=blob:none", "--no-checkout", "https://github.com/ethereum/kohaku-rs.git", source]);
}
if (output("git", ["rev-parse", "HEAD"], source) !== commit) {
  if (process.env.KOHAKU_RS_DIR) throw new Error(`KOHAKU_RS_DIR must be at ${commit}`);
  run("git", ["fetch", "origin", commit], source);
  run("git", ["checkout", "--detach", commit], source);
}
if (output("git", ["status", "--porcelain"], source)) {
  throw new Error("Refusing to build from a modified kohaku-rs checkout");
}
mkdirSync(vendor, { recursive: true });
run("cargo", [
  "build", "--locked", "--release", "--manifest-path", join(source, "crates", "Cargo.toml"),
  "-p", "kohaku-railgun-wasm", "--target", "wasm32-unknown-unknown", "--target-dir", target,
]);
run(bindgen, [
  join(target, "wasm32-unknown-unknown", "release", "kohaku_railgun_wasm.wasm"),
  "--target", "nodejs", "--out-dir", vendor,
]);

const hash = (name) => createHash("sha256")
  .update(readFileSync(join(vendor, name))).digest("hex");
const metadata = {
  sourceRepository: "https://github.com/ethereum/kohaku-rs",
  sourceCommit: commit,
  crate: "kohaku-railgun-wasm",
  target: "wasm32-unknown-unknown",
  profile: "release",
  wasmBindgenVersion: output(bindgen, ["--version"]),
  wasmSha256: hash("kohaku_railgun_wasm_bg.wasm"),
  bindingsSha256: hash("kohaku_railgun_wasm.js"),
};
writeFileSync(join(root, "provenance.json"), `${JSON.stringify(metadata, null, 2)}\n`);
console.log(`Built Railgun WASM from ${commit}`);
