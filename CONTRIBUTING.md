# Contributing

Thanks for helping out. Nightjar is AGPL-3.0, so contributions are under the same license.

## Sign off your commits

We use the Developer Certificate of Origin. Add `-s` when you commit:

```
git commit -s -m "feat: add entry list"
```

## Commit messages

Conventional commits: `feat:`, `fix:`, `test:`, `docs:`, `chore:`. They feed the changelog.

## How we work

1. Spec first. New features start as `docs/specs/NNN-name.md` (copy `_template.md`) with numbered acceptance criteria.
2. Test first. One failing test per acceptance criterion, named after it, then the code.
3. Keep code small, boring and well named. Every user-facing string goes through i18n, in both `hu` and `en`.

More detail in `docs/engineering.md`.

## Running it

You need Node 26 and pnpm 12.

```
pnpm install
pnpm dev
```

Server on http://localhost:3000, web app on http://localhost:5173.
Before you push: `pnpm lint`, `pnpm typecheck`, `pnpm format:check`.
