/**
 * Runs every `*.check.ts` self-check in the repo.
 *
 * These files carried their own esbuild incantation in a header comment, which meant they
 * only ever ran when someone remembered to paste it — fifteen files of real assertions that
 * nothing executed. This is the thing that executes them.
 *
 *   npm run check
 *
 * Bundling goes through esbuild's JS API rather than the `esbuild` binary: on Windows that
 * binary is reached through a `.cmd` shim, and Node refuses to spawn one without a shell
 * (CVE-2024-27980), while spawning *with* a shell concatenates arguments instead of passing
 * them. The API sidesteps both and skips a process per check.
 */
import { build } from "esbuild";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const SRC = join(ROOT, "src");
/** A check that has not finished by now is stuck, not slow: they are pure and in-memory. */
const TIMEOUT_MS = 30_000;

function findChecks(dir) {
  const found = [];
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) found.push(...findChecks(path));
    else if (entry.endsWith(".check.ts")) found.push(path);
  }
  return found.sort();
}

const checks = findChecks(SRC);
if (checks.length === 0) {
  console.error("No *.check.ts files found — did the source layout move?");
  process.exit(1);
}

const outDir = mkdtempSync(join(tmpdir(), "zuno-checks-"));
const failures = [];

try {
  for (const check of checks) {
    const name = relative(ROOT, check).replace(/[\\/]/g, "_");
    const bundle = join(outDir, `${name}.mjs`);

    try {
      await build({
        entryPoints: [check],
        bundle: true,
        platform: "node",
        format: "esm",
        outfile: bundle,
        logLevel: "silent",
        /* Vite resolves asset imports to a URL string; esbuild needs telling. Without this a
           check fails to bundle because a module three imports away pulled in an image. */
        loader: {
          ".svg": "dataurl",
          ".png": "dataurl",
          ".jpg": "dataurl",
          ".jpeg": "dataurl",
          ".webp": "dataurl",
          ".mp4": "dataurl",
        },
      });
    } catch (error) {
      failures.push({ check, stage: "bundle", output: String(error?.message ?? error) });
      continue;
    }

    /* Each check runs in its own process: one that throws or hangs must not take the rest of
       the suite with it, and the failure has to name the file that caused it. */
    const ran = spawnSync(process.execPath, [bundle], {
      encoding: "utf8",
      timeout: TIMEOUT_MS,
    });
    if (ran.status !== 0) {
      const output = ran.stderr || ran.stdout || ran.error?.message || "timed out";
      failures.push({ check, stage: "run", output });
      continue;
    }

    console.log(`  ok  ${relative(ROOT, check)}`);
  }
} finally {
  rmSync(outDir, { recursive: true, force: true });
}

if (failures.length > 0) {
  for (const failure of failures) {
    console.error(`\nFAILED (${failure.stage}) ${relative(ROOT, failure.check)}`);
    console.error(String(failure.output).trim());
  }
  console.error(`\n${failures.length} of ${checks.length} checks failed.`);
  process.exit(1);
}

console.log(`\n${checks.length} checks passed.`);
