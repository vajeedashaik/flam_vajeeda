/**
 * Deterministic fitness scoring for candidate layouts.
 *
 * scoreCandidate() is PURE and side-effect-free: identical inputs always yield
 * an identical ScoreBreakdown (enforced by a determinism test). No Date, no
 * Math.random, no I/O.
 *
 * Like candidates.ts, this file names no specific surface id and no specific
 * ad-element id — every sub-score is computed from geometry plus each element's
 * role / priority / declared minimums only.
 */

import { availableBox, boxesOverlap, type Box, type Candidate } from "./candidates";
import type { Context } from "./context";
import type { ExperienceGraph, GraphNode } from "./graph";
import type { SurfaceProfile } from "./surfaces";
import type { ResolvedElement } from "./resolver";

export interface ScoreBreakdown {
  /** 0-100. 100 = no soft constraint broken. */
  constraintViolations: number;
  /** 0-100. 100 = every element kept, weighted by priority. */
  priorityPreservation: number;
  /** 0-100. 100 = layout centred in the usable area and evenly sized. */
  visualBalance: number;
  /** 0-100. 100 = every interactive target meets the surface minimum (or N/A). */
  tapTargetCompliance: number;
  /** 0-100. 100 = cheapest to render (few, large elements). */
  renderCost: number;
  /**
   * 0-100. §4.3-context: how well this candidate's STRATEGY and element count
   * suit the derived context — aspect ratio, attention budget, far viewing,
   * touch. See `contextFitScore` for the exact rule set.
   */
  contextFit: number;
  /** Weighted sum of the six sub-scores, or 0 on a hard-fail. */
  overall: number;
}

/**
 * Weights sum to 1.
 *
 * constraintViolations is weighted heaviest: a broken soft constraint
 * (element pushed outside the safe area, forced below its declared minimum,
 * an undersized tap target) is the worst outcome short of the overlap /
 * out-of-bounds / priority-inversion HARD-fail. priorityPreservation is next —
 * dropping content is bad, but a shown-yet-awkward layout is usually
 * recoverable. contextFit sits below the hard constraints but above the light
 * tie-breakers: it decides which of several otherwise-valid strategies suits
 * THIS surface's real-world context, never whether a layout is valid at all.
 * renderCost is only a light tie-breaker.
 */
const WEIGHTS = {
  constraintViolations: 0.32,
  priorityPreservation: 0.28,
  tapTargetCompliance: 0.14,
  contextFit: 0.1,
  visualBalance: 0.1,
  renderCost: 0.06,
} as const;

/** Points removed from constraintViolations per soft violation found. */
const VIOLATION_PENALTY = 25;

const EPS = 0.5;

function visible(candidate: Candidate): ResolvedElement[] {
  return candidate.elements.filter((e) => e.visible);
}

function nodesById(graph: ExperienceGraph): Map<string, GraphNode> {
  return new Map(graph.nodes.map((n) => [n.id, n]));
}

function anyOverlap(els: ResolvedElement[]): boolean {
  for (let i = 0; i < els.length; i++) {
    for (let j = i + 1; j < els.length; j++) {
      if (boxesOverlap(els[i]!, els[j]!)) return true;
    }
  }
  return false;
}

/** On-surface bounds check (the HARD invariant — distinct from the safe area). */
function anyOutOfSurface(els: ResolvedElement[], surface: SurfaceProfile): boolean {
  return els.some(
    (e) =>
      e.x < -EPS ||
      e.y < -EPS ||
      e.x + e.width > surface.width + EPS ||
      e.y + e.height > surface.height + EPS,
  );
}

/**
 * True when an element the spec marks `visibility: "always"` was dropped.
 * Those elements (critical headline / call-to-action) must survive every
 * degradation — they may shrink, never disappear — so a candidate that drops
 * one is not a valid layout. This is what guarantees the phase's degradation
 * order: decorative / degradable elements go first, "always" elements stay.
 */
function dropsAnAlwaysElement(
  candidate: Candidate,
  byId: Map<string, GraphNode>,
): boolean {
  return candidate.elements.some(
    (e) => !e.visible && byId.get(e.id)?.visibility === "always",
  );
}

/** A lower-priority element visible while a higher-priority one was dropped. */
function hasPriorityInversion(
  candidate: Candidate,
  byId: Map<string, GraphNode>,
): boolean {
  const droppedPriorities = candidate.elements
    .filter((e) => !e.visible)
    .map((e) => byId.get(e.id)?.priority ?? Number.POSITIVE_INFINITY);
  if (droppedPriorities.length === 0) return false;
  const minDropped = Math.min(...droppedPriorities);
  return candidate.elements.some(
    (e) =>
      e.visible &&
      (byId.get(e.id)?.priority ?? Number.NEGATIVE_INFINITY) > minDropped,
  );
}

