import { spawn } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fakeDoor } from "./fake-door.mjs";

await mkdir(".evidence", { recursive: true });
const dir = path.resolve(".scratch/door");
const fake = await fakeDoor(dir);
const config = {
  secret: randomBytes(32).toString("hex"),
  project: "assistant-local",
  origin: "http://127.0.0.1:3412",
};
await writeFile(".evidence/runtime.json", JSON.stringify(config), { mode: 0o600 });
// The walk controls this fixture through an ignored file, outside all application routes.
const { watchFile, unwatchFile } = await import("node:fs");
const { readFile } = await import("node:fs/promises");
await writeFile(".scratch/fake-control.json", JSON.stringify({ off: false }));
watchFile(".scratch/fake-control.json", { interval: 100 }, () =>
  readFile(".scratch/fake-control.json", "utf8")
    .then(async (v) => {
      const control = JSON.parse(v);
      Object.assign(fake.state, control);
      await writeFile(".scratch/fake-ack.json", JSON.stringify(control));
    })
    .catch(() => {}),
);
const child = spawn(
  process.execPath,
  [
    "node_modules/next/dist/bin/next",
    process.env.ASSISTANT_DEV ? "dev" : "start",
    "-p",
    "3412",
    "-H",
    process.env.ASSISTANT_HOST ?? "127.0.0.1",
    ...(process.env.ASSISTANT_DEV ? ["--webpack", "--disable-source-maps"] : []),
  ],
  {
    stdio: "inherit",
    env: {
      ...process.env,
      NODE_ENV: process.env.ASSISTANT_DEV ? "development" : "production",
      SESSION_SECRET: config.secret,
      PRAMAAN_PROJECT_ID: config.project,
      APP_ORIGIN: config.origin,
      APP_COOKIE_SECURE: "false",
      PRAMAAN_MODULES_DIR: dir,
    },
  },
);
const stop = () => child.kill("SIGTERM");
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
child.on("exit", async (code) => {
  unwatchFile(".scratch/fake-control.json");
  await fake.close();
  process.exit(code ?? 1);
});
