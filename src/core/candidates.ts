/**
 * Candidate layout generation.
 *
 * generateCandidates() turns one (graph, context, surface) into several fully
 * resolved candidate layouts, each built by a DIFFERENT spatial strategy. The
 * resolver then scores every candidate and keeps the best one.
 *
 * ── SURFACE-AGNOSTIC GUARANTEE ─────────────────────────────────────────────
 * This file contains ZERO references to any specific surface id and ZERO
 * references to any specific ad-element id. Every strategy is parameterised
 * purely by the surface's numeric width / height / safeArea insets and by each
 * element's role, priority and size constraints. The same four strategy
 * functions run for every surface, with no per-surface branching.
 * (resolver.test.ts enforces this with a source-level regex check.)
 */

import type { Context } from "./context";
import type { ExperienceGraph, GraphNode } from "./graph";
import type { SizeConstraint } from "./spec";
import type { SurfaceProfile } from "./surfaces";
import type { ResolvedElement } from "./resolver";
import { measureTextWidth } from "./text-measure";

/** Font size assumed when a text element declares none. */
const DEFAULT_FONT_SIZE = 16;
const LINE_HEIGHT_FACTOR = 1.3;

/**
 * §4.3-context: far-viewing surfaces need bigger type to stay legible from
 * across a room, so text/button elements ask for more room up front — which in
 * turn makes them more likely to shrink or push out lower-priority content, the
 * "fewer, larger elements" behaviour the project plan calls for on a billboard.
 */
const FAR_VIEWING_TEXT_SCALE = 1.3;

/**
 * §4.3-context / §4.14: a touch-only surface needs a genuinely bigger CTA, not
 * just one that clears the tap-target floor — this is what "larger CTA,
 * interactive affordances" means for a phone versus a remote-driven TV.
 */
const TOUCH_TARGET_SCALE = 1.15;

/**
 * "Grow into slack" (see ARCHITECTURE.md §4c) — an element on an axis the
 * strategy marks growable may size up beyond its preferred size when its slot
 * offers more room, instead of only ever shrinking toward it. Capped at a
 * fixed multiple of PREFERRED (not "fill the whole slot") so a small CTA on a
 * huge broadcast surface becomes a nicely-sized button, not an edge-to-edge
 * bar — and relative to each element's own preferred, so two elements with
 * different preferred sizes (e.g. far-viewing vs. near) still end up
 * different sizes rather than both maxing out at the same slot ceiling.
 */
const GROWTH_CAP_FACTOR = 1.4;

/**
 * §7.9 (found via live measurement): with every non-locked element growing at
 * the SAME 1.4x cap, a text element with a generously-declared
 * `preferredSize.height` (the headline, meant to leave room to wrap to two
 * lines) could grow to rival or edge out the product photo's own area on a
 * strategy that grows both axes (`grid`) — measured live on a wide phone
 * surface: headline 29% of the ad's area vs. the photo's 39.8%, a real but
 * uncomfortably thin margin for something meant to read as "the highlight."
 * The hero role gets a larger growth ceiling than everything else so it stays
 * clearly, comfortably the largest element whenever a strategy lets anything
 * grow at all — this is a bonus on top of its own preferred size, not a
 * penalty on any other element, so it never fights `visualBalance` or the
 * shrink cascade.
 */
const HERO_GROWTH_CAP_FACTOR = 1.9;

export type CandidateStrategy =
  | "vertical-stack"
  | "horizontal-split"
  | "overlay-safe-margins"
  | "grid"
  | "emergency-fit";

export interface Candidate {
  strategy: CandidateStrategy;
  elements: ResolvedElement[];
  /**
   * Plain-language notes for every element this strategy had to shrink or drop.
   * trace.ts surfaces the WINNING candidate's notes as
   * DecisionTrace.perElementNotes.
   */
  notes: string[];
}

