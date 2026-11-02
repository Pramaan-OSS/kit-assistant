// Writes app/theme.css from the tokens in DESIGN.md (Google's DESIGN.md format), through the pinned
// `@google/design.md` CLI: its lint must pass (no errors, no WCAG AA contrast warnings), then its
// Tailwind v4 export is post-processed. Usage: node scripts/generate-theme.mjs [dir] [--check].
// Optional export: ordinary generate/lint never invokes this file. --check only checks export drift.
import { spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "yaml";

const CLI = fileURLToPath(import.meta.resolve("@google/design.md"));
const THEME = "app/theme.css";

function designmd(...args) {
  const result = spawnSync(process.execPath, [CLI, ...args], { encoding: "utf8" });
  if (result.error) throw result.error;
  return result;
}

/** The lint's blocking findings: any error (a broken token reference), and every contrast warning. */
export function lintFailures(file) {
  const result = designmd("lint", "--format", "json", file);
  const { findings } = JSON.parse(result.stdout);
  const out = findings
    .filter((f) => f.severity === "error" || f.rule === "contrast-ratio")
    .map((f) => `${f.path ?? "DESIGN.md"}: ${f.message} (${f.rule})`);
  if (result.status !== 0 && out.length === 0) out.push(`design.md lint exited ${result.status}`);
  return out;
}

const KEBAB = { backgroundColor: "background-color", textColor: "color", rounded: "border-radius" };
const NAMESPACE = { colors: "color", rounded: "radius", spacing: "spacing", shadows: "shadow" };

/** DESIGN.md's text to theme.css's. The export, fixed where it cannot be used as is in Tailwind v4. */
export function generate(file, source) {
  const exported = designmd("export", "--format", "css-tailwind", file);
  if (exported.status !== 0) throw new Error(`design.md export: ${exported.stderr}`);
  const tokens = parse(source.split(/^---$/mu)[1]);
  const typography = tokens.typography ?? {};
  // The export quotes each stack as one font name and gives every type token a family; keep
  // each distinct stack once, under the first token that has it (`font-sans`, `font-mono`).
  const families = new Map();
  for (const [name, type] of Object.entries(typography)) {
    if (!families.has(type.fontFamily)) families.set(type.fontFamily, name);
  }
  const familyOf = (type) => families.get(type.fontFamily);
  const theme = exported.stdout
    .split("\n")
    .filter((line) => /^\s+--/u.test(line))
    .flatMap((line) => {
      const [, name, value] = line.match(/^\s+--([\w-]+):\s*(.*);$/u);
      const font = name.match(/^font-(?!weight-)([\w-]+)$/u);
      // `font-<name>` cannot be both a family and a weight: weights become their own utilities.
      if (name.startsWith("font-weight-")) return [];
      if (font) {
        const type = typography[font[1]];
        return familyOf(type) === font[1] ? [`  --font-${font[1]}: ${JSON.parse(value)};`] : [];
      }
      return [`  --${name}: ${value};`];
    });

  const ref = (value) =>
    String(value).replace(/\{(\w+)\.([\w-]+)\}/gu, (whole, group, name) => {
      if (!NAMESPACE[group]) return whole;
      return `var(--${NAMESPACE[group]}-${name})`;
    });
  const utilities = [];
  for (const [name, type] of Object.entries(typography)) {
    utilities.push(`@utility weight-${name} {\n  font-weight: ${type.fontWeight};\n}`);
  }
  for (const [name, props] of Object.entries(tokens.components ?? {})) {
    const decls = Object.entries(props).flatMap(([prop, value]) => {
      if (prop === "typography") {
        const key = String(value).match(/^\{typography\.([\w-]+)\}$/u)?.[1];
        const type = typography[key];
        if (!type) throw new Error(`components.${name}.typography: ${value} is not a type token`);
        return [
          `font-family: var(--font-${familyOf(type)});`,
          `font-size: var(--text-${key});`,
          `font-weight: ${type.fontWeight};`,
        ];
      }
      if (prop === "borderColor") return [`border: 1px solid ${ref(value)};`];
      const css = KEBAB[prop] ?? prop.replace(/[A-Z]/gu, (letter) => `-${letter.toLowerCase()}`);
      if (css === null)
        throw new Error(`components.${name}.${prop}: not a property this generates`);
      return [`${css}: ${ref(value)};`];
    });
    utilities.push(`@utility ${name} {\n${decls.map((d) => `  ${d}`).join("\n")}\n}`);
  }

  const bodyClasses = [
    tokens.colors?.bg && "bg-bg",
    tokens.colors?.fg && "text-fg",
    typography.sans && "font-sans",
    "antialiased",
  ]
    .filter(Boolean)
    .join(" ");
  return (
    [
      "/* Generated from DESIGN.md by scripts/generate-theme.mjs (pnpm theme). Editable starting point. */",
      '@import "tailwindcss";',
      "",
      "@theme {",
      ...theme,
      "}",
      "",
      ...utilities.flatMap((u) => [u, ""]),
      "@layer base {",
      "  body {",
      `    @apply ${bodyClasses};`,
      "  }",
      "}",
      "",
    ].join("\n") +
    [...source.matchAll(/```css theme\n([\s\S]*?)\n```/gu)]
      .map(([, css]) => `\n/* Custom design CSS from DESIGN.md. */\n${css}\n`)
      .join("")
  );
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  const root = path.resolve(args.find((a) => !a.startsWith("--")) ?? ".");
  const file = path.join(root, "DESIGN.md");
  const failed = lintFailures(file);
  for (const line of failed) console.error(`DESIGN.md: ${line}`);
  if (failed.length > 0) process.exit(1);
  const css = generate(file, await readFile(file, "utf8"));
  const target = path.join(root, THEME);
  const current = await readFile(target, "utf8").catch(() => "");
  if (!args.includes("--check")) {
    // #795: the file is read-only in the verification cell; write only when the bytes differ.
    if (current !== css) await writeFile(target, css);
  } else if (current !== css) {
    console.error(
      `${THEME} differs from DESIGN.md: run \`pnpm theme\` to replace it with the token export.`,
    );
    process.exit(1);
  }
}
