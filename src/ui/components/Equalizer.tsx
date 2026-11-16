import {
  type FormEvent,
  type KeyboardEvent,
  type MouseEvent,
  type PointerEvent,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { RangeSlider } from "@/components/motion/range-slider";
import { Tooltip } from "@/components/motion/tooltip";
import { SPRING_LAYOUT, SPRING_PRESS } from "@/lib/ease";
import { cn } from "@/lib/utils";
import { PencilIcon, SaveIcon, TrashIcon } from "@/ui/icons";
import {
  activeEqualizerPreset,
  deleteEqualizerPreset,
  EQUALIZER_CUSTOM_NAME,
  EQUALIZER_PRESET_NAME_MAX,
  equalizerPresetNameError,
  getEqualizer,
  isExistingEqualizerPreset,
  renameEqualizerPreset,
  saveEqualizerPreset,
  setEqualizer,
  suggestEqualizerPresetName,
  useEqualizer,
  useEqualizerCustom,
  useEqualizerEnabled,
  useEqualizerUserPresets,
} from "../settings/equalizer";
import {
  autoPreampDb,
  CURVE_HZ,
  EQUALIZER_BANDS_HZ,
  EQUALIZER_MAX_DB,
  EQUALIZER_PRESETS,
  EQUALIZER_STEP_DB,
  frequencyPosition,
  responseCurveDb,
  snapGain,
} from "../settings/equalizerCurve";

const BAND_COUNT = EQUALIZER_BANDS_HZ.length;

/** What each band is for. "250 Hz" means nothing to most people; "Warmth" does. */
const BAND_ROLES = ["Sub", "Bass", "Punch", "Warmth", "Body", "Mids", "Bite", "Presence", "Clarity", "Air"];

/** Wider than a band's ±12 dB: neighbouring boosts stack past it (ten at +12 peak near +18). */
const DISPLAY_DB = 15;
const GRID_DB = [12, 6, 0, -6, -12];

/** How near a node, vertically, a press has to land to grab it instead of drawing. */
const GRAB_RADIUS_PX = 14;

const KEY_GAIN: Partial<Record<string, (gain: number) => number>> = {
  ArrowUp: (gain) => gain + EQUALIZER_STEP_DB,
  ArrowDown: (gain) => gain - EQUALIZER_STEP_DB,
  PageUp: (gain) => gain + 3,
  PageDown: (gain) => gain - 3,
  Home: () => -EQUALIZER_MAX_DB,
  End: () => EQUALIZER_MAX_DB,
  Delete: () => 0,
  Backspace: () => 0,
  "0": () => 0,
};

const shortHz = (hz: number) => (hz >= 1000 ? `${hz / 1000}k` : String(hz));
const spokenHz = (hz: number) => (hz >= 1000 ? `${hz / 1000} kHz` : `${hz} Hz`);

/** "+3.5", "0", "−2" — a real minus sign, and never "+0". */
const formatDb = (db: number) => (db === 0 ? "0" : `${db > 0 ? "+" : "−"}${Math.abs(db)}`);

/** Percent down the plot. Clamped, so a curve beyond the range runs along the frame. */
const yOf = (db: number) => 50 - (Math.max(-DISPLAY_DB, Math.min(DISPLAY_DB, db)) / DISPLAY_DB) * 50;

const CURVE_X = CURVE_HZ.map((hz) => (frequencyPosition(hz) * 100).toFixed(2));

/** Path in the plot's 0–100 viewBox. Fixed point count and format, so motion can morph between curves. */
function curvePath(curve: readonly number[]): string {
  return curve
    .map((db, index) => `${index === 0 ? "M" : "L"}${CURVE_X[index]},${yOf(db).toFixed(2)}`)
    .join("");
}

function locate(surface: Element, clientX: number, clientY: number) {
  const rect = surface.getBoundingClientRect();
  const column = Math.floor(((clientX - rect.left) / rect.width) * BAND_COUNT);
  const half = rect.height / 2;
  return {
    band: Math.min(BAND_COUNT - 1, Math.max(0, column)),
    gain: snapGain(((rect.top + half - clientY) / half) * DISPLAY_DB),
    rect,
  };
}

/** Several band changes as one update, so a sweep across five columns is one push to Rust. */
function setBands(changes: ReadonlyArray<readonly [band: number, gain: number]>) {
  const current = getEqualizer();
  const bandsDb = current.bandsDb.slice();
  for (const [band, gain] of changes) bandsDb[band] = gain;
  setEqualizer({ ...current, bandsDb });
}

// Press a node to grab it (moves relative, no jump); press elsewhere to draw bands at the pointer's height.
type Gesture =
  | { kind: "grab"; band: number; startY: number; startGain: number }
  | { kind: "draw"; band: number; gain: number };

/**
 * The equaliser as a draggable frequency-response graph: the real filter response, not a line
 * through the nodes. Red above the dashed line is what the preamp hasn't made room for.
 */
export function EqualizerGraph({ compact = false, disabled = false }: { compact?: boolean; disabled?: boolean }) {
  const { bandsDb, preampDb } = useEqualizer();
  const enabled = useEqualizerEnabled();
  const reduceMotion = useReducedMotion();
  const gesture = useRef<Gesture | null>(null);
  const nodes = useRef<Array<HTMLDivElement | null>>([]);
  const [dragBand, setDragBand] = useState<number | null>(null);
  const [grabbing, setGrabbing] = useState(false);
  const [hoverBand, setHoverBand] = useState<number | null>(null);
  const [keyboardBand, setKeyboardBand] = useState<number | null>(null);
  /** Roving tab stop: the one node the graph can be focused through. */
  const [tabBand, setTabBand] = useState(0);
  // `url(#…)` has to survive useId's punctuation, which differs between React versions.
  const svgId = `eq${useId().replace(/[^\w-]/g, "")}`;

  const line = useMemo(() => curvePath(responseCurveDb(bandsDb)), [bandsDb]);
  const ceilingY = yOf(-preampDb);
  const shownBand = disabled ? null : (dragBand ?? keyboardBand ?? hoverBand);
  // Instant under the pointer (a trailing node feels broken); a glide for presets, keys and Auto.
  const glide = dragBand !== null || reduceMotion ? { duration: 0 } : SPRING_LAYOUT;

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return;
    // Also keeps the press from moving focus to the page, so the node focused below keeps it.
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    const { band, gain, rect } = locate(event.currentTarget, event.clientX, event.clientY);
    const current = getEqualizer().bandsDb[band];
    const nodeY = rect.top + (yOf(current) / 100) * rect.height;
    const grab = Math.abs(event.clientY - nodeY) <= GRAB_RADIUS_PX;
    gesture.current = grab
      ? { kind: "grab", band, startY: event.clientY, startGain: current }
      : { kind: "draw", band, gain };
    if (!grab) setBands([[band, gain]]);
    setDragBand(band);
    setGrabbing(grab);
    // So the arrow keys fine-tune whichever band was touched last.
    nodes.current[band]?.focus({ preventScroll: true });
  };

  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const { band, gain, rect } = locate(event.currentTarget, event.clientX, event.clientY);
    const current = gesture.current;
    if (!current) {
      if (event.pointerType === "mouse") setHoverBand(band);
      return;
    }
    if (current.kind === "grab") {
      const moved = ((current.startY - event.clientY) / (rect.height / 2)) * DISPLAY_DB;
      setBands([[current.band, snapGain(current.startGain + moved)]]);
      return;
    }
    // Interpolate across columns skipped since the last move, so a fast sweep leaves no gaps.
    const changes: Array<[number, number]> = [];
    const direction = band >= current.band ? 1 : -1;
    for (let crossed = current.band; crossed !== band + direction; crossed += direction) {
      const t = band === current.band ? 1 : (crossed - current.band) / (band - current.band);
      changes.push([crossed, snapGain(current.gain + (gain - current.gain) * t)]);
    }
    setBands(changes);
    gesture.current = { kind: "draw", band, gain };
    setDragBand(band);
  };

  const endGesture = () => {
    gesture.current = null;
    setDragBand(null);
    setGrabbing(false);
  };

  // Flattens the band under the pointer.
  const onDoubleClick = (event: MouseEvent<HTMLDivElement>) => {
    if (disabled) return;
    setBands([[locate(event.currentTarget, event.clientX, event.clientY).band, 0]]);
  };

  const onNodeKeyDown = (event: KeyboardEvent<HTMLDivElement>, band: number) => {
    // Modified arrows are the app's own shortcuts (track skip, back and forward).
    if (disabled || event.altKey || event.ctrlKey || event.metaKey) return;
    if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
      event.preventDefault();
      const next = band + (event.key === "ArrowLeft" ? -1 : 1);
      if (next < 0 || next >= BAND_COUNT) return;
      nodes.current[next]?.focus();
      setKeyboardBand(next);
      return;
    }
    const adjust = KEY_GAIN[event.key];
    if (!adjust) return;
    event.preventDefault();
    setKeyboardBand(band);
    setBands([[band, snapGain(adjust(getEqualizer().bandsDb[band]))]]);
  };

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex gap-2">
        {!compact && (
          <div className="relative w-6 shrink-0" aria-hidden="true">
            {GRID_DB.map((db) => (
              <span
                key={db}
                className="absolute right-0 -translate-y-1/2 text-[10px] tabular-nums text-muted-foreground"
                style={{ top: `${yOf(db)}%` }}
              >
                {formatDb(db)}
              </span>
            ))}
          </div>
        )}

        <div
          role="group"
          aria-label="Equaliser bands"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={endGesture}
          onPointerCancel={endGesture}
          onPointerLeave={() => setHoverBand(null)}
          onDoubleClick={onDoubleClick}
          className={cn(
            "relative min-w-0 flex-1 touch-none select-none rounded-xl bg-background/40",
            compact ? "h-24" : "h-52",
            disabled ? "pointer-events-none" : grabbing ? "cursor-grabbing" : "cursor-crosshair",
          )}
        >
          {GRID_DB.map((db) => (
            <div
              key={db}
              aria-hidden="true"
              className={cn(
                "pointer-events-none absolute inset-x-0 h-px",
                db === 0 ? "bg-foreground/15" : "bg-foreground/5",
              )}
              style={{ top: `${yOf(db)}%` }}
            />
          ))}
          {EQUALIZER_BANDS_HZ.map((hz) => (
            <div
              key={hz}
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-px bg-foreground/5"
              style={{ left: `${frequencyPosition(hz) * 100}%` }}
            />
          ))}

          {shownBand !== null && (
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-y-0 w-[10%] rounded-lg bg-foreground/5"
              initial={false}
              animate={{ left: `${shownBand * 10}%` }}
              transition={reduceMotion ? { duration: 0 } : SPRING_LAYOUT}
            />
          )}

          <svg
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 size-full overflow-visible text-foreground"
          >
            <defs>
              <linearGradient id={`${svgId}-fill`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2="0" y2="100">
                <stop offset="0" stopColor="currentColor" stopOpacity="0.2" />
                <stop offset="0.5" stopColor="currentColor" stopOpacity="0" />
                <stop offset="1" stopColor="currentColor" stopOpacity="0.2" />
              </linearGradient>
              <clipPath id={`${svgId}-over`}>
                <motion.rect
                  x="0"
                  y="-10"
                  width="100"
                  initial={false}
                  animate={{ height: ceilingY + 10 }}
                  transition={glide}
                />
              </clipPath>
            </defs>
            <motion.path
              fill={`url(#${svgId}-fill)`}
              initial={false}
              animate={{ d: `${line}L100,50L0,50Z` }}
              transition={glide}
            />
            <motion.path
              className="fill-none stroke-foreground"
              strokeWidth={2}
              strokeLinejoin="round"
              vectorEffect="non-scaling-stroke"
              initial={false}
              animate={{ d: line }}
              transition={glide}
            />
            {/* Bypassed, nothing reaches the limiter, so there is nothing to warn about. */}
            {enabled && (
              <g clipPath={`url(#${svgId}-over)`}>
                <motion.path
                  className="fill-primary/25"
                  initial={false}
                  animate={{ d: `${line}L100,${ceilingY.toFixed(2)}L0,${ceilingY.toFixed(2)}Z` }}
                  transition={glide}
                />
                <motion.path
                  className="fill-none stroke-primary"
                  strokeWidth={2}
                  strokeLinejoin="round"
                  vectorEffect="non-scaling-stroke"
                  initial={false}
                  animate={{ d: line }}
                  transition={glide}
                />
              </g>
            )}
          </svg>

          {/* Ceiling: 0 dB out after the preamp. */}
          {enabled && (
            <motion.div
              aria-hidden="true"
              className="pointer-events-none absolute inset-x-0 border-t border-dashed border-foreground/30"
              initial={false}
              animate={{ top: `${ceilingY}%` }}
              transition={glide}
            />
          )}

          {EQUALIZER_BANDS_HZ.map((hz, band) => {
            const gain = bandsDb[band];
            return (
              <motion.div
                key={hz}
                ref={(node) => {
                  nodes.current[band] = node;
                }}
                role="slider"
                tabIndex={!disabled && band === tabBand ? 0 : -1}
                aria-label={`${spokenHz(hz)}, ${BAND_ROLES[band]}`}
                aria-orientation="vertical"
                aria-valuemin={-EQUALIZER_MAX_DB}
                aria-valuemax={EQUALIZER_MAX_DB}
                aria-valuenow={gain}
                aria-valuetext={`${formatDb(gain)} dB`}
                aria-disabled={disabled || undefined}
                onKeyDown={(event) => onNodeKeyDown(event, band)}
                onFocus={() => setTabBand(band)}
                onBlur={() => setKeyboardBand(null)}
                initial={false}
                animate={{ top: `${yOf(gain)}%`, scale: band === shownBand ? 1.4 : 1 }}
                transition={{ top: glide, scale: reduceMotion ? { duration: 0 } : SPRING_PRESS }}
                style={{ left: `${frequencyPosition(hz) * 100}%` }}
                className={cn(
                  "absolute -translate-x-1/2 -translate-y-1/2 rounded-full shadow-sm transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
                  compact ? "size-2.5" : "size-3",
                  gain === 0 ? "bg-muted-foreground" : "bg-foreground",
                  !grabbing && "cursor-grab",
                )}
              />
            );
          })}

          <AnimatePresence>
            {shownBand !== null && (
              <BandReadout key="readout" band={shownBand} gain={bandsDb[shownBand]} compact={compact} />
            )}
          </AnimatePresence>
        </div>
      </div>

      <div className="flex gap-2" aria-hidden="true">
        {!compact && <span className="w-6 shrink-0" />}
        <div className="grid min-w-0 flex-1 grid-cols-10">
          {EQUALIZER_BANDS_HZ.map((hz, band) => (
            <span
              key={hz}
              className={cn(
                "text-center tabular-nums transition-colors",
                compact ? "text-[9px]" : "text-[11px]",
                band === shownBand ? "font-medium text-foreground" : "text-muted-foreground",
              )}
            >
              {shortHz(hz)}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}

function BandReadout({ band, gain, compact }: { band: number; gain: number; compact: boolean }) {
  const hz = EQUALIZER_BANDS_HZ[band];
  const x = frequencyPosition(hz) * 100;
  return (
    <motion.div
      aria-hidden="true"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.12 }}
      // Shifted back by its own width in proportion, so end-band readouts stay inside the plot.
      style={{ left: `${x}%`, x: `-${x}%` }}
      className={cn(
        "pointer-events-none absolute z-10 whitespace-nowrap rounded-lg bg-popover px-2 py-1 shadow-lg",
        // Out of the node's way: below the zero line for a boost, above it otherwise.
        gain > 0 ? "bottom-1.5" : "top-1.5",
      )}
    >
      {compact ? (
        <span className="text-[10px] font-medium tabular-nums text-foreground">
          {shortHz(hz)} · {formatDb(gain)} dB
        </span>
      ) : (
        <>
          <span className="block text-[10px] text-muted-foreground">
            {spokenHz(hz)} · {BAND_ROLES[band]}
          </span>
          <span className="block text-sm font-semibold tabular-nums text-foreground">
            {formatDb(gain)} dB
          </span>
        </>
      )}
    </motion.div>
  );
}

/** Built-ins, the user's presets, then Custom — lit exactly when nothing else is. `children` end the row. */
export function EqualizerPresets({
  compact = false,
  disabled = false,
  children,
}: {
  compact?: boolean;
  disabled?: boolean;
  children?: ReactNode;
}) {
  const equalizer = useEqualizer();
  const userPresets = useEqualizerUserPresets();
  const custom = useEqualizerCustom();
  const reduceMotion = useReducedMotion();
  const pillId = useId();
  const active = activeEqualizerPreset(equalizer, userPresets);

  const chip = (name: string, isActive: boolean, onSelect: () => void) => (
    <button
      key={name}
      type="button"
      aria-pressed={isActive}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        "relative rounded-full font-medium transition-colors",
        "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring",
        compact ? "px-2 py-0.5 text-[10px]" : "px-3 py-1 text-xs",
        isActive
          ? "text-primary-foreground"
          : compact
            ? "bg-card text-foreground hover:bg-muted"
            : "bg-background/40 text-foreground hover:bg-card",
      )}
    >
      {/* One pill, handed between chips, so switching presets reads as a single motion. */}
      {isActive && (
        <motion.span
          layoutId={pillId}
          className="absolute inset-0 rounded-full bg-primary"
          transition={reduceMotion ? { duration: 0 } : SPRING_LAYOUT}
        />
      )}
      <span className="relative">{name}</span>
    </button>
  );

  return (
    <div role="group" aria-label="Equaliser presets" className="flex flex-wrap items-center gap-1.5">
      {[...EQUALIZER_PRESETS, ...userPresets].map((preset) =>
        chip(preset.name, preset === active, () => setEqualizer(preset.settings)),
      )}
      {custom !== null && !activeEqualizerPreset(custom, userPresets)
        && chip(EQUALIZER_CUSTOM_NAME, active === undefined, () => setEqualizer(custom))}
      {children}
    </div>
  );
}