/** Fallback preferred size when a node declares neither preferred nor min. */
const FALLBACK_PREFERRED: SizeConstraint = { width: 320, height: 50 };

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Usable region: the surface minus its safeArea insets, if any. */
export function availableBox(surface: SurfaceProfile): Box {
  const safe = surface.safeArea;
  if (safe === undefined) {
    return { x: 0, y: 0, width: surface.width, height: surface.height };
  }
  return {
    x: safe.left,
    y: safe.top,
    width: surface.width - safe.left - safe.right,
    height: surface.height - safe.top - safe.bottom,
  };
}

/** Axis-aligned overlap. Touching edges do NOT count as overlapping. */
export function boxesOverlap(a: ResolvedElement, b: ResolvedElement): boolean {
  return (
    a.x < b.x + b.width &&
    a.x + a.width > b.x &&
    a.y < b.y + b.height &&
    a.y + a.height > b.y
  );
}

const EPS = 0.001;

function withinBox(el: ResolvedElement, box: Box): boolean {
  return (
    el.x >= box.x - EPS &&
    el.y >= box.y - EPS &&
    el.x + el.width <= box.x + box.width + EPS &&
    el.y + el.height <= box.y + box.height + EPS
  );
}

interface PlacementRequest {
  id: string;
  role: string;
  priority: number;
  preferred: SizeConstraint;
  min: SizeConstraint;
  /** brandRules.locked — never resized away from `preferred`, growth included. */
  locked: boolean;
  /**
   * interaction === "clickable" — exempt from HEIGHT growth only (see the
   * `canGrowHeight` check in `placeElementsInOrder`). A clickable element's
   * size is already a deliberate, purposeful number (touch-target scale + the
   * surface's real minTapTarget, both applied above in this function) —
   * piling the generic slack-growth multiplier on top of THAT on the height
   * axis produced a real, visible bug: a CTA whose preferred shape is a wide
   * short pill (e.g. 138×65) growing height by 40% on horizontal-split's free
   * axis became a squat, disproportionate blob, because growth treats
   * width/height as independent axes with no notion that a button should keep
   * looking like a button. WIDTH growth has no such failure mode — a button
   * getting wider while its height stays fixed is exactly what a normal,
   * full-looking CTA looks like — so clickable elements grow normally on
   * width (this is what lets the CTA fill horizontal slack on vertical-stack
   * instead of sitting as an undersized pill next to dead space).
   */
  interactive: boolean;
  /** visibility === "always" — see `emergencyFit` / `EMERGENCY_MIN_SIZE`. */
  alwaysVisible: boolean;
}

