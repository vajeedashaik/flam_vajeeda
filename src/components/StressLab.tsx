/**
 * 5.1 — Stress Lab panel.
 *
 * "Run Stress Test" generates 200 randomized surface profiles, runs the real
 * pipeline against every one via runStressTest(), and shows the tiered summary
 * plus a click-through list of just the degraded/failed entries. Clicking an
 * entry calls `onInspect(surface)` so the parent can load that exact surface
 * into the main canvas for inspection with the Phase 4 panels.
 */

import { useState } from "react";
import { productAd } from "../core/sample-data";
import {
  DEGRADED_SCORE_THRESHOLD,
  generateRandomSurfaces,
  runStressTest,
  type StressResult,
} from "../core/stress-lab";
import type { SurfaceProfile } from "../core/surfaces";

const SAMPLE_COUNT = 200;

export function StressLab({
  onInspect,
}: {
  onInspect: (surface: SurfaceProfile) => void;
}): JSX.Element {
  const [result, setResult] = useState<StressResult | null>(null);
  const [running, setRunning] = useState(false);

  function run(): void {
    setRunning(true);
    // Let the button repaint as "running" before the synchronous work blocks.
    setTimeout(() => {
      const surfaces = generateRandomSurfaces(SAMPLE_COUNT);
      setResult(runStressTest(productAd, surfaces));
      setRunning(false);
    }, 0);
  }

  const robustness =
    result && result.total > 0
      ? ((result.passed / result.total) * 100).toFixed(1)
      : null;

  const problems = result
    ? result.details.filter((d) => d.outcome !== "passed")
    : [];

  return (
    <section data-testid="stress-lab" style={{ fontSize: 13 }}>
      <h2 style={{ fontSize: 16, margin: "0 0 8px" }}>Stress Lab</h2>
      <p style={{ fontSize: 12, color: "#555", margin: "0 0 10px", maxWidth: 640 }}>
        Generates {SAMPLE_COUNT} randomized surfaces (dimensions from 100×600 to
        3840×2160, random constraint mixes) and runs the real
        buildGraph → resolveContext → resolveLayout pipeline against each.
        Threshold for "degraded": overall score &lt; {DEGRADED_SCORE_THRESHOLD}.
      </p>

      <button
        type="button"
        data-testid="run-stress-test"
        onClick={run}
        disabled={running}
        style={{
          fontSize: 13,
          padding: "8px 16px",
          cursor: running ? "default" : "pointer",
          border: "1px solid #0066cc",
          background: running ? "#eee" : "#e8f1fb",
          borderRadius: 4,
        }}
      >
        {running ? "Running…" : "Run Stress Test"}
      </button>

      {result && (
        <div data-testid="stress-summary" style={{ marginTop: 14 }}>
          <div
            style={{
              display: "flex",
              gap: 18,
              flexWrap: "wrap",
              fontSize: 13,
              marginBottom: 8,
            }}
          >
            <span>
              total tested: <b data-testid="stat-total">{result.total}</b>
            </span>
            <span style={{ color: "#2a7" }}>
              passed: <b data-testid="stat-passed">{result.passed}</b>
            </span>
            <span style={{ color: "#b80" }}>
              degraded: <b data-testid="stat-degraded">{result.degraded}</b>
            </span>
            <span style={{ color: "#c33" }}>
              failed: <b data-testid="stat-failed">{result.failed}</b>
            </span>
            <span>
              robustness (passed/total):{" "}
              <b data-testid="stat-robustness">{robustness}%</b>
            </span>
          </div>

          {result.failed > 0 && (
            <p
              data-testid="stress-failed-warning"
              style={{ color: "#c33", fontWeight: 700 }}
            >
              ⚠ {result.failed} surface(s) broke a hard invariant. This should be
              impossible — investigate before trusting these results.
            </p>
          )}

          <h3 style={{ fontSize: 13, margin: "12px 0 6px" }}>
            Degraded / failed entries ({problems.length}) — click one to load it
            into the main canvas
          </h3>
          {problems.length === 0 ? (
            <p style={{ color: "#2a7" }}>
              Every surface passed at or above the threshold.
            </p>
          ) : (
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                maxHeight: 320,
                overflowY: "auto",
                border: "1px solid #eee",
              }}
            >
              {problems.map((d) => (
                <li key={d.surface.id}>
                  <button
                    type="button"
                    data-testid="stress-problem-row"
                    data-outcome={d.outcome}
                    onClick={() => onInspect(d.surface)}
                    style={{
                      width: "100%",
                      textAlign: "left",
                      display: "flex",
                      justifyContent: "space-between",
                      gap: 12,
                      fontSize: 12,
                      padding: "6px 10px",
                      border: "none",
                      borderBottom: "1px solid #eee",
                      background: d.outcome === "failed" ? "#fdecec" : "#fff7e6",
                      cursor: "pointer",
                    }}
                  >
                    <span>
                      <b
                        style={{
                          color: d.outcome === "failed" ? "#c33" : "#b80",
                        }}
                      >
                        {d.outcome}
                      </b>{" "}
                      · {d.surface.width}×{d.surface.height} · score{" "}
                      {d.overallScore}
                      {d.reason ? ` · ${d.reason}` : ""}
                    </span>
                    <span style={{ color: "#0066cc" }}>inspect →</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </section>
  );
}
