/**
 * Degradation slider.
 *
 * Two sliders shrink the currently selected surface's width/height. On every
 * change the REAL resolver re-runs (same buildGraph → resolveContext →
 * resolveLayout path) and the layout re-renders, so you can watch elements
 * shrink and then drop in priority order as space runs out.
 */

import { useMemo, useState } from "react";
import { resolveContext } from "../core/context";
import { resolveLayout } from "../core/resolver";
import { defineSurface, type SurfaceProfile } from "../core/surfaces";
import type { ExperienceGraph } from "../core/graph";
import type { AdElement } from "../core/spec";
import { SurfaceStage } from "./SurfaceStage";

const MIN_DIM = 60;

export function DegradationSlider({
  baseSurface,
  graph,
  specById,
}: {
  baseSurface: SurfaceProfile;
  graph: ExperienceGraph;
  specById: Map<string, AdElement>;
}): JSX.Element {
  const [width, setWidth] = useState(baseSurface.width);
  const [height, setHeight] = useState(baseSurface.height);

  const baseKey = `${baseSurface.id}:${baseSurface.width}x${baseSurface.height}`;
  const [seenKey, setSeenKey] = useState(baseKey);
  if (seenKey !== baseKey) {
    setSeenKey(baseKey);
    setWidth(baseSurface.width);
    setHeight(baseSurface.height);
  }

  const { surface, layout, trace } = useMemo(() => {
    const w = Math.max(MIN_DIM, Math.min(width, baseSurface.width));
    const h = Math.max(MIN_DIM, Math.min(height, baseSurface.height));
    const shrunk = defineSurface({
      ...baseSurface,
      id: `${baseSurface.id}-degraded-${w}x${h}`,
      name: `${baseSurface.name ?? baseSurface.id} — ${w}×${h}`,
      width: w,
      height: h,
      safeArea: { top: 0, right: 0, bottom: 0, left: 0 },
    });
    const resolved = resolveLayout(graph, resolveContext(shrunk), shrunk);
    return { surface: shrunk, layout: resolved.layout, trace: resolved.trace };
  }, [width, height, baseSurface, graph]);

  const visible = layout.elements.filter((e) => e.visible);

  return (
    <section className="ale-card" data-testid="degradation-slider" style={{ margin: "8px 0 16px" }}>
      <h3 className="ale-h3">Degradation slider — live-shrink this surface</h3>

      <div style={{ display: "flex", gap: 22, flexWrap: "wrap", fontSize: "0.76rem", alignItems: "center" }}>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="ale-muted">width</span>
          <input
            className="ale-range"
            data-testid="degradation-width"
            name="degradation-width"
            type="range"
            min={MIN_DIM}
            max={baseSurface.width}
            value={Math.min(width, baseSurface.width)}
            onChange={(e) => setWidth(Number(e.target.value))}
          />
          <b className="ale-num" style={{ width: 44, color: "var(--text-strong)" }}>
            {surface.width}
          </b>
        </label>
        <label style={{ display: "flex", gap: 10, alignItems: "center" }}>
          <span className="ale-muted">height</span>
          <input
            className="ale-range"
            data-testid="degradation-height"
            name="degradation-height"
            type="range"
            min={MIN_DIM}
            max={baseSurface.height}
            value={Math.min(height, baseSurface.height)}
            onChange={(e) => setHeight(Number(e.target.value))}
          />
          <b className="ale-num" style={{ width: 44, color: "var(--text-strong)" }}>
            {surface.height}
          </b>
        </label>
      </div>

      <p className="ale-meta" style={{ margin: "10px 0" }}>
        <b className="ale-num" data-testid="degradation-visible-count">
          {visible.length}/{layout.elements.length}
        </b>{" "}
        elements visible · winning strategy{" "}
        <span className="ale-chip">{trace.winningStrategy}</span>
      </p>

      <SurfaceStage
        surface={surface}
        elements={layout.elements}
        specById={specById}
        maxWidth={520}
        maxHeight={420}
      />
    </section>
  );
}
