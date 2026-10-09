/**
 * `npm run e2e [-- e2e/some.test.mjs ...]`: start a dev server on a free
 * port, run the end-to-end tests against it, and stop it again.
 */
import { spawn } from "node:child_process";
import { readdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "..");

const port = await new Promise((resolve) => {
  const srv = net.createServer().listen(0, () => {
    const { port } = srv.address();
    srv.close(() => resolve(port));
  });
});
const base = `http://localhost:${port}`;

const vite = spawn("npx", ["vite", "--port", String(port), "--strictPort"], { cwd: ROOT, stdio: "ignore", detached: true });
const stopVite = () => {
  try {
    process.kill(-vite.pid, "SIGTERM");
  } catch {}
};
process.on("exit", stopVite);
for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => process.exit(130));

let up = false;
for (let i = 0; i < 60 && !up; i++) {
  await new Promise((r) => setTimeout(r, 500));
  up = await fetch(`${base}/data/skymap-data.json`).then((r) => r.ok, () => false);
}
if (!up) {
  console.error(`dev server didn't come up on ${base}`);
  process.exit(2);
}

const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : readdirSync(HERE).filter((f) => f.endsWith(".test.mjs")).map((f) => path.join("e2e", f));
// Each file drives its own Chrome; a few at a time keeps the machine responsive.
const test = spawn(process.execPath, ["--test", "--test-concurrency=3", ...files], {
  cwd: ROOT,
  stdio: "inherit",
  env: { ...process.env, E2E_BASE: base },
});
test.on("exit", (code) => process.exit(code ?? 1));
