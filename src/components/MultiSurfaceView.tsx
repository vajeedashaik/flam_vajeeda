/**
 * Side-by-side multi-surface view.
 *
 * Renders all five sample surfaces at once, each resolved through the real
 * pipeline (buildGraph is shared; resolveContext + resolveLayout run per
 * surface) and drawn in a device-style frame, scaled to fit a grid cell.
 * Every mini-render is the actual resolved layout — no mockups.
 */

import { useMemo } from "react";
import { surfaceProfiles } from "../core/sample-data";
import { resolveContext } from "../core/context";
import { resolveLayout } from "../core/resolver";
import type { ExperienceGraph } from "../core/graph";
import type { AdElement } from "../core/spec";
import { SurfaceStage, type StageFrame } from "./SurfaceStage";

const CELL = { width: 340, height: 340 };

const SURFACES: { key: keyof typeof surfaceProfiles; frame: StageFrame }[] = [
  { key: "mobilePortrait", frame: "phone" },
  { key: "mobileLandscape", frame: "phone" },
  { key: "broadcastLowerThird", frame: "wide" },
  { key: "retailKiosk", frame: "square" },
  { key: "printQRPanel", frame: "square" },
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
      SURFACES.map(({ key, frame }) => {
        const surface = surfaceProfiles[key];
        const { layout, trace } = resolveLayout(
          graph,
          resolveContext(surface),
          surface,
        );
        return { key, frame, surface, layout, trace };
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
        {resolved.map(({ key, frame, surface, layout, trace }) => {
          const visible = layout.elements.filter((e) => e.visible);
          return (
            <div key={key} data-testid="multi-surface-cell" data-surface={key}>
              <SurfaceStage
                surface={surface}
                elements={layout.elements}
                specById={specById}
                maxWidth={CELL.width}
                maxHeight={CELL.height}
                frame={frame}
                caption={`${surface.name ?? key} · ${surface.width}×${surface.height} · ${
                  trace.winningStrategy
                } · ${visible.length}/${layout.elements.length} visible`}
              />
            </div>
          );
        })}
      </div>
    </section>
  );
}