function toRequest(
  node: GraphNode,
  context: Context,
  surface: SurfaceProfile,
): PlacementRequest {
  let preferred = node.preferredSize ?? node.minSize ?? FALLBACK_PREFERRED;

  // Phase 5: when a text/button element carries its literal string, size it from
  // a real measureText() pass instead of the fixed preferredSize guess. This is
  // what lets a long or translated headline be laid out from its true width.
  if (
    (node.type === "text" || node.type === "button") &&
    node.text !== undefined
  ) {
    const fontSize = node.fontSize ?? DEFAULT_FONT_SIZE;
    const measuredWidth = Math.ceil(measureTextWidth(node.text, fontSize));
    const lineHeight = Math.ceil(fontSize * LINE_HEIGHT_FACTOR);
    preferred = {
      // BUG FIX: this used to omit `node.preferredSize?.width` entirely — only
      // the measured text width and minSize.width were ever considered, so a
      // short string (e.g. a 4-letter brand mark like "DIOR") collapsed to
      // whatever `measureTextWidth` returned for its literal characters, with
      // no way for the ad author's own declared preferredSize.width to ever
      // win. The height branch two lines below already folded in
      // `preferredSize.height` — width was the one axis silently ignoring it,
      // which is what made a `preferredSize: {width:96,...}` logo render at
      // ~42px (illegibly small) and a `preferredSize: {width:200,...}` CTA
      // collapse toward its 120px minSize instead of its intended 200px.
      width: Math.max(
        measuredWidth,
        node.minSize?.width ?? 0,
        node.preferredSize?.width ?? 0,
      ),
      height: Math.max(
        lineHeight,
        node.minSize?.height ?? 0,
        node.preferredSize?.height ?? 0,
      ),
    };
  }

  // §4.3-context: far-viewing legibility. Only text/button carry rendered type,
  // so only they inflate — an image's preferred size already IS its intended
  // on-screen size, not a proxy for something else that should grow.
  if (context.isFarViewing && (node.type === "text" || node.type === "button")) {
    preferred = {
      width: Math.ceil(preferred.width * FAR_VIEWING_TEXT_SCALE),
      height: Math.ceil(preferred.height * FAR_VIEWING_TEXT_SCALE),
    };
  }

  // §4.3-context / §4.14: touch surfaces ask for a bigger interactive target,
  // not just the surface-declared floor — this is what makes a phone CTA
  // visibly more prominent than the same CTA on a remote-driven broadcast.
  if (context.isTouchInteractive && node.interaction === "clickable") {
    preferred = {
      width: Math.ceil(preferred.width * TOUCH_TARGET_SCALE),
      height: Math.ceil(preferred.height * TOUCH_TARGET_SCALE),
    };
  }

  // A flat percentage bump above is a reasonable DEFAULT, but it is blind to
  // what the surface actually requires — a surface with a demanding
  // minTapTarget (some touch kiosks/accessibility profiles ask for 80–96px)
  // would still get scored as non-compliant even though the request never
  // once asked for enough room to comply. Once the surface states a real
  // number, a clickable element's REQUEST should target it directly — the
  // scorer (constraintViolationsScore / tapTargetComplianceScore) is the
  // right place to grade whether it was actually met, not the only place the
  // requirement is ever consulted.
  if (node.interaction === "clickable" && surface.minTapTarget !== undefined) {
    preferred = {
      width: Math.max(preferred.width, surface.minTapTarget),
      height: Math.max(preferred.height, surface.minTapTarget),
    };
  }

  const min = node.minSize ?? preferred;
  return {
    id: node.id,
    role: node.role,
    priority: node.priority,
    preferred,
    min,
    locked: node.brandRules?.locked === true,
    interactive: node.interaction === "clickable",
    alwaysVisible: node.visibility === "always",
  };
}

/** Canonical resolution order: priority ascending, id ascending to break ties. */
function orderedRequests(
  graph: ExperienceGraph,
  context: Context,
  surface: SurfaceProfile,
): PlacementRequest[] {
  return [...graph.nodes]
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((node) => toRequest(node, context, surface));
}

/**
 * A strategy supplies, for the Nth element in priority order, the rectangular
 * SLOT it may occupy (top-left position + maximum size). Returning null means
 * "no slot for this one" → it and every lower-priority element after it are
 * dropped. Placement is therefore a strict, priority-monotone cascade: a
 * higher-priority element never loses its place to a lower-priority one.
 */
type StrategyLayoutFn = (args: {
  order: number;
  placedCount: number;
  request: PlacementRequest;
  available: Box;
  placed: ResolvedElement[];
}) => { x: number; y: number; maxWidth: number; maxHeight: number } | null;

export interface PlacementOutcome {
  elements: ResolvedElement[];
  notes: string[];
}

function droppedElement(r: PlacementRequest): ResolvedElement {
  return { id: r.id, x: 0, y: 0, width: 0, height: 0, visible: false, role: r.role };
}

function dropNote(r: PlacementRequest): string {
  return (
    `${r.id}: dropped — priority ${r.priority}, ` +
    `no room left once every higher-priority element was placed`
  );
}

function shrinkNote(r: PlacementRequest, w: number, h: number): string {
  const before = r.preferred.width * r.preferred.height;
  const after = w * h;
  const pct = before > 0 ? Math.round((1 - after / before) * 100) : 0;
  return (
    `${r.id}: wanted ${r.preferred.width}×${r.preferred.height}, ` +
    `placed at ${Math.round(w)}×${Math.round(h)} → shrunk ${pct}%`
  );
}

function growNote(r: PlacementRequest, w: number, h: number): string {
  const before = r.preferred.width * r.preferred.height;
  const after = w * h;
  const pct = before > 0 ? Math.round((after / before - 1) * 100) : 0;
  return (
    `${r.id}: wanted ${r.preferred.width}×${r.preferred.height}, ` +
    `grew to ${Math.round(w)}×${Math.round(h)} (+${pct}%) — extra room available`
  );
}

