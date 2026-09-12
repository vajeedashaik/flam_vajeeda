/**
 * Degradation slider.
 *
 * Two sliders shrink the currently selected surface's width/height. On every
 * change the REAL resolver re-runs (same buildGraph → resolveContext →
 * resolveLayout path) and the layout re-renders, so you can watch elements
 * shrink and then drop in priority order as space runs out.
 *
 * "Fluid Stress Test" (toggle button next to the sliders): instead of
 * dragging by hand, continuously oscillates width and height via
 * requestAnimationFrame so you can watch the resolver re-adapt on every frame
 * across a full sweep of aspect ratios (portrait ↔ ultrawide ↔ square) without
 * touching the mouse. The two oscillation frequencies are deliberately
 * different (and out of phase, sin vs. cos) so the surface sweeps through
 * genuinely different SHAPES, not just a uniform pulse.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { resolveContext } from "../core/context";
import { resolveLayout } from "../core/resolver";
import { defineSurface, type SurfaceProfile } from "../core/surfaces";
import type { ExperienceGraph } from "../core/graph";
import type { AdElement } from "../core/spec";
import { SurfaceStage } from "./SurfaceStage";

const MIN_DIM = 60;

/** Independent, out-of-phase frequencies — this asymmetry is what makes the
 *  aspect ratio sweep through wildly different shapes rather than just
 *  scaling uniformly. */
const STRESS_FREQ_W = 0.9;
const STRESS_FREQ_H = 0.7;

export function DegradationSlider({
  baseSurface,
  graph,
  specById,
  showDebug = false,
}: {
  baseSurface: SurfaceProfile;
  graph: ExperienceGraph;
  specById: Map<string, AdElement>;
  showDebug?: boolean;
}): JSX.Element {
  const [width, setWidth] = useState(baseSurface.width);
  const [height, setHeight] = useState(baseSurface.height);
  const [isStressTesting, setIsStressTesting] = useState(false);
  const animFrameRef = useRef<number | null>(null);
  const startTimeRef = useRef<number>(0);

  const baseKey = `${baseSurface.id}:${baseSurface.width}x${baseSurface.height}`;
  const [seenKey, setSeenKey] = useState(baseKey);
  if (seenKey !== baseKey) {
    setSeenKey(baseKey);
    setWidth(baseSurface.width);
    setHeight(baseSurface.height);
    setIsStressTesting(false);
  }

  // Oscillate width/height around the midpoint of each slider's own range, so
  // the sweep always spans the FULL [MIN_DIM, baseSurface.dimension] range for
  // whichever surface is selected, instead of hardcoded pixel constants.
  useEffect(() => {
    if (!isStressTesting) {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
      return;
    }

    const centerW = (baseSurface.width + MIN_DIM) / 2;
    const ampW = (baseSurface.width - MIN_DIM) / 2;
    const centerH = (baseSurface.height + MIN_DIM) / 2;
    const ampH = (baseSurface.height - MIN_DIM) / 2;

    startTimeRef.current = performance.now();
    const loop = (timestamp: number): void => {
      const elapsed = (timestamp - startTimeRef.current) / 1000;
      setWidth(Math.round(centerW + ampW * Math.sin(elapsed * STRESS_FREQ_W)));
      setHeight(Math.round(centerH + ampH * Math.cos(elapsed * STRESS_FREQ_H)));
      animFrameRef.current = requestAnimationFrame(loop);
    };
    animFrameRef.current = requestAnimationFrame(loop);

    return () => {
      if (animFrameRef.current !== null) cancelAnimationFrame(animFrameRef.current);
    };
  }, [isStressTesting, baseSurface.width, baseSurface.height]);

  function stopStressTest(): void {
    if (isStressTesting) setIsStressTesting(false);
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
      <div className="ale-toolbar" style={{ marginBottom: 4, alignItems: "center" }}>
        <h3 className="ale-h3" style={{ margin: 0 }}>
          Degradation slider — live-shrink this surface
        </h3>
        <button
          type="button"
          className={`ale-stress-btn${isStressTesting ? " ale-stress-btn--active" : ""}`}
          data-testid="fluid-stress-toggle"
          title="Auto-animate width/height to continuously test layout adaptation"
          onClick={() => setIsStressTesting((prev) => !prev)}
        >
          <span aria-hidden="true">{isStressTesting ? "⏹" : "▶"}</span>
          {isStressTesting ? "Stop Stress Test" : "Fluid Stress Test"}
        </button>
      </div>

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
            onChange={(e) => {
              stopStressTest();
              setWidth(Number(e.target.value));
            }}
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
            onChange={(e) => {
              stopStressTest();
              setHeight(Number(e.target.value));
            }}
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

      <div className="ale-stage-wrap">
        <SurfaceStage
          surface={surface}
          elements={layout.elements}
          specById={specById}
          trace={trace}
          showDebug={showDebug}
          maxWidth={520}
          maxHeight={420}
        />
      </div>
    </section>
  );
}
