# Clients and the shared package

[Architecture](README.md) · [Documentation](../README.md)

How dashboard and mobile consume shared TypeScript and design tokens.

`packages/shared` is consumed from source: `main` and `types` in its
`package.json` point at `src/index.ts`, which re-exports `constants`, `types`,
`services`, `utils` and `hooks`; there is no build step and no `dist/`. The
`hooks` barrel ships `ApiClientProvider`/`useApiClient` and shared hooks, so `react` and `@tanstack/react-query` are
`peerDependencies` supplied by the importing client. Mobile must supply one copy
of each: `metro.config.js` reanchors both specifiers to `mobile/index.ts`,
`jest.config.js` maps them to `mobile/node_modules`, and
`mobile/scripts/shared-peer-resolution.mjs` (the last step of
`check-resolution.mjs`) fails if a real Metro resolution from `App.tsx` and one
from a shared hook disagree.

- The dashboard resolves it through the root npm workspace link
  (`node_modules/@ledova/shared` to `packages/shared`); Vite and `tsc -b` follow
  the symlink to its real path outside `node_modules`, so the sources are
  transformed and type-checked as application code.

Every client import is `from '@ledova/shared'`. `packages/shared/src/services`
holds the API call functions both clients share; each takes the caller's axios
instance as its first argument, so each client keeps its own interceptors.

The design tokens are the single source of colour, spacing and radius values.
`make generate-tokens` runs `packages/scripts/generate-css-tokens.mjs` with
`tsx` over `packages/shared/src/constants/ui/design-tokens.ts` and writes
`dashboard/src/styles/tokens.css` and `marketing/src/tokens.css`, raw generator
output and prettier-ignored. Tailwind v4 reads that `@theme` block and derives
the utility classes (`bg-surface-base`, `text-text-body`,
`border-border-subtle`). Never edit either file: CI regenerates them after `make
build` and fails on any drift.

Mobile resolves the package through its Metro configuration and local workspace
link. Run `npm --prefix mobile run check:resolution` after dependency/resolution
changes. Internal shared imports are relative; `make check-self-imports` refuses
self-imports through the public barrel. These checks complement type checking.

Next: [authentication](authentication.md), [mobile security](mobile-security.md),
[mobile lifecycles](mobile-lifecycles.md), and [mobile builds](../development/mobile-builds.md).
