import { getCachedJson, setCachedJson } from "../internal/cache";
import { logInternalWarn } from "../internal/logging";
import { tauriFetch } from "./youtube/tauriFetch";

/**
 * Lyric translation through Google's undocumented `translate_a` endpoint.
 *
 * This is the endpoint every media player quietly uses; it needs no key and works
 * immediately. It is also undocumented, rate-limited by IP, and can change shape without
 * notice — so everything here treats a failure as normal: a miss returns null, the caller
 * shows the original words, and nothing on the lyrics screen depends on it succeeding.
 *
 * Swapping in a keyed provider later means replacing `requestTranslation` alone; the
 * chunking, alignment and caching above it are provider-agnostic.
 */

/**
 * Characters per request.
 *
 * The endpoint takes the text in the query string, so this is really a URL length budget.
 * Well under the limit on purpose: a request that is refused for length costs a whole chunk
 * of lyrics, while one extra request costs a few hundred milliseconds.
 */
const CHUNK_BUDGET_CHARS = 1200;
const REQUEST_TIMEOUT_MS = 6_000;
/** A song with more chunks than this is not a song; it is a transcript that will get us blocked. */
const MAX_CHUNKS = 12;

/**
 * Groups lines into request-sized chunks without splitting a line across two.
 *
 * Alignment is the whole problem with batch translation: a line must come back as the same
 * line it went in as, so a chunk boundary can only ever fall between lines.
 */
export function chunkLines(lines: string[], budget = CHUNK_BUDGET_CHARS): string[][] {
  const chunks: string[][] = [];
  let current: string[] = [];
  let size = 0;

  for (const line of lines) {
    // +1 for the newline that joins it. A single line over budget still gets its own chunk
    // rather than being dropped — the endpoint can refuse it, and that is a miss, not a bug.
    const cost = line.length + 1;
    if (current.length > 0 && size + cost > budget) {
      chunks.push(current);
      current = [];
      size = 0;
    }
    current.push(line);
    size += cost;
  }

  if (current.length > 0) chunks.push(current);
  return chunks;
}

/**
 * Pulls the translated text out of the endpoint's nested-array response.
 *
 * Shape is `[[[translated, original, ...], ...], ...]` with no schema and no guarantee, so
 * every level is checked. Segments are concatenated because the endpoint splits on sentence
 * boundaries, not on the newlines we sent.
 */
export function parseTranslateResponse(body: unknown): string | null {
  if (!Array.isArray(body)) return null;
  const segments = body[0];
  if (!Array.isArray(segments)) return null;

  let text = "";
  for (const segment of segments) {
    if (Array.isArray(segment) && typeof segment[0] === "string") text += segment[0];
  }
  return text.length > 0 ? text : null;
}

/**
 * Splits a chunk's translation back into one entry per original line.
 *
 * Returns null on a count mismatch rather than guessing. A translation attached to the wrong
 * line is worse than no translation: it is confidently wrong, and on a lyrics screen the
 * listener has no way to tell.
 */
export function alignChunk(translated: string, lineCount: number): string[] | null {
  const parts = translated.split("\n");
  if (parts.length !== lineCount) return null;
  return parts.map((part) => part.trim());
}

async function requestTranslation(text: string, targetLang: string): Promise<string | null> {
  const params = new URLSearchParams({
    client: "gtx",
    sl: "auto",
    tl: targetLang,
    dt: "t",
    q: text,
  });

  const response = await tauriFetch(`https://translate.googleapis.com/translate_a/single?${params}`, {
    headers: { Accept: "application/json" },
    timeoutMs: REQUEST_TIMEOUT_MS,
  });
  if (!response.ok) return null;
  return parseTranslateResponse(await response.json());
}

/**
 * Translates lines, preserving one output per input.
 *
 * Entries the endpoint could not align are returned as empty strings, so the caller can show
 * the original alone for those and the translation for the rest.
 */
export async function translateLines(
  lines: string[],
  targetLang: string,
  cacheKey?: string,
): Promise<string[] | null> {
  if (lines.length === 0) return null;

  const key = cacheKey ? `lyrics:translation:v1:${targetLang}:${cacheKey}` : null;
  if (key) {
    const cached = await getCachedJson<string[]>(key);
    // Length is part of the validity check: a cached run against a different lyric source
    // would align to nothing.
    if (cached?.length === lines.length) return cached;
  }

  const chunks = chunkLines(lines);
  if (chunks.length > MAX_CHUNKS) {
    logInternalWarn("translateLines refused an oversized request", {
      lineCount: lines.length,
      chunkCount: chunks.length,
    });
    return null;
  }

  const translated: string[] = [];
  let anyAligned = false;

  for (const chunk of chunks) {
    try {
      const result = await requestTranslation(chunk.join("\n"), targetLang);
      const aligned = result === null ? null : alignChunk(result, chunk.length);
      if (aligned) {
        translated.push(...aligned);
        anyAligned = true;
      } else {
        // Blank rather than misaligned: this chunk shows its original lines untranslated.
        translated.push(...chunk.map(() => ""));
      }
    } catch (error) {
      logInternalWarn("translateLines chunk failed", {
        error: error instanceof Error ? error.message : String(error),
      });
      translated.push(...chunk.map(() => ""));
    }
  }

  if (!anyAligned) return null;
  if (key) await setCachedJson(key, translated);
  return translated;
}
