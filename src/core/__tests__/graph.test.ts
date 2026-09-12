import { describe, it, expect } from "vitest";
import { defineAd } from "../spec";
import { productAd } from "../sample-data";
import { buildGraph, getRelatedNodes, type GraphEdge } from "../graph";

function hasEdge(
  edges: GraphEdge[],
  a: string,
  b: string,
  type: GraphEdge["type"],
): boolean {
  return edges.some(
    (edge) =>
      edge.type === type &&
      ((edge.from === a && edge.to === b) || (edge.from === b && edge.to === a)),
  );
}

describe("buildGraph — sample spec", () => {
  const graph = buildGraph(productAd);

  it("wraps every element as a node, preserving Phase-1 fields", () => {
    expect(graph.nodes.map((n) => n.id).sort()).toEqual(
      ["cta", "headline", "logo", "price", "product-image"].sort(),
    );

    const logo = graph.nodes.find((n) => n.id === "logo");
    // §7.8: logo is back to priority 5 / importance "nice-to-have" (§7.7 had
    // briefly promoted it) — product-image is the protected highlight now,
    // and logo (with price) is one of the two elements allowed to degrade
    // first under real space pressure.
    expect(logo?.priority).toBe(5);
    expect(logo?.importance).toBe("nice-to-have");
    expect(logo?.preferredSize).toEqual({ width: 96, height: 32 });
    expect(logo?.brandRules).toEqual({
      locked: true,
      minSize: { width: 24, height: 24 },
    });
  });

  it("derives a proximity edge between the secondary (price) and action (cta)", () => {
    expect(hasEdge(graph.edges, "price", "cta", "proximity")).toBe(true);
  });

  it("derives an exclusion edge between the hero (product-image) and branding (logo)", () => {
    expect(hasEdge(graph.edges, "product-image", "logo", "exclusion")).toBe(true);
  });

  it("derives exactly those two edges for this spec", () => {
    expect(graph.edges).toHaveLength(2);
    expect(graph.edges.map((e) => e.type).sort()).toEqual([
      "exclusion",
      "proximity",
    ]);
  });

  it("mirrors each edge onto both endpoint nodes' computed edge lists", () => {
    const cta = graph.nodes.find((n) => n.id === "cta");
    const price = graph.nodes.find((n) => n.id === "price");
    expect(cta?.edges).toHaveLength(1);
    expect(price?.edges).toHaveLength(1);
    expect(cta?.edges[0]).toEqual(price?.edges[0]);
  });
});

describe("buildGraph — hand-built minimal spec (proves rules are role-based, not id-based)", () => {
  const miniAd = defineAd({
    id: "mini",
    elements: [
      { id: "photo", type: "image", role: "hero", priority: 1 },
      { id: "wordmark", type: "image", role: "branding", priority: 2 },
      { id: "disclaimer", type: "text", role: "secondary", priority: 3 },
      { id: "signup", type: "button", role: "action", priority: 4 },
      { id: "title", type: "text", role: "primary", priority: 5 },
    ],
  });
  const graph = buildGraph(miniAd);

  it("derives proximity from role 'secondary' → 'action' with completely different ids", () => {
    expect(hasEdge(graph.edges, "disclaimer", "signup", "proximity")).toBe(true);
  });

  it("derives exclusion from role 'hero' → 'branding' with completely different ids", () => {
    expect(hasEdge(graph.edges, "photo", "wordmark", "exclusion")).toBe(true);
  });

  it("does not invent edges for roles with no rule (primary)", () => {
    expect(
      graph.edges.some((e) => e.from === "title" || e.to === "title"),
    ).toBe(false);
    expect(graph.edges).toHaveLength(2);
  });
});

describe("getRelatedNodes", () => {
  const graph = buildGraph(productAd);

  it("returns the paired node regardless of edge direction", () => {
    expect(getRelatedNodes(graph, "cta").map((n) => n.id)).toEqual(["price"]);
    expect(getRelatedNodes(graph, "price").map((n) => n.id)).toEqual(["cta"]);
  });

  it("filters by edge type when given", () => {
    expect(getRelatedNodes(graph, "logo", "exclusion").map((n) => n.id)).toEqual(
      ["product-image"],
    );
    expect(getRelatedNodes(graph, "logo", "proximity")).toEqual([]);
  });
});
