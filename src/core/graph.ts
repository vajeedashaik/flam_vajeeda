/**
 * Experience Graph.
 *
 * Turns a surface-independent {@link AdSpec} into a graph of nodes (one per ad
 * element, carrying every Phase-1 field verbatim) plus relational edges that are
 * DERIVED from role semantics — never from specific element ids. The graph is
 * the single source of truth every downstream phase reads from.
 */

import type { AdElement, AdSpec, ElementRole } from "./spec";

/** Relationship kinds the resolver and later scorers understand. */
export type GraphEdgeType = "proximity" | "alignment" | "exclusion";

/**
 * A relation between two elements, addressed by element id.
 *
 * Edges are conceptually undirected. `from`/`to` are filled deterministically by
 * the derivation rules below (iteration follows spec element order) so that the
 * same spec always yields the same edge list.
 */
export interface GraphEdge {
  from: string;
  to: string;
  type: GraphEdgeType;
}

/**
 * An ad element plus its computed relations. Every Phase-1 field (importance,
 * interaction, visibility, minSize, preferredSize, brandRules, …) is carried
 * through unchanged via the {@link AdElement} extension.
 */
export interface GraphNode extends AdElement {
  /** Every edge that touches this node (as `from` or as `to`). */
  edges: GraphEdge[];
}

export interface ExperienceGraph {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * Build the Experience Graph for a spec.
 *
 * Edge derivation rule set (deterministic, role-based, id-agnostic — generalises
 * to any spec produced by `defineAd()`):
 *
 *   Rule P (proximity): for every element with role "secondary" and every
 *     element with role "action", add a proximity edge secondary → action.
 *     Rationale: secondary content (price, disclaimer, rating) is only
 *     meaningful directly beside the call-to-action it qualifies, so downstream
 *     phases must evaluate the pair together.
 *
 *   Rule X (exclusion): for every element with role "hero" and every element
 *     with role "branding", add an exclusion edge hero → branding.
 *     Rationale: the hero is the focal visual and branding is a persistent
 *     mark; they must never overlap, on any surface, regardless of how tight
 *     space gets.
 *
 * "alignment" edges are part of the type but are not auto-derived yet — a later
 * phase adds them.
 */
export function buildGraph(spec: AdSpec): ExperienceGraph {
  const nodes: GraphNode[] = spec.elements.map((element) => ({
    ...element,
    edges: [],
  }));

  const elementsWithRole = (role: ElementRole): AdElement[] =>
    spec.elements.filter((element) => element.role === role);

  const edges: GraphEdge[] = [];

  // Rule P — proximity between each "secondary" and each "action".
  for (const secondary of elementsWithRole("secondary")) {
    for (const action of elementsWithRole("action")) {
      edges.push({ from: secondary.id, to: action.id, type: "proximity" });
    }
  }

  // Rule X — exclusion between each "hero" and each "branding".
  for (const hero of elementsWithRole("hero")) {
    for (const branding of elementsWithRole("branding")) {
      edges.push({ from: hero.id, to: branding.id, type: "exclusion" });
    }
  }

  // Mirror every edge onto the computed edge list of both endpoint nodes.
  const nodeById = new Map<string, GraphNode>(
    nodes.map((node) => [node.id, node]),
  );
  for (const edge of edges) {
    nodeById.get(edge.from)?.edges.push(edge);
    nodeById.get(edge.to)?.edges.push(edge);
  }

  return { nodes, edges };
}

/**
 * Nodes related to `nodeId` by any edge, or only by `edgeType` when given.
 * Edges are treated as undirected: a node reached as either endpoint counts.
 */
export function getRelatedNodes(
  graph: ExperienceGraph,
  nodeId: string,
  edgeType?: GraphEdgeType,
): GraphNode[] {
  const relatedIds = new Set<string>();

  for (const edge of graph.edges) {
    if (edgeType !== undefined && edge.type !== edgeType) continue;
    if (edge.from === nodeId) relatedIds.add(edge.to);
    else if (edge.to === nodeId) relatedIds.add(edge.from);
  }

  return graph.nodes.filter((node) => relatedIds.has(node.id));
}
