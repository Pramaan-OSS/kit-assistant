import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const lock = JSON.parse(await readFile("blocks.lock.json", "utf8"));
const hashes = Object.assign({}, ...lock.blocks.map((block) => block.sourceHashes));
// The block files this kit keeps unchanged, byte for byte the published ones.
for (const [kept, source] of Object.entries(lock.kept))
  if (sha(await readFile(kept)) !== hashes[source])
    throw Error(`${kept}: not ${source} as published`);
// Every recorded hash against the published commit, when a checkout of the blocks repository holds it.
const root = process.env.OSS_BLOCKS_ROOT ?? path.resolve("../../blocks");
for (const block of lock.blocks) {
  if (!lock.adaptations[block.id]) throw Error(`${block.id}: missing adaptation notes`);
  for (const [file, expected] of Object.entries(block.sourceHashes)) {
    let bytes;
    try {
      bytes = execFileSync("git", ["-C", root, "show", `${block.sourceCommit}:${file}`], {
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      console.log(`${block.id}: ${block.sourceCommit} is not in ${root}; set OSS_BLOCKS_ROOT`);
      process.exitCode = 1;
      break;
    }
    if (sha(bytes) !== expected) throw Error(`${block.id}: source hash mismatch for ${file}`);
  }
}
console.log(
  `${Object.keys(lock.kept).length} kept block files match; ${lock.blocks.length} blocks checked.`,
);
