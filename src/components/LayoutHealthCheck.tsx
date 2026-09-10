/**
 * Panel 3 — Layout Health Check.
 *
 * A pass/warn/fail checklist derived purely from the winning candidate's
 * ScoreBreakdown. No new scoring logic — just presentation thresholds on top of
 * Phase 3's numbers.
 *
 * THRESHOLDS (applied identically to all five sub-scores, each 0-100):
 *   score ≥ 85  → ✓  pass
 *   score ≥ 60  → ⚠  warn
 *   else        → ✕  fail
 */

import type { DecisionTrace } from "../core/trace";
import type { ScoreBreakdown } from "../core/scoring";

const PASS = 85;
const WARN = 60;

const ROWS: { key: keyof Omit<ScoreBreakdown, "overall">; label: string }[] = [
  { key: "constraintViolations", label: "Constraint compliance" },
  { key: "priorityPreservation", label: "Priority preservation" },
  { key: "visualBalance", label: "Visual balance" },
  { key: "tapTargetCompliance", label: "Tap-target compliance" },
  { key: "renderCost", label: "Render efficiency" },
];

function verdict(score: number): { icon: string; color: string } {
  if (score >= PASS) return { icon: "✓", color: "#2a7" };
  if (score >= WARN) return { icon: "⚠", color: "#b80" };
  return { icon: "✕", color: "#c33" };
}

export function LayoutHealthCheck({
  trace,
}: {
  trace: DecisionTrace;
}): JSX.Element {
  const winning = trace.candidateScores.find(
    (c) => c.strategy === trace.winningStrategy,
  );
  const score = winning?.score;

  return (
    <section data-testid="layout-health-check" style={{ minWidth: 260 }}>
      <h2 style={{ fontSize: 14, margin: "0 0 6px" }}>Layout Health Check</h2>
      <p style={{ fontSize: 11, color: "#666", margin: "0 0 8px" }}>
        At-a-glance verdict for the winning layout ({trace.winningStrategy}).
      </p>

      {!score ? (
        <p style={{ fontSize: 12, color: "#c33" }}>No winning score available.</p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {ROWS.map(({ key, label }) => {
            const v = verdict(score[key]);
            return (
              <li
                key={key}
                data-testid="health-row"
                data-metric={key}
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  fontSize: 12,
                  padding: "5px 0",
                  borderBottom: "1px solid #eee",
                }}
              >
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <span
                    aria-hidden
                    style={{ color: v.color, fontWeight: 700, width: 14 }}
                  >
                    {v.icon}
                  </span>
                  {label}
                </span>
                <span style={{ color: "#888" }}>{score[key]}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
