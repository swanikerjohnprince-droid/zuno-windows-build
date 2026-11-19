import { getAppSetting, setAppSetting } from "../../internal/appSettings";

/**
 * The files and folders behind the "File manager" tab.
 *
 * The tab is a thin shell over the OS file dialog plus the Rust `local_audio_scan` — the same
 * pipeline the DJ queue's "add from PC" and the local playlists use. All it has to remember
 * between launches is which paths the user picked, so this module stores that small list the
 * way localPlaylists.ts does: localStorage for instant reads, the durable app settings as the
 * source of truth after hydration.
 */
export const FILES_TAB_SOURCES_KEY = "zuno-files-tab-sources-v1";

export type FilesTabSourceKind = "file" | "folder";

export interface FilesTabSource {
  kind: FilesTabSourceKind;
  path: string;
}

const listeners = new Set<() => void>();
let cachedRaw: string | null = null;
let cachedSources: FilesTabSource[] = [];
let hydrationStarted = false;

export function normalizeFilesTabSource(value: unknown): FilesTabSource | null {
  if (!value || typeof value !== "object") return null;
  const candidate = value as Partial<FilesTabSource>;
  if (typeof candidate.path !== "string" || !candidate.path.trim()) return null;
  if (candidate.kind !== "file" && candidate.kind !== "folder") return null;
  return { kind: candidate.kind, path: candidate.path.trim() };
}

export function normalizeFilesTabSources(value: unknown): FilesTabSource[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeFilesTabSource)
    .filter((source): source is FilesTabSource => Boolean(source));
}

/**
 * Adds picked paths with one entry per path. Windows paths are case-insensitive, so the same
 * folder picked twice with different casing must not end up scanning twice.
 */
export function mergeFilesTabSources(
  existing: readonly FilesTabSource[],
  picked: readonly string[],
  kind: FilesTabSourceKind,
): FilesTabSource[] {
  const seen = new Set(existing.map((source) => source.path.toLowerCase()));
  const next = [...existing];
  for (const raw of picked) {
    const path = raw.trim();
    if (!path) continue;
    const key = path.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    next.push({ kind, path });
  }
  return next;
}

export function filesTabSourcePaths(sources: readonly FilesTabSource[]): string[] {
  return sources.map((source) => source.path);
}

function writeLocalStorageJson(key: string, value: unknown): void {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Durable app settings remain the source of truth after hydration.
  }
}

function readFilesTabSources(): FilesTabSource[] {
  if (typeof window === "undefined") return [];
  hydrateFilesTabSources();
  const raw = localStorage.getItem(FILES_TAB_SOURCES_KEY) ?? "[]";
  if (raw === cachedRaw) return cachedSources;
  try {
    cachedRaw = raw;
    cachedSources = normalizeFilesTabSources(JSON.parse(raw));
    return cachedSources;
  } catch {
    cachedRaw = raw;
    cachedSources = [];
    return [];
  }
}

function notifyFilesTabSourcesChanged(): void {
  cachedRaw = null;
  cachedSources = [];
  readFilesTabSources();
  listeners.forEach((listener) => listener());
}

function writeFilesTabSources(sources: FilesTabSource[]): void {
  if (typeof window === "undefined") return;
  const raw = JSON.stringify(sources);
  writeLocalStorageJson(FILES_TAB_SOURCES_KEY, sources);
  void setAppSetting(FILES_TAB_SOURCES_KEY, sources);
  cachedRaw = raw;
  cachedSources = sources;
  listeners.forEach((listener) => listener());
}

function hydrateFilesTabSources(): void {
  if (hydrationStarted || typeof window === "undefined") return;
  hydrationStarted = true;
  void getAppSetting<unknown>(FILES_TAB_SOURCES_KEY).then((stored) => {
    const normalized = normalizeFilesTabSources(stored);
    if (normalized.length > 0) {
      writeLocalStorageJson(FILES_TAB_SOURCES_KEY, normalized);
      notifyFilesTabSourcesChanged();
      return;
    }
    const local = readFilesTabSources();
    if (local.length > 0) void setAppSetting(FILES_TAB_SOURCES_KEY, local);
  });
}

export function getFilesTabSources(): FilesTabSource[] {
  return readFilesTabSources();
}

export function subscribeFilesTabSources(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function addFilesTabSources(
  paths: readonly string[],
  kind: FilesTabSourceKind,
): FilesTabSource[] {
  const current = readFilesTabSources();
  const next = mergeFilesTabSources(current, paths, kind);
  if (next.length !== current.length) writeFilesTabSources(next);
  return next;
}

export function removeFilesTabSource(path: string): void {
  const key = path.toLowerCase();
  writeFilesTabSources(
    readFilesTabSources().filter((source) => source.path.toLowerCase() !== key),
  );
}