/**
 * One axis (width or height) of the final placed size. Shrink-only unless
 * `canGrow` — even then, growth never exceeds the slot's own ceiling
 * (`slotMax`), so it can only ever use space the strategy already decided is
 * safely this element's own (never a sibling's). `growthCap` defaults to
 * `GROWTH_CAP_FACTOR`; the hero role passes `HERO_GROWTH_CAP_FACTOR` instead
 * (see its doc comment) so the product photo keeps a clear size advantage
 * whenever anything is allowed to grow at all.
 */
function sizeAxis(
  preferred: number,
  slotMax: number,
  canGrow: boolean,
  growthCap: number = GROWTH_CAP_FACTOR,
): number {
  if (!canGrow) return Math.min(preferred, slotMax);
  return Math.min(slotMax, preferred * growthCap);
}

/** Which axes a strategy allows an element to grow beyond its preferred size on. */
export interface GrowAxes {
  width: boolean;
  height: boolean;
}
const NO_GROWTH: GrowAxes = { width: false, height: false };

/**
 * Shared placement engine used by ALL four strategies (so the priority ordering
 * and shrink/drop logic from Phase 2's resolver lives in exactly one place).
 *
 * For each element in priority order it asks `layoutFn` for a slot, sizes the
 * element to that slot (never below its declared min; grown above `preferred`
 * only on axes `growAxes` marks growable, capped by `GROWTH_CAP_FACTOR` — see
 * `sizeAxis`), and drops it — `visible: false`, then cascades to every
 * lower-priority element — when it cannot fit or the strategy offers no slot.
 * It also re-checks the two hard invariants (fully in-bounds, non-overlapping)
 * and drops anything that would break them, so every candidate produced here
 * is guaranteed clip-free and overlap-free no matter what a strategy function
 * does.
 */
export function placeElementsInOrder(
  requests: PlacementRequest[],
  available: Box,
  layoutFn: StrategyLayoutFn,
  growAxes: GrowAxes = NO_GROWTH,
): PlacementOutcome {
  const placed: ResolvedElement[] = [];
  const notes: string[] = [];
  let cascade = false;

  for (let order = 0; order < requests.length; order++) {
    const request = requests[order]!;

    if (cascade) {
      placed.push(droppedElement(request));
      notes.push(dropNote(request));
      continue;
    }

    const visibleSoFar = placed.filter((e) => e.visible);
    const slot = layoutFn({
      order,
      placedCount: visibleSoFar.length,
      request,
      available,
      placed: visibleSoFar,
    });

    if (slot === null) {
      cascade = true;
      placed.push(droppedElement(request));
      notes.push(dropNote(request));
      continue;
    }

    // `interactive` (clickable) elements are exempt from HEIGHT growth only —
    // see the doc comment on `PlacementRequest.interactive` for the "squat
    // blob" bug that exemption fixes (growing a wide short pill's HEIGHT on
    // horizontal-split's free axis distorted its shape). WIDTH growth is a
    // different, ordinary case: a button getting wider while keeping its
    // height is exactly how real "full-width-ish" CTAs look, so clickable
    // elements grow normally on that axis — this is what lets the CTA fill
    // available horizontal slack on vertical-stack instead of sitting as a
    // small pill next to dead space.
    const canGrowWidth = !request.locked;
    const canGrowHeight = !request.locked && !request.interactive;
    const growthCap = request.role === "hero" ? HERO_GROWTH_CAP_FACTOR : GROWTH_CAP_FACTOR;
    const width = sizeAxis(request.preferred.width, slot.maxWidth, growAxes.width && canGrowWidth, growthCap);
    const height = sizeAxis(request.preferred.height, slot.maxHeight, growAxes.height && canGrowHeight, growthCap);
    const el: ResolvedElement = {
      id: request.id,
      x: slot.x,
      y: slot.y,
      width,
      height,
      visible: true,
      role: request.role,
    };

    const fits =
      slot.maxWidth > 0 &&
      slot.maxHeight > 0 &&
      width >= request.min.width - EPS &&
      height >= request.min.height - EPS &&
      withinBox(el, available) &&
      visibleSoFar.every((p) => !boxesOverlap(el, p));

    if (!fits) {
      cascade = true;
      placed.push(droppedElement(request));
      notes.push(dropNote(request));
      continue;
    }

    // §7.10 (found via live inspection, self-healing demo): this used to
    // decide "grew" vs "shrunk" per-axis with an OR — so an element whose
    // WIDTH shrank drastically but whose HEIGHT grew by even a fraction of a
    // pixel was labelled "grew to ... (+X%)" while X was actually NEGATIVE
    // (the growNote% is area-based), producing a nonsensical note like
    // "wanted 1569×120, grew to 120×130 (+-92%)" for an element that had
    // just been shrunk to a THIRTEENTH of its width. Both the verdict (grew
    // vs shrunk) and the percentage are now driven by the same AREA
    // comparison, so they can never disagree with each other again.
    const beforeArea = request.preferred.width * request.preferred.height;
    const afterArea = width * height;
    if (afterArea > beforeArea) {
      notes.push(growNote(request, width, height));
    } else if (afterArea < beforeArea) {
      notes.push(shrinkNote(request, width, height));
    }
    placed.push(el);
  }

  return { elements: placed, notes };
}