function outsideSafeArea(e: ResolvedElement, box: Box): boolean {
  return (
    e.x < box.x - EPS ||
    e.y < box.y - EPS ||
    e.x + e.width > box.x + box.width + EPS ||
    e.y + e.height > box.y + box.height + EPS
  );
}

/**
 * constraintViolations sub-score. Counts, per visible element:
 *  - it sits outside the surface's safe area
 *  - it was forced below its spec-declared minSize
 *  - it is brand-locked but got resized away from its preferred size
 *  - it is interactive but smaller than the surface's minTapTarget
 * Score = 100 − 25 × (violation count), floored at 0.
 */
function constraintViolationsScore(
  candidate: Candidate,
  byId: Map<string, GraphNode>,
  surface: SurfaceProfile,
): number {
  const box = availableBox(surface);
  let violations = 0;

  for (const e of visible(candidate)) {
    const node = byId.get(e.id);
    if (outsideSafeArea(e, box)) violations++;
    if (!node) continue;

    if (
      node.minSize &&
      (e.width < node.minSize.width - EPS || e.height < node.minSize.height - EPS)
    ) {
      violations++;
    }
    if (
      node.brandRules?.locked &&
      node.preferredSize &&
      (Math.abs(e.width - node.preferredSize.width) > EPS ||
        Math.abs(e.height - node.preferredSize.height) > EPS)
    ) {
      violations++;
    }
    if (
      surface.minTapTarget !== undefined &&
      node.interaction === "clickable" &&
      (e.width < surface.minTapTarget - EPS ||
        e.height < surface.minTapTarget - EPS)
    ) {
      violations++;
    }
  }

  return Math.max(0, 100 - VIOLATION_PENALTY * violations);
}

/**
 * priorityPreservation sub-score. Each element carries weight
 * (maxPriority − priority + 1), so priority 1 is worth the most. Score is the
 * percentage of total weight that stayed visible.
 */
function priorityPreservationScore(
  candidate: Candidate,
  graph: ExperienceGraph,
): number {
  if (graph.nodes.length === 0) return 100;
  const maxPriority = Math.max(...graph.nodes.map((n) => n.priority));
  const weight = (p: number): number => maxPriority - p + 1;

  const total = graph.nodes.reduce((sum, n) => sum + weight(n.priority), 0);
  if (total === 0) return 100;

  const byId = nodesById(graph);
  const kept = candidate.elements.reduce((sum, e) => {
    if (!e.visible) return sum;
    const node = byId.get(e.id);
    return node ? sum + weight(node.priority) : sum;
  }, 0);

  return Math.round((kept / total) * 100);
}

/**
 * visualBalance sub-score. 65% how close the area-weighted centroid of the
 * visible elements sits to the centre of the usable area, 35% how even the
 * element areas are (1 − coefficient of variation).
 */
function visualBalanceScore(
  candidate: Candidate,
  surface: SurfaceProfile,
): number {
  const els = visible(candidate);
  if (els.length === 0) return 0;

  const box = availableBox(surface);
  const centreX = box.x + box.width / 2;
  const centreY = box.y + box.height / 2;

  let areaSum = 0;
  let xSum = 0;
  let ySum = 0;
  for (const e of els) {
    const area = e.width * e.height;
    areaSum += area;
    xSum += area * (e.x + e.width / 2);
    ySum += area * (e.y + e.height / 2);
  }
  if (areaSum === 0) return 0;

  const gx = xSum / areaSum;
  const gy = ySum / areaSum;
  const halfDiag = Math.hypot(box.width / 2, box.height / 2) || 1;
  const offset = Math.hypot(gx - centreX, gy - centreY) / halfDiag;
  const centreScore = Math.max(0, 1 - offset);

  const meanArea = areaSum / els.length;
  const variance =
    els.reduce((s, e) => s + (e.width * e.height - meanArea) ** 2, 0) /
    els.length;
  const cv = meanArea === 0 ? 1 : Math.sqrt(variance) / meanArea;
  const evenScore = Math.max(0, 1 - Math.min(cv, 1));

  return Math.round((0.65 * centreScore + 0.35 * evenScore) * 100);
}

/**
 * tapTargetCompliance sub-score. 100 when the surface has no minTapTarget or no
 * interactive element is visible; otherwise the percentage of visible
 * interactive elements that meet the minimum on both axes.
 */
function tapTargetComplianceScore(
  candidate: Candidate,
  byId: Map<string, GraphNode>,
  surface: SurfaceProfile,
): number {
  const min = surface.minTapTarget;
  if (min === undefined) return 100;

  const interactive = visible(candidate).filter(
    (e) => byId.get(e.id)?.interaction === "clickable",
  );
  if (interactive.length === 0) return 100;

  const ok = interactive.filter(
    (e) => e.width >= min - EPS && e.height >= min - EPS,
  ).length;
  return Math.round((ok / interactive.length) * 100);
}

