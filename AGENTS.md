# Repository Guidelines

## Project Structure & Module Organization

`mod.ts` defines the root package API, while `types.ts` contains shared public types. Server-only
rendering and SVG decomposition live in `server/`; browser asset descriptors live in
`assets/mod.ts`. Treat `internal/` and `assets/private/` as implementation details, not import
targets. Tests are grouped in `tests/`: `unit_test.ts` covers generation and rendering,
`contract_test.ts` protects package and asset contracts, and `browser_test.ts` exercises the facial
rig in Chromium. `fixtures/external-consumer/` verifies that the published entry points work from a
separate Deno project.

## Build, Test, and Development Commands

- `deno task check`: run the complete formatting, lint, type, unit, browser, and consumer gate.
- `deno task unit`: run unit and contract tests with minimal file permissions.
- `deno task browser`: install the pinned Chromium build and run Playwright tests.
- `deno task type`: type-check public entry points and all test suites.
- `deno task consumer`: validate the isolated external-consumer fixture.
- `deno fmt`: format changed files; `deno task fmt` only checks formatting.

## Coding Style & Naming Conventions

Use strict TypeScript and Deno conventions: two-space indentation, double quotes, semicolons, and a
100-column limit. Prefer pure functions, explicit dependencies, `Readonly` data, and tagged unions
with exhaustive handling. Use `camelCase` for values and functions, `PascalCase` for types, and
descriptive lowercase filenames such as `avataaars_preset.ts`. Keep side effects at package edges
and validate caller-controlled SVG, text, IDs, and configuration.

## Testing Guidelines

Use `Deno.test` with `jsr:@std/assert`. Name tests as behavioral statements, for example,
`Deno.test("human photos bypass generation")`. Add a regression test for each bug or behavior
change. Preserve byte-level fingerprint and asset-hash assertions unless an explicit compatibility
change updates both implementation and expectations. Run the narrow relevant task during
development, then `deno task check` before handoff.

## Commit & Pull Request Guidelines

Follow the repository's Conventional Commit style, such as `feat: add expression preset` or
`chore: tighten permissions`. Keep commits small and focused. A pull request should explain the
user-visible or contract impact, list exact verification commands, link related work, and include
screenshots for visual browser changes. Do not commit secrets, generated build output, or dependency
directories. Record durable project assumptions in `ASSUMPTIONS.md`.
