PHASE 1 — Foundation & Types

Context: I'm building an Adaptive Layout Engine — a TypeScript system that takes one
declarative ad spec and resolves it into correct, distinct layouts for different
"surfaces" (mobile, broadcast, kiosk, etc.), governed by each surface's real-world
constraints. This phase only builds the typed foundation — no layout algorithm yet.

GOAL FOR THIS PHASE
Set up the project and define fully-typed, validated data models for:
1. Ad specs (the content + intent, independent of surface)
2. Surface profiles (the target's real constraints, including context — not just
   width/height)

No resolution/layout logic yet. No React rendering yet. This phase proves the type
system makes invalid input hard to construct and produces clear errors.

PROJECT SETUP
- Use Vite + React + TypeScript (strict mode) for eventual demo app, but this phase
  only touches the `src/core` layer, not any UI.
- Use Vitest for unit tests.
- Folder structure:
  src/
    core/
      spec.ts          — ad spec types + defineAd()
      surfaces.ts       — surface profile types + defineSurface()
      sample-data.ts    — one realistic example ad spec + 5 surface profiles
    core/__tests__/
      spec.test.ts
      surfaces.test.ts
  package.json, tsconfig.json (strict: true), vite.config.ts, vitest.config.ts

REQUIREMENTS — spec.ts
- Element roles: "primary" | "hero" | "action" | "branding" | "secondary" (extend if
  needed, but keep it a closed union, not a free string).
- Element types: "text" | "image" | "button" (closed union).
- Each element has: id (string), type, role, priority (number, lower = more critical),
  and these additional fields for future phases (define now, unused for now):
    importance?: "critical" | "should-survive" | "nice-to-have"
    interaction?: "clickable" | "static"
    visibility?: "always" | "degradable" | "decorative-only"
    minSize?: { width: number; height: number }
    preferredSize?: { width: number; height: number }
    brandRules?: { locked?: boolean; minSize?: { width: number; height: number } }
- `defineAd(config)` factory function:
    - Validates at construction time: every element has a valid role from the closed
      union, no duplicate ids, priority is a positive number.
    - Throws a clear, specific Error (not a generic one) naming which element and
      which field failed validation, if invalid.
    - Returns a fully-typed AdSpec object.
- An invalid role (e.g. a typo like "primry") must be a TypeScript compile error
  when using defineAd with a literal object — demonstrate this with a comment showing
  what the compiler error looks like (don't leave broken code in the file; show it in
  a comment block or a separate .ts file excluded from build, e.g. `spec.invalid-example.ts.txt`).

REQUIREMENTS — surfaces.ts
- SurfaceProfile type includes:
    width: number
    height: number
    safeArea?: { top: number; right: number; bottom: number; left: number }
    minTapTarget?: number
    minTextSize?: number
    touchOnly?: boolean
    viewingDistance?: "near" | "far" | number (cm)
    interaction?: "none" | "touch" | "remote"
    attentionWindow?: number (seconds)
    motion?: boolean
    audio?: boolean
- `defineSurface(config)` factory function with the same validation-with-clear-errors
  approach as defineAd (e.g. width/height must be positive, minTapTarget required if
  touchOnly is true — this is a genuine cross-field constraint, encode it).
- An invalid/missing required combination (e.g. touchOnly: true with no minTapTarget)
  must throw a clear runtime error naming the surface and the missing constraint.

SAMPLE DATA — sample-data.ts
- One realistic ad spec: headline (text, primary), product image (image, hero),
  price (text, secondary), CTA (button, action), logo (image, branding). Use
  realistic priority values.
- Five surface profiles: mobilePortrait, mobileLandscape, broadcastLowerThird,
  retailKiosk, printQRPanel — with realistic, genuinely different constraint values
  for each (not just different width/height).

TESTS TO WRITE (Vitest)
- spec.test.ts:
  - defineAd() with a fully valid config returns a correctly-typed object.
  - defineAd() with a duplicate id throws, and the error message names the duplicate id.
  - defineAd() with a missing/invalid priority throws with a clear message.
- surfaces.test.ts:
  - defineSurface() with a valid config returns a correctly-typed object.
  - defineSurface() with touchOnly: true and no minTapTarget throws with a clear message.
  - defineSurface() with negative width/height throws.

ACCEPTANCE CRITERIA — DO NOT PROCEED PAST THIS PHASE UNTIL ALL OF THESE PASS
1. `npm run build` / `tsc --noEmit` completes with zero type errors on valid code.
2. All Vitest tests pass — run `npm run test` and paste the full output.
3. Manually attempt (in a scratch file, not committed) constructing an invalid AdSpec
   with a bad role literal, and confirm — and show me — the exact TypeScript compiler
   error text.
4. Show me the final file tree and the full contents of spec.ts and surfaces.ts.

NOTE ON TESTING THIS PHASE: there is no UI yet, so chrome-devtools MCP has nothing to
inspect this phase — that's expected. Devtools testing starts in Phase 3 once there's
a rendered page. Do not skip ahead into resolver logic or rendering — stop after the
acceptance criteria above are met and report back.