// ── The four strategies ────────────────────────────────────────────────────
// Each is pure geometry over `box` (the surface's usable region) and the
// per-element requests. None of them looks at a surface id or an element id.

/**
 * §7.5: a cascading strategy (vertical-stack, horizontal-split) stacks
 * elements starting from the box's own top/left edge. On a surface much
 * larger than the ad actually needs — even after growth — that leaves every
 * bit of leftover room as ONE lopsided gap on the far side (e.g. the whole ad
 * pinned to the top of a tall kiosk panel, with a large dead void below it).
 * That reads as unfinished/accidental, not as a designed composition, and is
 * a different shape of the same "doesn't look like one full, deliberate ad"
 * complaint that motivated `compositionCohesion` (scoring.ts §4g) — but
 * scoring can only choose between candidates a strategy already produced, it
 * can't fix a lopsided candidate's own geometry. This shifts every VISIBLE
 * element by the same offset — a uniform translation, so relative positions
 * (and therefore the non-overlap / already-validated-in-bounds invariants)
 * are provably unaffected — so the block sits centred in the axis the
 * strategy cascades along, turning one large one-sided gap into a smaller,
 * even margin on both sides, which reads as intentional breathing room
 * instead of an accident. Only touches the axis passed in; the free axis
 * (already sized per-element to the box on every row/column) needs no
 * centring of its own.
 */
function centerAlongAxis(
  outcome: PlacementOutcome,
  box: Box,
  axis: "x" | "y",
): PlacementOutcome {
  const dim = axis === "x" ? "width" : "height";
  const visible = outcome.elements.filter((e) => e.visible);
  if (visible.length === 0) return outcome;

  const boxStart = axis === "x" ? box.x : box.y;
  const boxSize = axis === "x" ? box.width : box.height;
  const contentEnd = Math.max(...visible.map((e) => e[axis] + e[dim]));
  const slack = boxStart + boxSize - contentEnd;
  if (slack <= 0) return outcome;

  const offset = slack / 2;
  return {
    notes: outcome.notes,
    elements: outcome.elements.map((e) =>
      e.visible ? { ...e, [axis]: e[axis] + offset } : e,
    ),
  };
}

/**
 * One column, elements stacked top→bottom, each as wide as the box allows.
 * WIDTH is a free axis here — every element sees the same full `box.width`
 * regardless of what siblings above/below it did, so growing it can never
 * eat into another element's space (only HEIGHT is the cascading, cursor-based
 * axis, so only height stays shrink-only). The whole stacked block is then
 * centred vertically in the box (see `centerAlongAxis`) so leftover room
 * becomes an even top/bottom margin instead of one gap below everything.
 */
