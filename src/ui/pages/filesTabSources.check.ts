/**
 * Self-check for the file-manager tab's source list. No test runner in this project, so:
 *
 *   npm run check
 *
 * The dangerous case is not a wrong label — it is the same path stored twice (a folder picked
 * again with different casing), which would make the Rust scanner read the whole folder twice
 * and the tab show every track twice.
 */
export {};

import {
  filesTabSourcePaths,
  mergeFilesTabSources,
  normalizeFilesTabSource,
  normalizeFilesTabSources,
  type FilesTabSource,
} from "./filesTabSources";

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const folder = (path: string): FilesTabSource => ({ kind: "folder", path });
const file = (path: string): FilesTabSource => ({ kind: "file", path });

// --- normalize ---------------------------------------------------------------

check(normalizeFilesTabSource(null) === null, "null is not a source");
check(normalizeFilesTabSource("C:\\Music") === null, "a bare string is not a source");
check(normalizeFilesTabSource({ path: "   " }) === null, "blank path is rejected");
check(normalizeFilesTabSource({ path: "C:\\Music", kind: "video" }) === null, "unknown kind is rejected");

const trimmed = normalizeFilesTabSource({ path: "  C:\\Music  ", kind: "folder" });
check(trimmed !== null && trimmed.path === "C:\\Music", "paths are trimmed");
check(trimmed !== null && trimmed.kind === "folder", "kind survives normalize");

equal(normalizeFilesTabSources(null).length, 0, "null list normalizes to empty");
equal(normalizeFilesTabSources({}).length, 0, "non-array normalizes to empty");
equal(
  normalizeFilesTabSources([{ path: "C:\\a", kind: "file" }, "junk", { path: "", kind: "folder" }]).length,
  1,
  "junk entries are dropped, valid ones kept",
);

// --- merge -------------------------------------------------------------------

const existing = [folder("C:\\Music"), file("C:\\songs\\one.mp3")];

// Picking the same folder again with different casing must not duplicate it.
const merged = mergeFilesTabSources(existing, ["c:\\MUSIC", "C:\\songs\\two.mp3"], "file");
equal(merged.length, 3, "case-insensitive dedupe across kinds");
equal(merged[0].path, "C:\\Music", "existing order is kept");
equal(merged[2].path, "C:\\songs\\two.mp3", "new picks append at the end");
equal(merged[2].kind, "file", "new picks get the picked kind");

// Blank picks are ignored rather than stored.
equal(mergeFilesTabSources(existing, ["  ", ""], "file").length, 2, "blank picks are ignored");

// --- paths -------------------------------------------------------------------

equal(
  filesTabSourcePaths([folder("C:\\Music"), file("C:\\one.mp3")]).join("|"),
  "C:\\Music|C:\\one.mp3",
  "paths are mapped in order",
);
