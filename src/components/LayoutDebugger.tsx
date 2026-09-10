/**
 * Panel 1 — Layout Debugger.
 *
 * Renders DecisionTrace.perElementNotes as a readable list, one row per note,
 * each with a status icon.
 *
 * ICON RULE (deterministic, substring match, checked in this order):
 *   1. note contains "dropped"           → ❌  (element was cut entirely)
 *   2. note contains "shrunk" or "shrank" → ⚠️  (element kept but below preferred size)
 *   3. otherwise                          → ✓   (element placed as wanted)
 * The match is case-insensitive. No judgement per string — just these three
 * substrings. If perElementNotes is empty, every element was placed cleanly and
 * the panel says so.
 */

import type { DecisionTrace } from "../core/trace";

function iconFor(note: string): string {
  const n = note.toLowerCase();
  if (n.includes("dropped")) return "❌";
  if (n.includes("shrunk") || n.includes("shrank")) return "⚠️";
  return "✓";
}

export function LayoutDebugger({ trace }: { trace: DecisionTrace }): JSX.Element {
  const notes = trace.perElementNotes;

  return (
    <section data-testid="layout-debugger" style={{ minWidth: 280 }}>
      <h2 style={{ fontSize: 14, margin: "0 0 6px" }}>Layout Debugger</h2>
      <p style={{ fontSize: 11, color: "#666", margin: "0 0 8px" }}>
        Per-element decision trace for the <b>{trace.winningStrategy}</b> layout.
      </p>

      {notes.length === 0 ? (
        <p style={{ fontSize: 12, color: "#2a7" }}>
          ✓ Every element placed at its preferred size — nothing shrunk or dropped.
        </p>
      ) : (
        <ul style={{ listStyle: "none", padding: 0, margin: 0 }}>
          {notes.map((note, i) => (
            <li
              key={i}
              data-testid="debugger-note"
              style={{
                display: "flex",
                gap: 8,
                alignItems: "flex-start",
                fontSize: 12,
                lineHeight: 1.4,
                padding: "4px 0",
                borderBottom: "1px solid #eee",
              }}
            >
              <span aria-hidden style={{ flex: "0 0 auto" }}>
                {iconFor(note)}
              </span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