function verticalStack(requests: PlacementRequest[], box: Box): PlacementOutcome {
  const outcome = placeElementsInOrder(
    requests,
    box,
    ({ placed }) => {
      const cursorY = placed.reduce((maxY, e) => Math.max(maxY, e.y + e.height), box.y);
      const remaining = box.y + box.height - cursorY;
      if (remaining <= 0) return null;
      return { x: box.x, y: cursorY, maxWidth: box.width, maxHeight: remaining };
    },
    { width: true, height: false },
  );
  return centerAlongAxis(outcome, box, "y");
}

/**
 * Deliberately tiny — "technically visible," not "legible." The alternative
 * for a `visibility:"always"` element on a surface smaller than its declared
 * minSize is showing NOTHING, which is strictly worse than a small chip.
 * `constraintViolationsScore` still penalizes every element placed below its
 * REAL declared minSize (it reads the graph node directly, unaffected by this
 * override), so this never scores as if it were a clean fit — it just stops
 * being scored as a hard-fail zero.
 */
const EMERGENCY_MIN_SIZE: SizeConstraint = { width: 24, height: 16 };

/**
 * §7.9 (found via live measurement): once §7.9's fix stopped degradable
 * elements from outsizing the always-visible ones, a subtler issue remained —
 * every always-visible element shared the SAME `EMERGENCY_MIN_SIZE` floor, so
 * the product photo (role "hero", the ad's declared highlight) rendered at
 * the exact same tiny size as the headline and CTA chips, indistinguishable
 * from them. "The highlight, handled carefully" should still read as the
 * highlight even at the absolute floor — so the hero role gets a visibly
 * larger (roughly 3x the area, a 4:3 photo-like shape) floor than plain
 * text/button chips. Still tiny in absolute terms (this is the worst-case
 * fallback, not a real layout), but large enough to visually anchor the ad
 * instead of blending into the row/column as an equal-sized dot.
 */
const EMERGENCY_HIGHLIGHT_SIZE: SizeConstraint = { width: 48, height: 36 };

/** The emergency floor for one request: the hero role gets the larger,
 *  photo-shaped floor; every other always-visible element gets the plain one. */
function emergencyFloorFor(role: string): SizeConstraint {
  return role === "hero" ? EMERGENCY_HIGHLIGHT_SIZE : EMERGENCY_MIN_SIZE;
}

