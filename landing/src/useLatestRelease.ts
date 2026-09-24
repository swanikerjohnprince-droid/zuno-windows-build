import { useEffect, useState } from "react";
import { detectPlatform, fetchLatestRelease, type LatestRelease, type PlatformId } from "./releases";

/**
 * Everything the release page knows, in one hook.
 *
 * Shared by the hero's button and the download tiles, so the two can never disagree about which
 * version they are offering. Lives beside `releases.ts` rather than under `components/`, because
 * it renders nothing — it was previously called `Download.tsx`, one letter from `Downloads.tsx`,
 * which is exactly the kind of pair someone edits the wrong half of.
 */
export function useLatestRelease() {
  const [release, setRelease] = useState<LatestRelease | null>(null);
  const [failed, setFailed] = useState(false);
  const [platform, setPlatform] = useState<PlatformId | null>(null);

  useEffect(() => {
    setPlatform(detectPlatform());

    const controller = new AbortController();
    fetchLatestRelease(controller.signal)
      .then(setRelease)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === "AbortError") return;
        setFailed(true);
      });
    return () => controller.abort();
  }, []);

  return { release, failed, platform };
}