/**
 * renderCost sub-score — the performance-aware term.
 *
 *   avgFrac = (sum of element areas / usable area) / visibleCount
 *           = mean element size as a fraction of the canvas
 *   rawCost = 5 × visibleCount  +  20 × (1 − min(avgFrac × 4, 1))
 *   score   = clamp(100 − rawCost, 0, 100)
 *
 * So cost rises with element COUNT (more draw work) and falls as the average
 * element gets LARGER — i.e. fewer / larger elements are cheaper, which is what
 * the score rewards.
 */
function renderCostScore(candidate: Candidate, surface: SurfaceProfile): number {
  const els = visible(candidate);
  const box = availableBox(surface);
  const canvas = box.width * box.height || 1;
  const count = els.length;
  const covered = els.reduce((s, e) => s + e.width * e.height, 0);
  const avgFrac = count === 0 ? 0 : covered / canvas / count;
  const rawCost = 5 * count + 20 * (1 - Math.min(avgFrac * 4, 1));
  return Math.max(0, Math.min(100, Math.round(100 - rawCost)));
}

/** Neutral starting point before any context bonus/penalty is applied. */
const CONTEXT_FIT_BASE = 60;

/**
 * contextFit sub-score — §4.3-context, the direct answer to "how does context
 * change which layout wins, not just how big things are drawn".
 *
 * Every bonus/penalty below is a named rule tied to one Context flag, so a
 * counterfactual explanation ("scored lower on context fit") is always
 * traceable back to a specific real-world reason, never an opaque number:
 *
 *  - aspectRatioClass: reward the strategy whose own geometry matches the
 *    surface's shape (wide → horizontal-split/grid, tall → vertical-stack,
 *    square → grid/overlay), penalise the strategy that fights the shape.
 *  - attentionBudget "short" / isFarViewing: reward FEWER visible elements —
 *    "prioritise instant visual comprehension" for a quick glance or a
 *    billboard read from across a room, exactly the project brief's own
 *    phrasing.
 *  - isTouchInteractive: penalise overlay-safe-margins, which spreads targets
 *    into the four corners — harder for a thumb to reach than a stacked or
 *    split layout keeps them.
 *
 * Pure and deterministic: depends only on the candidate's strategy + visible
 * count and the (already-pure) Context object.
 */
function contextFitScore(candidate: Candidate, context: Context): number {
  let score = CONTEXT_FIT_BASE;
  const strategy = candidate.strategy;

  if (context.aspectRatioClass === "wide") {
    if (strategy === "horizontal-split") score += 20;
    else if (strategy === "grid") score += 10;
    else if (strategy === "vertical-stack") score -= 15;
  } else if (context.aspectRatioClass === "tall") {
    if (strategy === "vertical-stack") score += 20;
    else if (strategy === "grid") score += 5;
    else if (strategy === "horizontal-split") score -= 15;
  } else {
    if (strategy === "grid" || strategy === "overlay-safe-margins") score += 10;
  }

  const visibleCount = visible(candidate).length;
  if (context.attentionBudget === "short") {
    score += Math.max(0, 20 - visibleCount * 4);
  }
  if (context.isFarViewing) {
    score += Math.max(0, 12 - visibleCount * 3);
  }
  if (context.isTouchInteractive && strategy === "overlay-safe-margins") {
    score -= 10;
  }

  return Math.max(0, Math.min(100, Math.round(score)));
}

/**
 * Score one candidate layout. Pure: same inputs → same output.
 *
 * HARD-fail → overall 0 (sub-scores still reported for the trace) when the
 * candidate has ANY overlap, ANY element off the surface, renders nothing,
 * drops an element marked `visibility: "always"`, or shows a lower-priority
 * element while a higher-priority one was dropped.
 */
export function scoreCandidate(
  candidate: Candidate,
  graph: ExperienceGraph,
  context: Context,
  surface: SurfaceProfile,
): ScoreBreakdown {
  const byId = nodesById(graph);
  const vis = visible(candidate);

  const sub = {
    constraintViolations: constraintViolationsScore(candidate, byId, surface),
    priorityPreservation: priorityPreservationScore(candidate, graph),
    visualBalance: visualBalanceScore(candidate, surface),
    tapTargetCompliance: tapTargetComplianceScore(candidate, byId, surface),
    renderCost: renderCostScore(candidate, surface),
    contextFit: contextFitScore(candidate, context),
  };

  const hardFail =
    vis.length === 0 ||
    anyOverlap(vis) ||
    anyOutOfSurface(vis, surface) ||
    dropsAnAlwaysElement(candidate, byId) ||
    hasPriorityInversion(candidate, byId);

  const weighted =
    sub.constraintViolations * WEIGHTS.constraintViolations +
    sub.priorityPreservation * WEIGHTS.priorityPreservation +
    sub.tapTargetCompliance * WEIGHTS.tapTargetCompliance +
    sub.contextFit * WEIGHTS.contextFit +
    sub.visualBalance * WEIGHTS.visualBalance +
    sub.renderCost * WEIGHTS.renderCost;

  return { ...sub, overall: hardFail ? 0 : Math.round(weighted) };
}