type Editing = { mode: "save" } | { mode: "rename"; from: string };

const ROW_BUTTON =
  "flex h-7 items-center gap-1.5 rounded-full text-xs font-medium text-muted-foreground transition-colors hover:bg-card hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

/** Actions for the lit chip: save Custom, or rename/delete a user preset. Built-ins have none. */
function EqualizerPresetActions() {
  const equalizer = useEqualizer();
  const userPresets = useEqualizerUserPresets();
  const [editing, setEditing] = useState<Editing | null>(null);
  const active = activeEqualizerPreset(equalizer, userPresets);
  const activeUserPreset = active && userPresets.includes(active) ? active : undefined;

  // Close the editor if the chip it was opened for is no longer the lit one.
  if (editing && (editing.mode === "save" ? active !== undefined : activeUserPreset?.name !== editing.from)) {
    setEditing(null);
  }

  if (editing) {
    return (
      <PresetNameEditor
        renaming={editing.mode === "rename" ? editing.from : undefined}
        onDone={() => setEditing(null)}
      />
    );
  }

  if (!active) {
    return (
      <button type="button" onClick={() => setEditing({ mode: "save" })} className={cn(ROW_BUTTON, "px-3")}>
        <SaveIcon size={14} aria-hidden="true" />
        Save as preset
      </button>
    );
  }

  if (!activeUserPreset) return null;
  const { name } = activeUserPreset;
  return (
    <span className="flex items-center">
      <Tooltip content="Rename">
        <button
          type="button"
          aria-label={`Rename ${name}`}
          onClick={() => setEditing({ mode: "rename", from: name })}
          className={cn(ROW_BUTTON, "w-7 justify-center")}
        >
          <PencilIcon size={14} aria-hidden="true" />
        </button>
      </Tooltip>
      <Tooltip content="Delete — the curve stays as Custom">
        <button
          type="button"
          aria-label={`Delete ${name}`}
          onClick={() => deleteEqualizerPreset(name)}
          className={cn(ROW_BUTTON, "w-7 justify-center hover:text-destructive")}
        >
          <TrashIcon size={14} aria-hidden="true" />
        </button>
      </Tooltip>
    </span>
  );
}

