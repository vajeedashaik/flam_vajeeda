/**
 * Panel 3 — Layout Health Check.
 *
 * A pass/warn/fail checklist derived purely from the winning candidate's
 * ScoreBreakdown. No new scoring logic — just presentation thresholds on top of
 * the existing numbers.
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

function verdict(score: number): { icon: string; cls: string } {
  if (score >= PASS) return { icon: "✓", cls: "ale-row--ok" };
  if (score >= WARN) return { icon: "⚠", cls: "ale-row--warn" };
  return { icon: "✕", cls: "ale-row--bad" };
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
    <section className="ale-panel" data-testid="layout-health-check">
      <h2 className="ale-h2">Layout Health Check</h2>
      <p className="ale-note">
        At-a-glance verdict for the winning layout ({trace.winningStrategy}).
      </p>

      {!score ? (
        <p className="ale-note" style={{ color: "var(--bad)" }}>
          No winning score available.
        </p>
      ) : (
        <ul className="ale-list">
          {ROWS.map(({ key, label }, i) => {
            const v = verdict(score[key]);
            return (
              <li
                key={key}
                className={`ale-row ${v.cls}`}
                data-testid="health-row"
                data-metric={key}
                style={{ animationDelay: `${i * 45}ms` }}
              >
                <span className="ale-row-split">
                  <span style={{ display: "flex", gap: 10, alignItems: "center" }}>
                    <span className="ic" aria-hidden>
                      {v.icon}
                    </span>
                    {label}
                  </span>
                  <span className="val">{score[key]}</span>
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
