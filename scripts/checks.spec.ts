import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { compile } from "tailwindcss";
import { afterEach, describe, expect, it } from "vitest";

const dirs: string[] = [];

function tree(files: Record<string, string>): string {
  const dir = mkdtempSync(path.join(tmpdir(), "checks-"));
  dirs.push(dir);
  for (const [file, content] of Object.entries(files)) {
    mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    writeFileSync(path.join(dir, file), content);
  }
  return dir;
}

function check(script: string, dir: string) {
  const result = spawnSync(process.execPath, [path.join("scripts", script), dir], {
    encoding: "utf8",
  });
  return { status: result.status, output: `${result.stdout}${result.stderr}` };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("check-imports", () => {
  it("names a local import with an extension", () => {
    const result = check(
      "check-imports.mjs",
      tree({ "app/page.tsx": 'import { a } from "./a.js";\n' }),
    );
    expect(result.status).toBe(1);
    expect(result.output).toContain('app/page.tsx:1 imports "./a.js"');
  });

  it("passes extensionless and package imports", () => {
    const dir = tree({
      "app/page.tsx": 'import { a } from "./a";\nimport Link from "next/link";\n',
    });
    expect(check("check-imports.mjs", dir).status).toBe(0);
  });
});

describe("check-styles", () => {
  it("allows arbitrary colours, colour literals and inline style colours unchanged", () => {
    const files = {
      "app/a.tsx": 'export const A = () => <p className="bg-[#ff0000]">a</p>;\n',
      "app/b.tsx": 'export const B = () => <p style={{ color: "red" }}>b</p>;\n',
      "app/c.css": ".c { color: rgb(1 2 3); }\n",
    };
    const dir = tree(files);
    expect(check("check-styles.mjs", dir).status).toBe(0);
    for (const [file, content] of Object.entries(files)) {
      expect(readFileSync(path.join(dir, file), "utf8")).toBe(content);
    }
  });

  it("passes token utilities, the token file and anchors", () => {
    const dir = tree({
      "app/theme.css": "@theme { --color-bg: #f7f7f5; }\n",
      "app/ok.tsx":
        'export const Ok = () => <a href="#top" className="bg-accent w-[37px]">ok</a>;\n',
    });
    expect(check("check-styles.mjs", dir).status).toBe(0);
  });

  it("allows named colours in arbitrary values, inline shorthands and css unchanged", () => {
    const files = {
      "app/a.tsx": 'export const A = () => <p className="bg-[red]">a</p>;\n',
      "app/b.tsx": 'export const B = () => <p className="text-[Crimson] x">b</p>;\n',
      "app/c.tsx": 'export const C = () => <p className="border-[navy]/50">c</p>;\n',
      "app/d.tsx": 'export const D = () => <p style={{ border: "1px solid red" }}>d</p>;\n',
      "app/e.tsx": 'export const E = () => <p style={{ outline: "2px solid Tomato" }}>e</p>;\n',
      "app/f.tsx": 'export const F = () => <p style={{ background: "red url(/x.png)" }}>f</p>;\n',
      "app/g.tsx": 'export const G = () => <p style={{ boxShadow: "0 0 4px red" }}>g</p>;\n',
      "app/h.tsx": 'export const H = () => <p className="shadow-[0_0_0_1px_red]">h</p>;\n',
      "app/i.css": ".i { border: 1px solid red; }\n",
    };
    const dir = tree(files);
    expect(check("check-styles.mjs", dir).status).toBe(0);
    for (const [file, content] of Object.entries(files)) {
      expect(readFileSync(path.join(dir, file), "utf8")).toBe(content);
    }
  });

  it("passes transparent, currentColor, inherit and words that only contain a colour name", () => {
    const dir = tree({
      "app/ok.tsx": [
        'export const Ok = () => <p className="bordered bg-[transparent] border-[currentColor] redirect-me">',
        '  <span style={{ border: "1px solid currentColor", outline: "none", textDecoration: "inherit" }}>',
        "  border: red text, redirect</span></p>;",
        'export const redirect = "/tan";',
        "export const url = <p className=\"bg-[url(/red.png)] border-[var(--c)] data-[state=red]:x content-['red']\">u</p>;",
        "",
      ].join("\n"),
      "app/ok.css":
        ".a { border: 1px solid transparent; background: url(red.png); }\n.red-ish { outline: none; }\n",
    });
    expect(check("check-styles.mjs", dir).status).toBe(0);
  });
});

describe("check-contrast", () => {
  const theme = (fg: string) =>
    `@theme { --color-bg: #ffffff; --color-surface: #ffffff; --color-fg: ${fg}; --color-muted: #595959; --color-accent: #000000; --color-accent-fg: #ffffff; --color-danger: #b42318; }\n`;

  it("passes a readable fixture when the optional contrast helper is requested", () => {
    const dir = tree({ "app/theme.css": theme("#000000") });
    expect(check("check-contrast.mjs", dir).status).toBe(0);
  });

  it("names a pair below 4.5:1 (#777 on white is 4.48)", () => {
    const result = check("check-contrast.mjs", tree({ "app/theme.css": theme("#777777") }));
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/fg \(#777777\) on bg.*4\.48:1/u);
  });

  it("fails closed on a colour it cannot read", () => {
    const result = check("check-contrast.mjs", tree({ "app/theme.css": theme("oklch(0.2 0 0)") }));
    expect(result.status).toBe(1);
  });
});

describe("generate-theme", () => {
  // Test the optional exporter with a fixture, never with the founder's editable design.
  const design = `---
version: alpha
name: Pramaan app
description: An editable starting point. Tailwind v4; optional theme export from this file.
colors:
  bg: "#f7f7f5"
  surface: "#ffffff"
  fg: "#1c1c1a"
  muted: "#5f5f5a"
  line: "#d9d9d4"
  accent: "#2f5bd3"
  accent-fg: "#ffffff"
  danger: "#b42318"
typography:
  sans:
    fontFamily: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif
    fontSize: 1rem
    fontWeight: 400
  mono:
    fontFamily: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace
    fontSize: 1rem
    fontWeight: 400
  title:
    fontFamily: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif
    fontSize: 1.5rem
    fontWeight: 600
  label:
    fontFamily: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif
    fontSize: 1rem
    fontWeight: 500
rounded:
  lg: 0.5rem
  xl: 0.75rem
components:
  button-primary:
    backgroundColor: "{colors.accent}"
    textColor: "{colors.accent-fg}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: 0.75rem 1rem
  button-secondary:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    borderColor: "{colors.line}"
    typography: "{typography.label}"
    rounded: "{rounded.lg}"
    padding: 0.75rem 1rem
  input:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    borderColor: "{colors.line}"
    rounded: "{rounded.lg}"
    padding: 0.75rem
  card:
    backgroundColor: "{colors.surface}"
    textColor: "{colors.fg}"
    borderColor: "{colors.line}"
    rounded: "{rounded.xl}"
    padding: 1rem
---\n`;
  const run = (dir: string, ...args: string[]) => {
    const result = spawnSync(
      process.execPath,
      [path.join("scripts", "generate-theme.mjs"), dir, ...args],
      { encoding: "utf8" },
    );
    return { status: result.status, output: `${result.stdout}${result.stderr}` };
  };

  const fixture = () => {
    const dir = tree({ "DESIGN.md": design, "app/theme.css": "" });
    expect(run(dir).status).toBe(0);
    return { dir, theme: readFileSync(path.join(dir, "app/theme.css"), "utf8") };
  };

  it("can explicitly check an unchanged optional export", () => {
    expect(run(fixture().dir, "--check").status).toBe(0);
  });

  it("exports fixture tokens without clearing the standard Tailwind palette", () => {
    const { theme } = fixture();
    expect(theme).not.toContain("--color-*: initial;");
    for (const line of [
      '@import "tailwindcss";',
      "--color-bg: #f7f7f5;",
      "--color-surface: #ffffff;",
      "--color-fg: #1c1c1a;",
      "--color-muted: #5f5f5a;",
      "--color-line: #d9d9d4;",
      "--color-accent: #2f5bd3;",
      "--color-accent-fg: #ffffff;",
      "--color-danger: #b42318;",
      '--font-sans: ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif;',
      "--font-mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;",
      "@apply bg-bg text-fg font-sans antialiased;",
    ]) {
      expect(theme).toContain(line);
    }
  });

  it("reports drift only on explicit export check and preserves the edit", () => {
    const { dir, theme } = fixture();
    const edited = theme.replace("#2f5bd3", "#2f5bd4");
    writeFileSync(path.join(dir, "app/theme.css"), edited);
    const result = run(dir, "--check");
    expect(result.status).toBe(1);
    expect(result.output).toContain("app/theme.css differs from DESIGN.md");
    expect(readFileSync(path.join(dir, "app/theme.css"), "utf8")).toBe(edited);
  });

  it("ordinary route generation preserves custom CSS without requiring DESIGN.md", () => {
    const theme = '@import "tailwindcss";\nbody { background: oklch(0.4 0.2 240); }\n';
    const dir = tree({ "app/theme.css": theme });
    expect(check("generate-routes.mjs", dir).status).toBe(0);
    expect(readFileSync(path.join(dir, "app/theme.css"), "utf8")).toBe(theme);
    expect(readFileSync(path.join(dir, "app/routes.generated.ts"), "utf8")).toContain("export");
  });

  it("fails on a broken token reference", () => {
    const dir = tree({ "DESIGN.md": design.replace("{colors.accent-fg}", "{colors.nope}") });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/\{colors\.nope\}.*broken-ref/u);
  });

  it("fails on a contrast warning, which the lint alone exits 0 on", () => {
    const dir = tree({
      "DESIGN.md": design.replace('accent-fg: "#ffffff"', 'accent-fg: "#7a93d9"'),
    });
    const result = run(dir);
    expect(result.status).toBe(1);
    expect(result.output).toMatch(/components\.button-primary.*below WCAG AA.*contrast-ratio/u);
  });

  it("compiles exported tokens, standard palette and arbitrary colours", async () => {
    const { theme } = fixture();
    const tailwind = path.dirname(fileURLToPath(import.meta.resolve("tailwindcss/index.css")));
    const compiler = await compile(theme, {
      base: ".",
      loadStylesheet: async (id: string) => ({
        path: id,
        base: tailwind,
        content: readFileSync(path.join(tailwind, "index.css"), "utf8"),
      }),
    });
    const css = compiler.build([
      "font-sans",
      "weight-title",
      "button-primary",
      "card",
      "bg-red-500",
      "bg-[#ff00ff]",
    ]);
    expect(css).toMatch(/\.bg-red-500 \{\s*background-color: var\(--color-red-500\);/u);
    expect(css).toContain("background-color: #ff00ff;");
    expect(css).toMatch(/--font-sans: ui-sans-serif, [^;]*, sans-serif;/u);
    expect(css).not.toContain("--font-weight-title");
    expect(css).toMatch(/\.font-sans \{\s*font-family: var\(--font-sans\);/u);
    expect(css).toMatch(/\.weight-title \{\s*font-weight: 600;/u);
    expect(css).toMatch(/\.button-primary \{\s*background-color: var\(--color-accent\);/u);
    expect(css).toMatch(/\.card \{\s*background-color: var\(--color-surface\);/u);
  });
});