function PresetNameEditor({ renaming, onDone }: { renaming?: string; onDone: () => void }) {
  const [name, setName] = useState(() => renaming ?? suggestEqualizerPresetName());
  const errorId = useId();
  const error = equalizerPresetNameError(name, renaming);
  // Saving under a taken name updates that preset; the button says so.
  const replaces = renaming === undefined && isExistingEqualizerPreset(name);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (error) return;
    if (renaming === undefined) saveEqualizerPreset(name);
    else renameEqualizerPreset(renaming, name);
    onDone();
  };

  return (
    <form onSubmit={submit} className="flex flex-wrap items-center gap-1.5">
      <input
        autoFocus
        value={name}
        maxLength={EQUALIZER_PRESET_NAME_MAX}
        onChange={(event) => setName(event.target.value)}
        onFocus={(event) => event.currentTarget.select()}
        onKeyDown={(event) => {
          if (event.key !== "Escape") return;
          event.preventDefault();
          onDone();
        }}
        aria-label={renaming ? `New name for ${renaming}` : "Preset name"}
        aria-invalid={error !== null}
        aria-describedby={error ? errorId : undefined}
        className="h-7 w-36 rounded-full bg-background px-3 text-xs text-foreground placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      />
      <button
        type="submit"
        disabled={error !== null}
        className="h-7 rounded-full bg-primary px-3 text-xs font-medium text-primary-foreground transition-opacity disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {renaming !== undefined ? "Rename" : replaces ? "Replace" : "Save"}
      </button>
      <button type="button" onClick={onDone} className={cn(ROW_BUTTON, "px-3")}>
        Cancel
      </button>
      {error && (
        <span id={errorId} role="status" className="text-xs text-destructive">
          {error}
        </span>
      )}
    </form>
  );
}

