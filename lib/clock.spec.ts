import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { appNow } from "./clock";

// Next's own .env loader, from the next this app runs (pnpm keeps @next/env beside it), loaded fresh for each
// start: it keeps the environment it first saw, as a server process does.
const fromNext = createRequire(createRequire(import.meta.url).resolve("next/package.json"));
const loader = fromNext.resolve("@next/env");
const quiet = { info() {}, error() {} };
function startNext(dir: string) {
  delete fromNext.cache[loader];
  fromNext(loader).loadEnvConfig(dir, true, quiet, true);
}

const FIXED = new Headers({ "x-pramaan-now": "2031-01-02T03:04:05Z" });
const before = process.env.PRAMAAN_TEST_CLOCK;
const dirs: string[] = [];
function appWithEnvFile(text: string) {
  const dir = mkdtempSync(path.join(tmpdir(), "clock-"));
  dirs.push(dir);
  writeFileSync(path.join(dir, ".env"), text);
  return dir;
}

afterEach(() => {
  if (before === undefined) delete process.env.PRAMAAN_TEST_CLOCK;
  else process.env.PRAMAAN_TEST_CLOCK = before;
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("appNow", () => {
  it("takes a journey's fixed time only in Pramaan's checks", () => {
    delete process.env.PRAMAAN_TEST_CLOCK;
    expect(appNow(FIXED).getUTCFullYear()).not.toBe(2031);
    process.env.PRAMAAN_TEST_CLOCK = "1";
    expect(appNow(FIXED).toISOString()).toBe("2031-01-02T03:04:05.000Z");
    expect(Number.isNaN(appNow(new Headers({ "x-pramaan-now": "soon" })).getTime())).toBe(false);
  });

  it("a committed .env cannot turn it on in a draft or the live app, which start with it off", () => {
    const dir = appWithEnvFile("PRAMAAN_TEST_CLOCK=1\n");
    // As chat-draft.mjs, preview.mjs and site-runtime.mjs start the app: PRAMAAN_TEST_CLOCK=0.
    process.env.PRAMAAN_TEST_CLOCK = "0";
    startNext(dir);
    expect(process.env.PRAMAAN_TEST_CLOCK).toBe("0");
    expect(appNow(FIXED).getUTCFullYear()).not.toBe(2031);
    // Started without it, the same file would turn the clock on: why the runtimes set it.
    delete process.env.PRAMAAN_TEST_CLOCK;
    startNext(dir);
    expect(process.env.PRAMAAN_TEST_CLOCK).toBe("1");
  });
});
