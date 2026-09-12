/**
 * Stress Lab panel.
 *
 * "Run Stress Test" generates 200 randomized surface profiles, runs the real
 * pipeline against every one via runStressTest(), and shows the tiered summary
 * plus a click-through list of just the degraded/failed entries. Clicking an
 * entry calls `onInspect(surface)` so the parent can load that exact surface
 * into the main canvas for inspection with the panels.
 */

import { useState } from "react";
import { productAd } from "../core/sample-data";
import {
  categorizeStressDetail,
  DEGRADED_SCORE_THRESHOLD,
  generateRandomSurfaces,
  runStressTest,
  summarizeProblems,
  type StressResult,
} from "../core/stress-lab";
import type { SurfaceProfile } from "../core/surfaces";
import { useCountUp } from "./useCountUp";

/** Short chip label for each problem category — matches the row's own icon. */
const CATEGORY_TAG: Record<string, string> = {
  "invariant-violation": "⚠ invariant broken",
  "nothing-fits": "nothing fits",
  "always-element-dropped": "must-keep dropped",
  "quality-floor": "sparse but valid",
};

const SAMPLE_COUNT = 200;

function StatTile({
  label,
  value,
  decimals = 0,
  suffix = "",
  variant,
  testid,
}: {
  label: string;
  value: number;
  decimals?: number;
  suffix?: string;
  variant?: "ok" | "warn" | "bad" | "accent";
  testid: string;
}): JSX.Element {
  const shown = useCountUp(value);
  // The visible number animates; the data-testid node always carries the exact
  // settled value so automated checks never read a mid-animation frame.
  return (
    <div className={`ale-stat${variant ? ` ale-stat--${variant}` : ""}`}>
      <div className="ale-stat-label">{label}</div>
      <div className="ale-stat-value" aria-hidden>
        {shown.toFixed(decimals)}
        {suffix}
      </div>
      <span
        data-testid={testid}
        style={{ position: "absolute", width: 1, height: 1, overflow: "hidden", clipPath: "inset(50%)" }}
      >
        {value.toFixed(decimals)}
        {suffix}
      </span>
    </div>
  );
}

export function StressLab({
  onInspect,
}: {
  onInspect: (surface: SurfaceProfile) => void;
}): JSX.Element {
  const [result, setResult] = useState<StressResult | null>(null);
  const [running, setRunning] = useState(false);

  function run(): void {
    setRunning(true);
    setTimeout(() => {
      const surfaces = generateRandomSurfaces(SAMPLE_COUNT);
      setResult(runStressTest(productAd, surfaces));
      setRunning(false);
    }, 0);
  }

  const robustness =
    result && result.total > 0 ? (result.passed / result.total) * 100 : 0;

  const problems = result
    ? result.details.filter((d) => d.outcome !== "passed")
    : [];

  return (
    <section className="ale-panel" data-testid="stress-lab">
      <h2 className="ale-h2">Stress Lab</h2>
      <p className="ale-note" style={{ maxWidth: 640 }}>
        Generates {SAMPLE_COUNT} randomized surfaces (dimensions from 100×600 to
        3840×2160, random constraint mixes) and runs the real
        buildGraph → resolveContext → resolveLayout pipeline against each.
        Threshold for &ldquo;degraded&rdquo;: overall score &lt;{" "}
        {DEGRADED_SCORE_THRESHOLD}.
      </p>

      <button
        type="button"
        className="ale-btn"
        data-testid="run-stress-test"
        onClick={run}
        disabled={running}
      >
        {running ? "Running…" : "Run Stress Test"}
      </button>

      {result && (
        <div data-testid="stress-summary" style={{ marginTop: 16 }}>
          <div className="ale-stats">
            <StatTile label="total tested" value={result.total} testid="stat-total" />
            <StatTile label="passed" value={result.passed} variant="ok" testid="stat-passed" />
            <StatTile label="degraded" value={result.degraded} variant="warn" testid="stat-degraded" />
            <StatTile label="failed" value={result.failed} variant="bad" testid="stat-failed" />
            <StatTile
              label="robustness"
              value={robustness}
              decimals={1}
              suffix="%"
              variant="accent"
              testid="stat-robustness"
            />
          </div>

          {result.failed > 0 && (
            <p
              data-testid="stress-failed-warning"
              className="ale-error"
              style={{ marginTop: 4, fontWeight: 700 }}
            >
              ⚠ {result.failed} surface(s) broke a hard invariant. This should be
              impossible — investigate before trusting these results.
            </p>
          )}

          {problems.length > 0 && (
            <div data-testid="stress-conclusion" style={{ marginTop: 14 }}>
              <h3 className="ale-h3">
                Conclusion — why these {problems.length} landed below the bar
              </h3>
              <p className="ale-note" style={{ maxWidth: 640 }}>
                Every degraded/failed entry is grouped by root cause below, not
                just counted — a low score means something different on a
                surface where nothing fits than on one that's merely sparse.
              </p>
              <ul className="ale-list">
                {summarizeProblems(result.details).map((s) => (
                  <li
                    key={s.category}
                    className="ale-row ale-row--ok"
                    data-testid="stress-conclusion-row"
                    data-category={s.category}
                  >
                    <span className="ic" aria-hidden>
                      {s.category === "invariant-violation"
                        ? "❌"
                        : s.category === "quality-floor"
                          ? "⚠️"
                          : "ℹ️"}
                    </span>
                    <span>
                      <b>
                        {s.count} of {problems.length}
                      </b>{" "}
                      — <b>{s.label}</b>: {s.explanation}
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          <h3 className="ale-h3" style={{ marginTop: 14 }}>
            Degraded / failed entries ({problems.length}) — click one to load it
            into the main canvas
          </h3>
          {problems.length === 0 ? (
            <p className="ale-note" style={{ color: "var(--ok)" }}>
              Every surface passed at or above the threshold.
            </p>
          ) : (
            <ul className="ale-problem-list">
              {problems.map((d) => (
                <li key={d.surface.id}>
                  <button
                    type="button"
                    className="ale-problem"
                    data-testid="stress-problem-row"
                    data-outcome={d.outcome}
                    data-category={categorizeStressDetail(d) ?? ""}
                    onClick={() => onInspect(d.surface)}
                  >
                    <span>
                      <b
                        style={{
                          color:
                            d.outcome === "failed" ? "var(--bad)" : "var(--warn)",
                        }}
                      >
                        {d.outcome}
                      </b>{" "}
                      <span className="ale-chip" style={{ fontSize: "0.62rem" }}>
                        {CATEGORY_TAG[categorizeStressDetail(d) ?? ""] ?? ""}
                      </span>{" "}
                      · {d.surface.width}×{d.surface.height} · score{" "}
                      {d.overallScore}
                      {d.reason ? ` · ${d.reason}` : ""}
                    </span>
                    <span className="go">inspect →</span>
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
