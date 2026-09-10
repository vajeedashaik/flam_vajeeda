/**
 * 5.4 — the deliberately dumb baseline.
 *
 * naiveResolveLayout() is what "adaptive layout" looks like when you do the
 * obvious thing: take every element at its preferred size, pick ONE scale factor
 * so the biggest element fits the surface, apply that same factor to everything,
 * and drop them all in at a fixed diagonal stagger. No priority order, no
 * dropping, no overlap avoidance, no tap-target logic. Elements are allowed to
 * overlap and to become illegibly small — that is the point of the comparison.
 *
 * Output is the same ResolvedLayout contract the real resolver returns, so both
 * can be rendered through the identical <SurfaceStage>.
 */

import type { ExperienceGraph } from "./graph";
import type { SizeConstraint } from "./spec";
import type { ResolvedElement, ResolvedLayout } from "./resolver";
import type { SurfaceProfile } from "./surfaces";

const FALLBACK: SizeConstraint = { width: 320, height: 50 };
const STAGGER = 14;

export function naiveResolveLayout(
  graph: ExperienceGraph,
  surface: SurfaceProfile,
): ResolvedLayout {
  const sizes = graph.nodes.map(
    (n) => n.preferredSize ?? n.minSize ?? FALLBACK,
  );

  const maxW = Math.max(1, ...sizes.map((s) => s.width));
  const maxH = Math.max(1, ...sizes.map((s) => s.height));

  // One factor for everything: just enough to make the single largest element
  // fit. Never upscale.
  const scale = Math.min(1, surface.width / maxW, surface.height / maxH);

  const elements: ResolvedElement[] = graph.nodes.map((node, i) => {
    const size = sizes[i]!;
    const width = Math.max(1, Math.round(size.width * scale));
    const height = Math.max(1, Math.round(size.height * scale));
    // Diagonal stagger, clamped so the element stays on-surface. Nothing stops
    // two elements from landing on top of each other.
    const x = Math.min(i * STAGGER, Math.max(0, surface.width - width));
    const y = Math.min(i * STAGGER, Math.max(0, surface.height - height));
    return { id: node.id, x, y, width, height, visible: true, role: node.role };
  });

  return { elements };
}
