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

export type CandidateStrategy =
  | "vertical-stack"
  | "horizontal-split"
  | "overlay-safe-margins"
  | "grid";

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
}

function toRequest(node: GraphNode): PlacementRequest {
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
      width: Math.max(measuredWidth, node.minSize?.width ?? 0),
      height: Math.max(
        lineHeight,
        node.minSize?.height ?? 0,
        node.preferredSize?.height ?? 0,
      ),
    };
  }

  const min = node.minSize ?? preferred;
  return {
    id: node.id,
    role: node.role,
    priority: node.priority,
    preferred,
    min,
  };
}

/** Canonical resolution order: priority ascending, id ascending to break ties. */
function orderedRequests(graph: ExperienceGraph): PlacementRequest[] {
  return [...graph.nodes]
    .sort((a, b) => {
      if (a.priority !== b.priority) return a.priority - b.priority;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map(toRequest);
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

/**
 * Shared placement engine used by ALL four strategies (so the priority ordering
 * and shrink/drop logic from Phase 2's resolver lives in exactly one place).
 *
 * For each element in priority order it asks `layoutFn` for a slot, shrinks the
 * element to fit that slot (never below its declared min), and drops it —
 * `visible: false`, then cascades to every lower-priority element — when it
 * cannot fit or the strategy offers no slot. It also re-checks the two hard
 * invariants (fully in-bounds, non-overlapping) and drops anything that would
 * break them, so every candidate produced here is guaranteed clip-free and
 * overlap-free no matter what a strategy function does.
 */
export function placeElementsInOrder(
  requests: PlacementRequest[],
  available: Box,
  layoutFn: StrategyLayoutFn,
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

    const width = Math.min(request.preferred.width, slot.maxWidth);
    const height = Math.min(request.preferred.height, slot.maxHeight);
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

    if (
      width < request.preferred.width - EPS ||
      height < request.preferred.height - EPS
    ) {
      notes.push(shrinkNote(request, width, height));
    }
    placed.push(el);
  }

  return { elements: placed, notes };
}

// ── The four strategies ────────────────────────────────────────────────────
// Each is pure geometry over `box` (the surface's usable region) and the
// per-element requests. None of them looks at a surface id or an element id.

/** One column, elements stacked top→bottom, each as wide as the box allows. */
function verticalStack(requests: PlacementRequest[], box: Box): PlacementOutcome {
  return placeElementsInOrder(requests, box, ({ placed }) => {
    const cursorY = placed.reduce((maxY, e) => Math.max(maxY, e.y + e.height), box.y);
    const remaining = box.y + box.height - cursorY;
    if (remaining <= 0) return null;
    return { x: box.x, y: cursorY, maxWidth: box.width, maxHeight: remaining };
  });
}

/** One row, elements placed left→right, each as tall as the box allows. */
function horizontalSplit(requests: PlacementRequest[], box: Box): PlacementOutcome {
  return placeElementsInOrder(requests, box, ({ placed }) => {
    const cursorX = placed.reduce((maxX, e) => Math.max(maxX, e.x + e.width), box.x);
    const remaining = box.x + box.width - cursorX;
    if (remaining <= 0) return null;
    return { x: cursorX, y: box.y, maxWidth: remaining, maxHeight: box.height };
  });
}

/** Row-major grid of ceil(sqrt(n)) columns; each element clamped to its cell. */
function grid(requests: PlacementRequest[], box: Box): PlacementOutcome {
  const n = Math.max(1, requests.length);
  const cols = Math.max(1, Math.ceil(Math.sqrt(n)));
  const rows = Math.max(1, Math.ceil(n / cols));
  const cellW = box.width / cols;
  const cellH = box.height / rows;
  return placeElementsInOrder(requests, box, ({ order }) => {
    const col = order % cols;
    const row = Math.floor(order / cols);
    if (row >= rows) return null;
    return {
      x: box.x + col * cellW,
      y: box.y + row * cellH,
      maxWidth: cellW,
      maxHeight: cellH,
    };
  });
}

/**
 * Four elements anchored to the four corners of the box, each hugging its
 * margin and capped at half the box on each axis (so corners can never
 * overlap). The two highest-priority elements land in OPPOSITE corners — the
 * maximum-separation arrangement, structurally unlike the grid's row-major
 * fill. A fifth element and beyond are dropped.
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
 * real choice. `context` is accepted for a stable signature and future
 * context-biased placement; the strategies today are pure geometry.
 */
export function generateCandidates(
  graph: ExperienceGraph,
  context: Context,
  surface: SurfaceProfile,
): Candidate[] {
  void context;

  const box = availableBox(surface);
  const requests = orderedRequests(graph);

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
  ];
}
