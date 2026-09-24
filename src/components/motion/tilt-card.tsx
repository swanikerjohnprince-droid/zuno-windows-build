"use client";
// beui.dev/components/motion/tilt-card

import { motion, useMotionTemplate, useMotionValue, useSpring } from "motion/react";
import { useEffect, useRef, useState, type ReactNode } from "react";
import { SPRING_MOUSE } from "@/lib/ease";
import { useHoverCapable } from "@/lib/hooks/use-hover-capable";
import { useReduceMotion } from "@/ui/settings/renderEffects";
import { cn } from "@/lib/utils";

export interface TiltCardProps {
  children: ReactNode;
  max?: number;
  glare?: boolean;
  className?: string;
}

/** How long the leave spring needs before the card is flat enough to stop compositing it. */
const SETTLE_MS = 500;

/**
 * Cursor-follow 3D tilt.
 *
 * Everything expensive here is scoped to the one card under the cursor, which is the whole
 * point: this is used on every album card, and the upstream component paid for the effect on
 * all of them at once, whether or not anyone was pointing at one.
 *
 *   - `will-change: transform` was in the permanent class list. That is a standing instruction
 *     to give the element its own compositor layer and hold a texture for it — so a home page
 *     of forty covers meant forty layers and forty textures, for a hover nobody was doing.
 *   - The identity `perspective() rotateX(0) rotateY(0)` and `transform-style: preserve-3d`
 *     were applied at rest too, and a 3D transform promotes on its own even at identity.
 *   - The glare was a mounted, painted, full-size radial gradient on every card, its opacity
 *     the only thing hiding it.
 *
 * At rest a card is now a plain rounded box. The springs and motion values still exist per
 * card — they are a few numbers each and cost nothing until something writes to them — but
 * nothing they produce reaches the DOM until the pointer arrives.
 */
export function TiltCard({ children, max = 12, glare = true, className }: TiltCardProps) {
  const ref = useRef<HTMLDivElement>(null);
  const reduce = useReduceMotion();
  const canHover = useHoverCapable();
  // Decorative cursor-follow: skip on touch (phantom hover) and reduced motion.
  const enabled = !reduce && canHover;
  const [tilting, setTilting] = useState(false);
  const settleTimerRef = useRef(0);
  /*
   * Measured once on enter rather than on every move. `getBoundingClientRect` flushes pending
   * layout, and doing that inside a mousemove handler is the classic way to turn a hover into
   * a per-frame reflow.
   *
   * ponytail: the rect goes stale if the page scrolls while the pointer sits still on a card,
   * which tilts it from a slightly wrong origin until the next enter. If that ever shows,
   * re-measure from a scroll listener on the page root rather than from the move handler.
   */
  const rectRef = useRef<DOMRect | null>(null);

  const rx = useMotionValue(0);
  const ry = useMotionValue(0);
  const gx = useMotionValue(50);
  const gy = useMotionValue(50);

  const srx = useSpring(rx, SPRING_MOUSE);
  const sry = useSpring(ry, SPRING_MOUSE);

  const transform = useMotionTemplate`perspective(1000px) rotateX(${srx}deg) rotateY(${sry}deg)`;
  const glareBg = useMotionTemplate`radial-gradient(circle at ${gx}% ${gy}%, var(--foreground), transparent 50%)`;

  useEffect(() => () => window.clearTimeout(settleTimerRef.current), []);

  const onEnter = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!enabled) return;
    window.clearTimeout(settleTimerRef.current);
    rectRef.current = e.currentTarget.getBoundingClientRect();
    setTilting(true);
  };

  const onMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = rectRef.current;
    if (!rect || !enabled) return;
    const px = (e.clientX - rect.left) / rect.width;
    const py = (e.clientY - rect.top) / rect.height;
    ry.set((px - 0.5) * max);
    rx.set((0.5 - py) * max);
    gx.set(px * 100);
    gy.set(py * 100);
  };

  const onLeave = () => {
    rx.set(0);
    ry.set(0);
    // The transform has to outlive the pointer: dropping it on leave would snap the card flat
    // instead of letting the spring bring it back.
    window.clearTimeout(settleTimerRef.current);
    settleTimerRef.current = window.setTimeout(() => setTilting(false), SETTLE_MS);
  };

  return (
    <motion.div
      ref={ref}
      onMouseEnter={onEnter}
      onMouseMove={onMove}
      onMouseLeave={onLeave}
      /*
       * The resting branch says `none` rather than dropping the keys. Motion writes the
       * transform to the element imperatively, so a style object that simply stops mentioning
       * it leaves the last value — and the layer it earned — sitting on the node forever.
       */
      style={tilting
        ? { transform, transformStyle: "preserve-3d", willChange: "transform" }
        : { transform: "none", transformStyle: "flat", willChange: "auto" }}
      className={cn("relative overflow-hidden rounded-2xl", className)}
    >
      {children}
      {glare && enabled && tilting ? (
        <motion.div
          aria-hidden
          style={{ background: glareBg }}
          className="pointer-events-none absolute inset-0 opacity-15"
        />
      ) : null}
    </motion.div>
  );
}