/** Preamp, and the headroom left at the curve's peak. Over 0 dB is flagged like the graph's red. */
function EqualizerPreamp({ disabled }: { disabled: boolean }) {
  const { bandsDb, preampDb } = useEqualizer();
  const enabled = useEqualizerEnabled();
  const peak = useMemo(() => Math.max(...responseCurveDb(bandsDb)), [bandsDb]);
  const auto = useMemo(() => autoPreampDb(bandsDb), [bandsDb]);
  const out = peak + preampDb;
  const over = enabled && out > 0.05;
  const setPreamp = (next: number) => setEqualizer({ ...getEqualizer(), preampDb: next });

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-3">
        <span className="w-14 shrink-0 text-sm font-medium text-foreground">Preamp</span>
        <RangeSlider
          className="min-w-0 flex-1"
          value={preampDb}
          min={-EQUALIZER_MAX_DB}
          max={EQUALIZER_MAX_DB}
          step={EQUALIZER_STEP_DB}
          showTicks={false}
          disabled={disabled}
          onValueChange={setPreamp}
          aria-label="Preamp in decibels"
        />
        <span className="w-14 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
          {formatDb(preampDb)} dB
        </span>
        <Tooltip content="Set it so the loudest point lands at 0 dB">
          <button
            type="button"
            disabled={disabled || auto === preampDb}
            onClick={() => setPreamp(auto)}
            className={cn(
              ROW_BUTTON,
              "px-3 text-foreground disabled:pointer-events-none disabled:opacity-50",
              over ? "bg-primary/15 hover:bg-primary/25" : "bg-background/40",
            )}
          >
            Auto
          </button>
        </Tooltip>
      </div>
      <p className={cn("pl-[4.25rem] text-xs tabular-nums", over ? "text-primary" : "text-muted-foreground")}>
        {!enabled
          ? "Bypassed — the track plays untouched."
          : over
            ? `Peaks ${out.toFixed(1)} dB over — the limiter is holding it back.`
            : `${Math.abs(out).toFixed(1)} dB of headroom.`}
      </p>
    </div>
  );
}

/** The whole equaliser, as the Settings card lays it out. */
export function EqualizerPanel({ disabled }: { disabled: boolean }) {
  const enabled = useEqualizerEnabled();
  return (
    <div className={cn("flex flex-col gap-4", disabled ? "opacity-50" : !enabled && "opacity-60")}>
      <EqualizerPresets disabled={disabled}>{!disabled && <EqualizerPresetActions />}</EqualizerPresets>
      <EqualizerGraph disabled={disabled} />
      <EqualizerPreamp disabled={disabled} />
      <p className="text-xs text-muted-foreground">
        Changes play as you make them. Drag a point, or sweep across the graph to draw a curve;
        double-click a band to flatten it. Anything over the dashed line is held back by the
        limiter — lower the preamp, or let Auto do it.
      </p>
    </div>
  );
}
