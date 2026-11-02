// Text colour pairs in app/theme.css must meet WCAG AA (4.5:1). Usage: node scripts/check-contrast.mjs [dir].
// Exits 1 and names each failing pair. Token values must be 3- or 6-digit hex (what theme.css uses).
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const PAIRS = [
  ["fg", "bg"],
  ["fg", "surface"],
  ["muted", "bg"],
  ["muted", "surface"],
  ["accent-fg", "accent"],
  ["danger", "bg"],
  ["danger", "surface"],
];
const MIN = 4.5;

const channel = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
export function luminance(hex) {
  let h = hex.replace(/^#/u, "");
  if (h.length === 3) h = [...h].map((c) => c + c).join("");
  const [r, g, b] = [0, 2, 4].map((i) => channel(Number.parseInt(h.slice(i, i + 2), 16) / 255));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
export function contrast(a, b) {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function failures(css) {
  const tokens = Object.fromEntries(
    [...css.matchAll(/--color-([\w-]+)\s*:\s*([^;]+);/gu)].map(([, name, value]) => [
      name,
      value.trim(),
    ]),
  );
  const out = [];
  for (const [fg, bg] of PAIRS) {
    const [a, b] = [tokens[fg], tokens[bg]];
    if (![a, b].every((v) => /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/iu.test(v ?? ""))) {
      out.push(`${fg} on ${bg}: both must be hex colours in app/theme.css (got ${a}, ${b})`);
    } else if (contrast(a, b) < MIN) {
      out.push(`${fg} (${a}) on ${bg} (${b}): ${contrast(a, b).toFixed(2)}:1, below AA ${MIN}:1`);
    }
  }
  return out;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = path.resolve(process.argv[2] ?? ".");
  const found = failures(await readFile(path.join(root, "app/theme.css"), "utf8"));
  for (const line of found) console.log(`app/theme.css: ${line}`);
  if (found.length > 0) process.exit(1);
}
