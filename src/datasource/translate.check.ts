/**
 * Self-check for lyric translation batching. Run with the whole suite:
 *
 *   npm run check
 *
 * The provider is undocumented and returns an unlabelled nested array, so parsing and
 * alignment are where this breaks. A misaligned translation is the failure that matters: it
 * pins the wrong words under the wrong line and looks entirely deliberate.
 */
export {};

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`FAILED: ${message}`);
}

function equal(actual: unknown, expected: unknown, message: string): void {
  check(actual === expected, `${message}: expected ${String(expected)}, got ${String(actual)}`);
}

const { alignChunk, chunkLines, parseTranslateResponse } = await import("./translate");

/* Chunking: a line must never be split across two requests, or it cannot be realigned. */

equal(chunkLines([]).length, 0, "no lines means no requests");
equal(chunkLines(["a", "b", "c"], 100).length, 1, "a short song is one request");

const many = Array.from({ length: 40 }, () => "x".repeat(30));
const chunks = chunkLines(many, 100);
check(chunks.length > 1, "a long song is split");
equal(chunks.flat().length, many.length, "and every line survives the split");
check(
  chunks.every((chunk) => chunk.length > 0),
  "with no empty requests",
);
check(
  chunks.every((chunk) => chunk.join("\n").length <= 100 || chunk.length === 1),
  "no chunk exceeds the budget unless it is a single oversized line",
);

const huge = ["y".repeat(5000), "short"];
const hugeChunks = chunkLines(huge, 100);
equal(hugeChunks.flat().length, 2, "an over-budget line is kept, not dropped");
equal(hugeChunks[0].length, 1, "and gets a request to itself");

/* Parsing: every level of the untyped response has to be checked. */

equal(
  parseTranslateResponse([[["hola", "hello", null, null]]]),
  "hola",
  "a single segment is read",
);
equal(
  parseTranslateResponse([[["one\n", "x"], ["two", "y"]]]),
  "one\ntwo",
  "segments are concatenated, because the endpoint splits on sentences not lines",
);
equal(parseTranslateResponse(null), null, "null is not a response");
equal(parseTranslateResponse({}), null, "nor is an object");
equal(parseTranslateResponse([]), null, "nor an empty array");
equal(parseTranslateResponse([null]), null, "nor a missing segment list");
equal(parseTranslateResponse([[[42]]]), null, "nor a segment whose text is not text");

/* Alignment: the one that must never guess. */

const aligned = alignChunk("uno\ndos\ntres", 3);
equal(aligned?.length, 3, "a matching count aligns");
equal(aligned?.[1], "dos", "in order");
equal(alignChunk(" uno \n dos ", 2)?.[0], "uno", "and is trimmed");

equal(alignChunk("uno\ndos", 3), null, "too few lines back is a refusal, not a pad");
equal(alignChunk("uno\ndos\ntres\ncuatro", 3), null, "too many is also a refusal");
equal(alignChunk("", 2), null, "an empty translation cannot be aligned to two lines");
equal(alignChunk("", 1)?.[0], "", "but a single empty line is a legitimate blank");

console.log("translate self-check passed");
