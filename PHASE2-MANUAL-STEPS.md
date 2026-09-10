# Phase 2 — Manual steps for you

Short version: **there are no blocking manual steps.** Phase 2 added only
source + test files and a demo entrypoint. No new dependencies, no config
secrets, no schema/migration, nothing to click through. Everything below is
optional verification you can run yourself.

## What Phase 2 added

| File | Purpose |
|------|---------|
| `src/core/graph.ts` | `ExperienceGraph` type, `buildGraph(spec)`, `getRelatedNodes()` |
| `src/core/context.ts` | `Context` type, `resolveContext(surface)` |
| `src/core/resolver.ts` | `ResolvedLayout` type, `resolveLayout(graph, context, surface)` — single greedy pass |
| `src/core/render-dom.ts` | Deliberate stub (framework-agnostic renderer lands later) |
| `src/App.tsx` | Minimal demo: sample spec resolved against `mobilePortrait` |
| `src/main.tsx`, `index.html` | Vite React entrypoint (needed for `npm run dev`) |
| `src/core/__tests__/{graph,context,resolver}.test.ts` | Vitest suites |

Phase 1 files (`spec.ts`, `surfaces.ts`, `sample-data.ts`) were **not modified**.

## Optional: verify locally

```bash
# 1. Typecheck — expect no output, exit 0
npm run typecheck

# 2. Tests — expect "Test Files 5 passed / Tests 33 passed"
npm test

# 3. Demo page in a real browser
npm run dev
#   then open http://localhost:5173
#   you should see 5 stacked, non-overlapping boxes labelled:
#   primary (headline) / action (cta) / hero (product-image) /
#   secondary (price) / branding (logo)
```

If you cloned this fresh onto another machine and `npm test` fails with
"command not found" style errors, run `npm install` once first. On this
machine it is already installed from Phase 1.

## Already done for you (Phase 2 acceptance criteria)

- `tsc --noEmit` — clean.
- All 33 Vitest tests pass.
- Dev server + chrome-devtools MCP browser check — done. Screenshot,
  resolver raw output, and DOM/overlap inspection are in the chat reply
  that linked you this file.

## Stop point

Phase 2 is complete. Not started (correctly): multi-surface support,
candidate generation, fitness scoring — those are Phase 3.
