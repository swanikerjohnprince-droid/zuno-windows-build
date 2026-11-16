import { useEffect } from "react";
import { emit } from "@tauri-apps/api/event";
import { shallowEqual, usePlayerSelector } from "../../../player/playerStore";

/**
 * Mirrors volume and mute to the mini-player window.
 *
 * A component rather than an effect in `App` purely so the subscription lives at a leaf.
 * Volume is the most frequently written field in the player state — `applyVolume` commits on
 * every pointer move of the slider — and `App` reads it nowhere else. Subscribing to it up
 * there meant every drag re-rendered the root and, with it, the entire tree.
 *
 * Renders nothing. Its whole job is to own a noisy subscription somewhere harmless.
 */
export function VolumeSyncBridge() {
  const { volume, muted } = usePlayerSelector(
    (state) => ({ volume: state.volume, muted: state.muted }),
    shallowEqual,
  );

  useEffect(() => {
    void emit("player-volume-sync", { muted, volume });
  }, [muted, volume]);

  return null;
}
