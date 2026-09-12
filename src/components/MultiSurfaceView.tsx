/**
 * Side-by-side multi-surface view.
 *
 * Renders all five sample surfaces at once, each resolved through the real
 * pipeline (buildGraph is shared; resolveContext + resolveLayout run per
 * surface) and drawn in the SAME realistic device chassis (`DeviceFrame`) the
 * single-surface view uses — phone bezel, TV monitor, or clean studio frame,
 * picked by aspect ratio alone via `deviceType="auto"`, exactly like Single
 * surface's default. Every mini-render is the actual resolved layout — no
 * mockups, and no second, plainer frame implementation to keep in sync with
 * the real one.
 */

import { useMemo } from "react";
import { surfaceProfiles } from "../core/sample-data";
import { resolveContext } from "../core/context";
import { resolveLayout } from "../core/resolver";
import type { ExperienceGraph } from "../core/graph";
import type { AdElement } from "../core/spec";
import { DeviceFrame } from "./DeviceFrame";

const CELL = { width: 300, height: 460 };

const SURFACE_KEYS: (keyof typeof surfaceProfiles)[] = [
  "mobilePortrait",
  "mobileLandscape",
  "broadcastLowerThird",
  "retailKiosk",
  "printQRPanel",
];

export function MultiSurfaceView({
  graph,
  specById,
}: {
  graph: ExperienceGraph;
  specById: Map<string, AdElement>;
}): JSX.Element {
  const resolved = useMemo(
    () =>
      SURFACE_KEYS.map((key) => {
        const surface = surfaceProfiles[key];
        const { layout, trace } = resolveLayout(
          graph,
          resolveContext(surface),
          surface,
        );
        return { key, surface, layout, trace };
      }),
    [graph],
  );

  return (
    <section className="ale-panel" data-testid="multi-surface-view">
      <h2 className="ale-h2">Side-by-side — all 5 surfaces, one spec</h2>
      <p className="ale-note">
        Each frame is the real resolved layout for that surface, not a mockup.
      </p>

      <div className="ale-multi-grid" style={{ marginTop: 4 }}>
        {resolved.map(({ key, surface, layout, trace }) => {
          const visible = layout.elements.filter((e) => e.visible);
          return (
            <figure
              key={key}
              className="ale-multi-cell"
              data-testid="multi-surface-cell"
              data-surface={key}
            >
              <DeviceFrame
                surface={surface}
                elements={layout.elements}
                specById={specById}
                trace={trace}
                deviceType="auto"
                maxWidth={CELL.width}
                maxHeight={CELL.height}
              />
              <figcaption className="ale-stage-caption">
                {surface.name ?? key} · {surface.width}×{surface.height} ·{" "}
                {trace.winningStrategy} · {visible.length}/{layout.elements.length} visible
              </figcaption>
            </figure>
          );
        })}
      </div>
    </section>
  );
}
