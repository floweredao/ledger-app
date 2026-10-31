# Contributing

Thanks for helping. This is a small personal-finance app, so changes stay focused and every behavior change comes with a test.

## Setup

You need [Bun](https://bun.sh) 1.4.2 or later.

```sh
bun install --frozen-lockfile
bun run start      # API on 127.0.0.1:4340
bun run dev        # Vite on 127.0.0.1:4341, proxies /api to the server
```

Use a throwaway data directory while you work, so your own ledger is never touched:

```sh
LEDGER_DATA_DIR=$(mktemp -d) bun run start
```

## Checks

Run all four before you open a pull request:

```sh
bun test
bunx tsc --noEmit
bunx biome check .
bun run build
```

`bun run test:responsive` checks phone widths in Chrome or Chromium when you change layout.

## Rules for changes

- Read [DESIGN.md](DESIGN.md) before changing UI and [docs/API.md](docs/API.md) before changing API or data behavior. If you add or change an endpoint, update docs/API.md in the same change.
- Show a behavior change with a test that fails before your fix.
- Tests and fixtures use synthetic data only (for example "테스트마트", "샘플카페", "홍길동"). Never commit real names, account numbers, transactions, `data/`, or `.env`.
- The server binds to loopback addresses only. Don't add options that expose it on other interfaces.
- Keep the UI text in both Korean and English.

## Issues and pull requests

Open an issue that describes the problem and when it counts as fixed, then a pull request from a branch named `<type>/<issue>-<slug>` (for example `fix/12-month-end-budget`). Commit messages follow `type(scope): summary (#issue)`. In the pull request, list what you changed, why, and which checks you ran with their results.