/**
 * Last-resort fallback (§10 / stress-lab "nothing fits" fix). Same geometry as
 * `verticalStack` (or `horizontalSplit` on a wide box — see below), but every
 * `visibility:"always"` element's preferred AND min size are both replaced
 * with `EMERGENCY_MIN_SIZE` — not just the acceptance floor, but the TARGET
 * size — so each always-element claims only a small, fair share of space
 * instead of greedily consuming everything available (which would just push
 * the next always-element into the same "no room" cascade it was meant to
 * rescue). Only `alwaysVisible` requests are touched; everything else keeps
 * its normal preferred/min and cascades exactly as it would in the matching
 * normal strategy.
 *
 * The relaxed preferred/min is applied UNCONDITIONALLY to every always-visible
 * element — not only when the normal size wouldn't fit — so this candidate's
 * always-elements are deliberately tiny even on a perfectly spacious surface.
 * That is what keeps it losing on every surface that never needed rescuing:
 * `constraintViolationsScore` reads each element's REAL declared minSize from
 * the graph node (unaffected by this override) and penalizes every
 * always-element here as "forced below minSize," a penalty the matching
 * normal strategy never carries when it can place things at their real size.
 * Only when the other four candidates ALL hard-fail to 0 — because a surface
 * can't fit an always-element even at its real, non-relaxed size — does this
 * candidate's genuine, non-zero (if penalized) score become the highest, and
 * win.
 *
 * §7.7 (found via live testing, not theorized): a STRICTLY vertical cascade
 * needs `N × EMERGENCY_MIN_SIZE.height` of vertical room for N always-visible
 * elements — with 4 of them (headline, cta, price, logo) that is 64px, which
 * a standard 320×50 mobile banner (a real, common ad size) does not have,
 * even though it has ample WIDTH to lay those same 4 elements out in a row.
 * A pure column-only floor was leaving a realistic, everyday ad size
 * hard-failing for no good reason. So — mirroring the existing
 * vertical-stack/horizontal-split duality — the emergency floor now cascades
 * along whichever axis the box actually offers more of: a wide-or-square box
 * (width ≥ height) lays always-elements out in a ROW (mirroring
 * `horizontalSplit`'s geometry); a tall box stacks them in a COLUMN
 * (mirroring `verticalStack`'s). Only the DIRECTION changes; the relaxed-size
 * mechanism, the scoring penalty that keeps it losing when unneeded, and the
 * non-overlap/in-bounds guarantees are identical either way.
 *
 * §7.9 (CRITICAL bug found via live measurement, not theorized): degradable
 * elements used to cascade through this SAME pass at their normal, full,
 * un-relaxed size — including growing into whatever slack the row/column's
 * free axis offered. Once always-elements are miniaturized to a 24×16 floor,
 * that "slack" is almost the entire box, so a degradable element (price,
 * logo) could end up FAR larger than the always-elements it was supposedly
 * less important than — measured live on a real 320×50 banner: price
 * rendered at 198×50 (76% of the ad's total area) while headline, cta, and
 * the product photo — the actual highlight — were each squeezed to a 24×22
 * sliver (4% apiece). The visual hierarchy was completely inverted: the
 * least important content dominated the ad. `emergencyFit` now places ONLY
 * always-visible elements — any request with `alwaysVisible: false` returns
 * a `null` slot unconditionally, dropping it (and, by the shared engine's
 * cascade rule, everything lower-priority after it, which in this spec is
 * always other degradable elements — see the ordering note below). This
 * makes emergency-fit a genuine "bare essentials only" last resort: if a
 * surface is constrained enough to need it at all, showing secondary text at
 * full size while the actual message is reduced to a dot is not a
 * reasonable layout, it's a worse one than simply not showing that text.
 *
 * This relies on every `visibility:"always"` element in the spec having a
 * BETTER (lower) priority number than every non-always one — true by
 * construction here (headline=1, cta=2, product-image=3 are always;
 * price=4, logo=5 are degradable) and asserted by
 * `candidates.test.ts`. If that ever stopped holding, unconditionally
 * dropping a non-always element could cascade-drop a LOWER-priority-number
 * (more important) always element placed after it in priority order — which
 * would be a real bug, not a re-tuned threshold — so the assumption is
 * checked directly, not just implied.
 */
function emergencyFit(requests: PlacementRequest[], box: Box): PlacementOutcome {
  const relaxed = requests.map((r) => {
    if (!r.alwaysVisible) return r;
    const floor = emergencyFloorFor(r.role);
    return { ...r, preferred: floor, min: floor };
  });

  if (box.width > box.height) {
    return placeElementsInOrder(
      relaxed,
      box,
      ({ placed, request }) => {
        if (!request.alwaysVisible) return null;
        const cursorX = placed.reduce((maxX, e) => Math.max(maxX, e.x + e.width), box.x);
        const remaining = box.x + box.width - cursorX;
        if (remaining <= 0) return null;
        return { x: cursorX, y: box.y, maxWidth: remaining, maxHeight: box.height };
      },
      { width: false, height: true },
    );
  }

  return placeElementsInOrder(
    relaxed,
    box,
    ({ placed, request }) => {
      if (!request.alwaysVisible) return null;
      const cursorY = placed.reduce((maxY, e) => Math.max(maxY, e.y + e.height), box.y);
      const remaining = box.y + box.height - cursorY;
      if (remaining <= 0) return null;
      return { x: box.x, y: cursorY, maxWidth: box.width, maxHeight: remaining };
    },
    { width: true, height: false },
  );
}

/**
 * One row, elements placed left→right, each as tall as the box allows.
 * Mirror of verticalStack: HEIGHT is the free axis (every element sees the
 * full `box.height`), WIDTH is the cascading cursor-based axis and stays
 * shrink-only. The whole row is then centred horizontally in the box (see
 * `centerAlongAxis`), the mirror of vertical-stack's top/bottom centring.
 */
