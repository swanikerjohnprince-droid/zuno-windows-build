import { invoke } from "@tauri-apps/api/core";
import { logInternalInfo } from "./logging";

/**
 * A memory line in the app log, once a minute.
 *
 * Task Manager says the renderer is using 220 MB and stops there. That number is the sum of at
 * least four things that are fixed in completely different ways, and picking the wrong one is
 * how an afternoon disappears:
 *
 * - **JS heap** — retained objects. Grows over a session if something is leaking references.
 * - **DOM nodes** — these lists are not windowed, so a long playlist really does build every
 *   row. Nodes carry style and layout objects whether or not they are on screen.
 * - **Images** — the big one, and the least obvious: a decoded bitmap is ~4 bytes per pixel
 *   regardless of how small the JPEG was, so one full-size cover in a 40px slot costs more than
 *   two hundred correctly-sized ones.
 * - **Subframes** — each YouTube IFrame player is its own renderer, around 90 MB of it.
 *
 * One sample a minute is nothing next to what it replaces, and the shape over a session is what
 * actually identifies the culprit: a flat line with a high floor is not a leak, and a staircase
 * that climbs as you browse is not a baseline.
 */
const SAMPLE_INTERVAL_MS = 60_000;
const BYTES_PER_MB = 1024 * 1024;

interface ChromiumMemory {
  usedJSHeapSize: number;
  totalJSHeapSize: number;
}

function readJsHeap(): ChromiumMemory | null {
  // Non-standard and Chromium-only, which is fine — the shipped runtime is Chromium.
  return (performance as Performance & { memory?: ChromiumMemory }).memory ?? null;
}

function toMb(bytes: number): number {
  return Math.round((bytes / BYTES_PER_MB) * 10) / 10;
}

/*
 * High-water marks, because a sample every sixty seconds almost never lands on the moment that
 * matters. The first run of this told us the heap was flat at 35 MB with 500 DOM nodes — but
 * every one of those samples caught the app sitting on the home page. A minute is long enough
 * to open a thousand-track playlist, scroll it, and navigate away again entirely unobserved.
 *
 * The peak is what distinguishes the two answers: a peak equal to the current value means the
 * floor is the whole story, and a peak far above it means something built up and was released,
 * which is exactly the shape that leaves a process's RSS high after the memory is gone.
 */
const peak = {
  jsHeapUsedMb: 0,
  domNodes: 0,
  images: 0,
  commitMb: 0,
};

interface ProcessMemory {
  pid: number;
  name: string;
  workingSetMb: number;
  commitMb: number;
}

interface AppMemoryReport {
  totalWorkingSetMb: number;
  totalCommitMb: number;
  processes: ProcessMemory[];
}

let firstJsHeapUsedMb: number | null = null;

async function sampleMemory(): Promise<void> {
  const heap = readJsHeap();
  const jsHeapUsedMb = heap ? toMb(heap.usedJSHeapSize) : null;
  /*
   * `img` alone would miss the artwork that has not resolved yet, and undercount exactly when
   * a page is mid-load — which is when the number is most interesting.
   */
  const images = document.images.length;
  let loadedImages = 0;
  for (const image of document.images) {
    if (image.complete && image.naturalWidth > 0) loadedImages += 1;
  }
  const domNodes = document.getElementsByTagName("*").length;

  if (jsHeapUsedMb !== null) {
    if (firstJsHeapUsedMb === null) firstJsHeapUsedMb = jsHeapUsedMb;
    peak.jsHeapUsedMb = Math.max(peak.jsHeapUsedMb, jsHeapUsedMb);
  }
  peak.domNodes = Math.max(peak.domNodes, domNodes);
  peak.images = Math.max(peak.images, images);

  /*
   * The whole process tree, not just this renderer.
   *
   * A WebView2 app is a browser process, a GPU process, a renderer per window and utility
   * processes. Every number above this line describes one of them — and on this app the GPU
   * process has been carrying several times the renderer's memory, entirely unseen.
   *
   * Commit rather than working set is what `totalCommitMb` and the peak track: working set is
   * how much physical RAM the OS currently allows, so it falls whenever anything trims it and
   * says nothing about what is held.
   */
  const processes = await invoke<AppMemoryReport>("app_memory_report").catch(() => null);
  if (processes) peak.commitMb = Math.max(peak.commitMb, processes.totalCommitMb);
  const biggest = processes?.processes[0];

  logInternalInfo("memory.sample", {
    jsHeapUsedMb,
    jsHeapTotalMb: heap ? toMb(heap.totalJSHeapSize) : null,
    domNodes,
    images,
    loadedImages,
    // Each of these is its own renderer process; two of them outweighs everything above.
    iframes: document.getElementsByTagName("iframe").length,
    audioElements: document.getElementsByTagName("audio").length,
    videoElements: document.getElementsByTagName("video").length,
    peakJsHeapUsedMb: peak.jsHeapUsedMb,
    peakDomNodes: peak.domNodes,
    peakImages: peak.images,
    /*
     * Growth against the very first sample, which is taken at bootstrap before React has
     * rendered anything. That first reading is the floor the bundle costs just by existing, so
     * this number is the part of the heap the running application is actually responsible for.
     */
    jsHeapGrowthMb: jsHeapUsedMb !== null && firstJsHeapUsedMb !== null
      ? Math.round((jsHeapUsedMb - firstJsHeapUsedMb) * 10) / 10
      : null,
    sinceStartMin: Math.round((performance.now() / 60_000) * 10) / 10,
    totalCommitMb: processes?.totalCommitMb ?? null,
    totalWorkingSetMb: processes?.totalWorkingSetMb ?? null,
    peakCommitMb: processes ? peak.commitMb : null,
    // Named so the log says which process to chase rather than only that something grew.
    biggestProcess: biggest ? `${biggest.name}#${biggest.pid}` : null,
    biggestProcessCommitMb: biggest?.commitMb ?? null,
    processCommitMb: processes?.processes.map((item) =>
      `${item.name}#${item.pid}:${item.commitMb}`).join(" ") ?? null,
  });
}

export function startMemoryReport(): void {
  void sampleMemory();
  window.setInterval(() => void sampleMemory(), SAMPLE_INTERVAL_MS);
  /*
   * Also on the way out of a page. Navigation is when a leak shows itself — anything the old
   * view failed to release is still held while the new one builds — and it is precisely what a
   * fixed interval misses.
   */
  window.addEventListener("pagehide", () => void sampleMemory());
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") void sampleMemory();
  });
}
