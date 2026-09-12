/**
 * Debug overlay ("DevTools for Ads", bounding-box view).
 *
 * Purely presentational and read-only: it renders on top of the real elements
 * inside the exact same scaled coordinate space SurfaceStage already uses
 * (children of `.ale-surface`, which is transformed as one unit), so every box
 * lines up with the actual rendered element pixel-for-pixel at any scale —
 * there is no separate scale math to keep in sync.
 *
 * It reads no core/** internals beyond the already-public ResolvedElement and
 * DecisionTrace shapes:
 *  - the safe-area outline comes straight from `surface.safeArea`
 *  - "zone" is a geometric heuristic computed HERE from each element's resolved
 *    position relative to the usable box — the resolver has no zone concept,
 *    so this never touches candidates.ts/scoring.ts
 *  - "shrunk by N%" is parsed from the winning candidate's own plain-language
 *    trace notes (`trace.perElementNotes`) — the exact same strings the Layout
 *    Debugger panel already shows, not a second source of truth
 */

import type { ResolvedElement } from "../core/resolver";
import type { SurfaceProfile } from "../core/surfaces";
import type { DecisionTrace } from "../core/trace";

type Zone =
  | "top-left"
  | "top-right"
  | "bottom-left"
  | "bottom-right"
  | "top"
  | "bottom"
  | "left"
  | "right"
  | "center"
  | "full";

const ZONE_CLASS: Record<Zone, string> = {
  "top-left": "ale-dbg-z-tl",
  "top-right": "ale-dbg-z-tr",
  "bottom-left": "ale-dbg-z-bl",
  "bottom-right": "ale-dbg-z-br",
  top: "ale-dbg-z-top",
  bottom: "ale-dbg-z-bottom",
  left: "ale-dbg-z-left",
  right: "ale-dbg-z-right",
  center: "ale-dbg-z-center",
  full: "ale-dbg-z-full",
};

/** Fraction of box width/height an element's centre must clear to count as off-centre. */
const DEADZONE = 0.12;
/** Element-area / box-area above this counts as "full" regardless of position. */
const FULL_COVERAGE_THRESHOLD = 0.6;

interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

function classifyZone(el: ResolvedElement, box: Box): Zone {
  const boxArea = box.width * box.height;
  if (boxArea > 0 && (el.width * el.height) / boxArea > FULL_COVERAGE_THRESHOLD) {
    return "full";
  }

  const cx = el.x + el.width / 2;
  const cy = el.y + el.height / 2;
  const boxCx = box.x + box.width / 2;
  const boxCy = box.y + box.height / 2;

  const isLeft = cx < boxCx - box.width * DEADZONE;
  const isRight = cx > boxCx + box.width * DEADZONE;
  const isTop = cy < boxCy - box.height * DEADZONE;
  const isBottom = cy > boxCy + box.height * DEADZONE;

  if (isTop && isLeft) return "top-left";
  if (isTop && isRight) return "top-right";
  if (isBottom && isLeft) return "bottom-left";
  if (isBottom && isRight) return "bottom-right";
  if (isTop) return "top";
  if (isBottom) return "bottom";
  if (isLeft) return "left";
  if (isRight) return "right";
  return "center";
}

/** Matches trace.ts's shrinkNote() format exactly: "id: wanted WxH, placed at WxH → shrunk N%". */
const SHRUNK_NOTE_RE =
  /^(.+?): wanted [\d.]+×[\d.]+, placed at [\d.]+×[\d.]+ → shrunk (\d+)%$/;

function parseShrunkPercents(notes: readonly string[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const note of notes) {
    const m = SHRUNK_NOTE_RE.exec(note);
    if (m) out.set(m[1]!, Number(m[2]));
  }
  return out;
}

function usableBox(surface: SurfaceProfile): Box {
  const safe = surface.safeArea;
  if (!safe) return { x: 0, y: 0, width: surface.width, height: surface.height };
  return {
    x: safe.left,
    y: safe.top,
    width: surface.width - safe.left - safe.right,
    height: surface.height - safe.top - safe.bottom,
  };
}

export function DebugOverlay({
  surface,
  elements,
  trace,
}: {
  surface: SurfaceProfile;
  elements: ResolvedElement[];
  trace?: DecisionTrace | undefined;
}): JSX.Element {
  const box = usableBox(surface);
  const shrunkPercents = trace
    ? parseShrunkPercents(trace.perElementNotes)
    : new Map<string, number>();
  const visible = elements.filter((e) => e.visible);

  return (
    <div className="ale-dbg-overlay" data-testid="debug-overlay" aria-hidden="true">
      <div
        className="ale-dbg-safearea"
        style={{ left: box.x, top: box.y, width: box.width, height: box.height }}
      />
      {visible.map((el) => {
        const pct = shrunkPercents.get(el.id);
        const zone = classifyZone(el, box);
        return (
          <div
            key={el.id}
            className={`ale-dbg-box ${ZONE_CLASS[zone]} ${
              pct !== undefined ? "ale-dbg-box--shrunk" : "ale-dbg-box--natural"
            }`}
            data-testid="debug-box"
            data-element-id={el.id}
            data-zone={zone}
            style={{ left: el.x, top: el.y, width: el.width, height: el.height }}
          >
            <span className="ale-dbg-label">
              {el.id}
              {pct !== undefined ? ` ⚠${pct}%` : ""}
            </span>
          </div>
        );
      })}
    </div>
  );
}
