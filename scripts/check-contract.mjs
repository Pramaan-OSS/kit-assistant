import { execFile } from "node:child_process";
import { cp, mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import { createRequire, registerHooks } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { promisify } from "node:util";

const require = createRequire(import.meta.url);
const platform = process.env.PRODUCT_LOOP_ROOT ?? path.resolve("../../../..", "product-loop");
registerHooks({
  resolve(specifier, context, nextResolve) {
    try {
      return nextResolve(specifier, context);
    } catch (error) {
      if (
        !specifier.startsWith(".") &&
        !specifier.startsWith("/") &&
        error.code === "ERR_MODULE_NOT_FOUND"
      )
        return { url: pathToFileURL(require.resolve(specifier)).href, shortCircuit: true };
      throw error;
    }
  },
});
const { loadKit } = await import(pathToFileURL(path.join(platform, "lib/builder/kits.mjs")));
const { readStarter, kitContractGate, kitLicenceGate, kitSecretsGate, installedLicencesGate } =
  await import(pathToFileURL(path.join(platform, "lib/builder/kit-ci.mjs")));
const root = path.resolve(".evidence/contract");
const dir = path.join(root, "assistant");
await rm(dir, { recursive: true, force: true });
await mkdir(dir, { recursive: true });
for (const name of await readdir(".")) {
  if (name.startsWith(".") || name === "node_modules" || name === "next-env.d.ts") continue;
  await cp(name, path.join(dir, name), { recursive: true });
}
for (const name of [".npmrc", ".gitignore"]) await cp(name, path.join(dir, name));
const kit = await loadKit("assistant", { root });
console.log(`digest: ${kit.digest}`);
const run = promisify(execFile);
const commit = kit.manifest.provenance.starter.split("@")[1];
const git = async (args) => {
  try {
    const result = await run("git", ["-C", platform, ...args], { maxBuffer: 16 * 1024 * 1024 });
    return { exitCode: 0, stdout: result.stdout };
  } catch (error) {
    return { exitCode: error.code ?? 1, stdout: error.stdout ?? "" };
  }
};
const starter = await readStarter({ repoRoot: platform, commit, git });
const gates = [
  await kitContractGate(kit, { starter }),
  await kitLicenceGate(kit, {
    commitExists: async (sha) => (await git(["cat-file", "-e", `${sha}^{commit}`])).exitCode === 0,
  }),
  await kitSecretsGate(kit),
  await installedLicencesGate({
    treeDir: process.cwd(),
    kitLock: await readFile("pnpm-lock.yaml", "utf8"),
    starterLock: await starter.at("pnpm-lock.yaml"),
  }),
];
await writeFile(".evidence/contract.json", JSON.stringify(gates, null, 2));
for (const gate of gates) console.log(`${gate.id}: ${gate.ok ? "passed" : gate.evidence}`);
if (gates.some((g) => !g.ok)) process.exitCode = 1;
