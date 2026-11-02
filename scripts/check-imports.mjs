// Local imports have no extension: `./calc`, never `./calc.js`. next build rejects them.
// Usage: node scripts/check-imports.mjs [dir]. Exits 1 and names each one.
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

const SKIP = new Set(["node_modules", "product"]);
const SOURCE = /\.(?:ts|tsx|mts|cts)$/u;
const LOCAL_IMPORT = [
  /^\s*(?:(?:import|export)\b[^"'\n]*\bfrom|\}\s*from|import)\s*["'](\.{1,2}\/[^"'\n]*\.[cm]?jsx?)["']/gu,
  /\b(?:import|require)\s*\(\s*["'](\.{1,2}\/[^"'\n]*\.[cm]?jsx?)["']/gu,
];

async function* sources(root, dir = "") {
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    if (entry.name.startsWith(".") || SKIP.has(entry.name)) continue;
    const file = dir === "" ? entry.name : `${dir}/${entry.name}`;
    if (entry.isDirectory()) yield* sources(root, file);
    // Declaration files (next-env.d.ts, written by next build) are not app code.
    else if (SOURCE.test(entry.name) && !entry.name.endsWith(".d.ts")) yield file;
  }
}

const root = path.resolve(process.argv[2] ?? ".");
const found = [];
for await (const file of sources(root)) {
  const lines = (await readFile(path.join(root, file), "utf8")).split("\n");
  lines.forEach((line, index) => {
    if (/^\s*(?:\/\/|\/?\*)/u.test(line)) return;
    for (const pattern of LOCAL_IMPORT) {
      for (const match of line.matchAll(pattern)) {
        found.push(`${file}:${index + 1} imports "${match[1]}"`);
      }
    }
  });
}
if (found.length > 0) {
  console.error("Local imports must have no extension (`./calc`, not `./calc.js`):");
  for (const line of found) console.error(`  ${line}`);
  process.exit(1);
}
console.log("check-imports: ok");