function horizontalSplit(requests: PlacementRequest[], box: Box): PlacementOutcome {
  const outcome = placeElementsInOrder(
    requests,
    box,
    ({ placed }) => {
      const cursorX = placed.reduce((maxX, e) => Math.max(maxX, e.x + e.width), box.x);
      const remaining = box.x + box.width - cursorX;
      if (remaining <= 0) return null;
      return { x: cursorX, y: box.y, maxWidth: remaining, maxHeight: box.height };
    },
    { width: false, height: true },
  );
  return centerAlongAxis(outcome, box, "x");
}

/**
 * Row-major grid of ceil(sqrt(n)) columns; each element clamped to its cell.
 * Cell geometry is fixed by (row, col) alone — never by any other element's
 * actual placed size — so BOTH axes are free to grow here.
 */
function grid(requests: PlacementRequest[], box: Box): PlacementOutcome {
  const n = Math.max(1, requests.length);
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = box.width / cols;
  const cellH = box.height / rows;
  return placeElementsInOrder(
    requests,
    box,
    ({ order }) => {
      const col = order % cols;
      const row = Math.floor(order / cols);
      if (row >= rows) return null;
      return {
        x: box.x + col * cellW,
        y: box.y + row * cellH,
        maxWidth: cellW,
        maxHeight: cellH,
      };
    },
    { width: true, height: true },
  );
}

/**
 * Four elements anchored to the four corners of the box, each hugging its
 * margin and capped at half the box on each axis (so corners can never
 * overlap). The two highest-priority elements land in OPPOSITE corners — the
 * maximum-separation arrangement, structurally unlike the grid's row-major
 * fill. A fifth element and beyond are dropped.
 *
 * Deliberately opts OUT of growth (no growAxes passed → NO_GROWTH): a
 * right/bottom-anchored corner's OWN position formula (`box.width - w`)
 * depends on its OWN final width/height, so growing width/height here would
 * also have to re-derive x/y from the grown size — solvable, but not worth
 * the extra coupling for a strategy whose whole point is "hug the margin,"
 * not "use more space."
 */
function overlaySafeMargins(
  requests: PlacementRequest[],
  box: Box,
): PlacementOutcome {
  const corners = ["tl", "br", "tr", "bl"] as const;
  const halfW = box.width / 2;
  const halfH = box.height / 2;
  return placeElementsInOrder(requests, box, ({ placedCount, request }) => {
    const corner = corners[placedCount];
    if (corner === undefined) return null;
    const w = Math.min(request.preferred.width, halfW);
    const h = Math.min(request.preferred.height, halfH);
    const x = corner === "tl" || corner === "bl" ? box.x : box.x + box.width - w;
    const y = corner === "tl" || corner === "tr" ? box.y : box.y + box.height - h;
    return { x, y, maxWidth: w, maxHeight: h };
  });
}

/**
 * Build every candidate layout for a (graph, context, surface).
 *
 * Always returns all four strategies (≥ 3, as required) so the scorer has a
 * real choice. `context` biases the per-element size REQUESTS going in (far
 * viewing → bigger type, touch → bigger CTA — see `toRequest`); the four
 * geometric strategy functions themselves stay pure geometry over whatever
 * requests they are handed, so no strategy needs to know why a request is the
 * size it is. A 5th, `emergency-fit`, is always generated too (cheap — same
 * geometry as vertical-stack) but only ever WINS on surfaces where the other
 * four all hard-fail because a `visibility:"always"` element couldn't be
 * placed at its declared size at all (see `emergencyFit`).
 */
export function generateCandidates(
  graph: ExperienceGraph,
  context: Context,
  surface: SurfaceProfile,
): Candidate[] {
  const box = availableBox(surface);
  const requests = orderedRequests(graph, context, surface);

  const build = (
    strategy: CandidateStrategy,
    outcome: PlacementOutcome,
  ): Candidate => ({
    strategy,
    elements: outcome.elements,
    notes: outcome.notes,
  });

  return [
    build("vertical-stack", verticalStack(requests, box)),
    build("horizontal-split", horizontalSplit(requests, box)),
    build("grid", grid(requests, box)),
    build("overlay-safe-margins", overlaySafeMargins(requests, box)),
    build("emergency-fit", emergencyFit(requests, box)),
  ];
}
