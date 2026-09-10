/**
 * 5.4 — naive vs. smart comparison.
 *
 * Same spec, same surface, two resolvers side by side:
 *   left  — naiveResolveLayout(): one uniform scale factor, diagonal stagger,
 *           no priority logic, overlap allowed
 *   right — the real resolveLayout(): candidate generation + scoring
 *
 * On a constrained surface the naive side visibly overlaps / shrinks elements
 * into illegibility while the smart side keeps a clean priority-ordered layout.
 */

import { useMemo, useState } from "react";
import { resolveContext } from "../core/context";
import { resolveLayout } from "../core/resolver";
import { naiveResolveLayout } from "../core/naive-resolver";
import type { ExperienceGraph } from "../core/graph";
import type { AdElement } from "../core/spec";
import type { SurfaceProfile } from "../core/surfaces";
import { SurfaceStage } from "./SurfaceStage";

function area(s: SurfaceProfile): number {
  return s.width * s.height;
}

export function NaiveVsSmart({
  surfaces,
  graph,
  specById,
}: {
  surfaces: SurfaceProfile[];
  graph: ExperienceGraph;
  specById: Map<string, AdElement>;
}): JSX.Element {
  // Default to the most constrained surface — that is where the gap shows.
  const smallest = useMemo(
    () => [...surfaces].sort((a, b) => area(a) - area(b))[0]!,
    [surfaces],
  );
  const [selectedId, setSelectedId] = useState(smallest.id);
  const surface =
    surfaces.find((s) => s.id === selectedId) ?? smallest;

  const naive = useMemo(
    () => naiveResolveLayout(graph, surface),
    [graph, surface],
  );
  const smart = useMemo(
    () => resolveLayout(graph, resolveContext(surface), surface),
    [graph, surface],
  );

  const naiveVisible = naive.elements.filter((e) => e.visible).length;
  const smartVisible = smart.layout.elements.filter((e) => e.visible).length;

  return (
    <section data-testid="naive-vs-smart">
      <h2 style={{ fontSize: 16, margin: "0 0 6px" }}>Naive vs. Smart resolver</h2>
      <label style={{ fontSize: 13, display: "block", marginBottom: 12 }}>
        Surface:{" "}
        <select
          data-testid="naive-surface-picker"
          value={selectedId}
          onChange={(e) => setSelectedId(e.target.value)}
        >
          {surfaces.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name ?? s.id} ({s.width}×{s.height})
            </option>
          ))}
        </select>
      </label>

      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))",
          gap: 24,
        }}
      >
        <div data-testid="naive-side">
          <h3 style={{ fontSize: 13, margin: "0 0 6px", color: "#c33" }}>
            Naive — uniform scale, no priority ({naiveVisible}/
            {naive.elements.length} visible, overlap allowed)
          </h3>
          <SurfaceStage
            surface={surface}
            elements={naive.elements}
            specById={specById}
            maxWidth={440}
            maxHeight={440}
          />
        </div>

        <div data-testid="smart-side">
          <h3 style={{ fontSize: 13, margin: "0 0 6px", color: "#2a7" }}>
            Smart — {smart.trace.winningStrategy} ({smartVisible}/
            {smart.layout.elements.length} visible, zero overlap)
          </h3>
          <SurfaceStage
            surface={surface}
            elements={smart.layout.elements}
            specById={specById}
            maxWidth={440}
            maxHeight={440}
          />
        </div>
      </div>
    </section>
  );
}
