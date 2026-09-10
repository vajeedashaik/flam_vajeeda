/**
 * Panel 1 — Layout Debugger.
 *
 * Renders DecisionTrace.perElementNotes as a readable list, one row per note,
 * each with a status icon.
 *
 * ICON RULE (deterministic, substring match, checked in this order):
 *   1. note contains "dropped"            → ❌  (element was cut entirely)
 *   2. note contains "shrunk" or "shrank" → ⚠️  (element kept but below preferred size)
 *   3. otherwise                          → ✓   (element placed as wanted)
 * The match is case-insensitive. If perElementNotes is empty, every element was
 * placed cleanly and the panel says so.
 */

import type { DecisionTrace } from "../core/trace";

function statusFor(note: string): { icon: string; cls: string } {
  const n = note.toLowerCase();
  if (n.includes("dropped")) return { icon: "❌", cls: "ale-row--bad" };
  if (n.includes("shrunk") || n.includes("shrank"))
    return { icon: "⚠️", cls: "ale-row--warn" };
  return { icon: "✓", cls: "ale-row--ok" };
}

export function LayoutDebugger({ trace }: { trace: DecisionTrace }): JSX.Element {
  const notes = trace.perElementNotes;

  return (
    <section className="ale-panel" data-testid="layout-debugger">
      <h2 className="ale-h2">Layout Debugger</h2>
      <p className="ale-note">
        Per-element decision trace for the <b>{trace.winningStrategy}</b> layout.
      </p>

      {notes.length === 0 ? (
        <p className="ale-note" style={{ color: "var(--ok)" }}>
          ✓ Every element placed at its preferred size — nothing shrunk or dropped.
        </p>
      ) : (
        <ul className="ale-list">
          {notes.map((note, i) => {
            const s = statusFor(note);
            return (
              <li
                key={i}
                className={`ale-row ${s.cls}`}
                data-testid="debugger-note"
                style={{ animationDelay: `${i * 45}ms` }}
              >
                <span className="ic" aria-hidden>
                  {s.icon}
                </span>
                <span>{note}</span>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
