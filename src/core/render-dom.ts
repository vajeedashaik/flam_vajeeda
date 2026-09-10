/**
 * Framework-agnostic rendering target — placeholder for a later phase.
 *
 * Phase 2 renders a ResolvedLayout straight from React (see `src/App.tsx`). Once
 * that React layer is reduced to a thin wrapper, the actual DOM/CSS construction
 * — turning ResolvedElements into absolutely-positioned nodes — will move here so
 * non-React hosts can reuse it. Intentionally not built out yet.
 */

import type { ResolvedLayout } from "./resolver";

export function renderToDom(_layout: ResolvedLayout): void {
  // Not implemented in Phase 2. See file header.
}
