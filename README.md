# dsh-opencode-models

[English](README.md) | [中文](README.zh.md)

Manage [OpenCode Zen](https://opencode.ai/docs/zen/) free-tier and Go-tier models in DeepSeek Harness: fetch the live model listings from opencode.ai on demand, compare them with what your routes actually serve, and add or remove entries — through four agent tools and an "OpenCode Models" settings page.

```sh
dsh plugin --profile web add github:wyouwd1/dsh-opencode-models
```

## What it does

DeepSeek Harness serves OpenCode Zen through two `llm-pi-ai` provider routes configured in `~/.dsh/settings.yaml`:

| Route | Tier | Endpoint | Model ids |
| --- | --- | --- | --- |
| `opencode` | Free (`PI_AI_API_KEY`) | `https://opencode.ai/zen/v1` | usually `-free`-suffixed |
| `opencode-go` | Go subscription | `https://opencode.ai/zen/go/v1` | unsuffixed |

The listing endpoints disclose **ids only** — no context windows, output caps, modalities, or reasoning levels — and the lists change over time (limited-time models get delisted). This plugin keeps the two layers honest against each other. The same model often has different ids per tier (`x-preview-f-free` vs `x-preview-f`); it never mixes them.

### Agent tools

| Tool | What it does |
| --- | --- |
| `oc_model_status` | Fetches both listings live and reports per tier: configured count, live count, online-but-not-configured ids, delisted-but-still-configured ids. Read-only. |
| `oc_model_add` | Adds entries to one route. Pass `ids` copied verbatim from a status report or full `models` entries. Ids whose capacities the listing hides require `assumeDefaults: true` (contextWindow 128000, maxTokens 32000, input text) — every assumption is reported so you can correct it later. An id present only in the *other* tier's listing is refused with the two-tier id rule explained. |
| `oc_model_remove` | Removes configured ids from one route; reports not-found ids and skips the write when nothing matched. |
| `oc_model_sync` | Previews drift for both tiers by default. With `apply: true` it adds every online-not-configured id (assumed capacities flagged); with `pruneStale: true` it also removes delisted ids. |

Model-list edits take effect on the next request — no restart. This plugin never adds or removes whole routes; declaring a new route (apiKeyEnv/baseURL) stays on the Models page and still needs a restart.

### "OpenCode Models" settings section

A section pinned to the TOP of the web settings sidebar shows three cards in order — OpenCode Zen free tier, Go tier, then the official DeepSeek section (llm-deepseek) — with per-row checkboxes and a bulk **delete-selected** bar that trims any mix of models across the three lists in one confirmation, removing them from the conversation model list on the next request: configured entries with a "delisted" flag on stale ones, checkboxes over online-not-configured ids, per-row remove, and a two-click sync (preview → confirm). It reads and writes exclusively through the existing configuration-page contracts — `settings.describe` / `settings.update` with `expectedRevision`, and `llm.discoverModels` for the live listings — and refreshes only while open when pushed invalidations arrive.

Writes are guarded by the settings revision: if the Models page or another session writes first, this plugin re-reads once instead of overwriting it, and schema-invalid candidates are refused before anything persists.

## Install

From a checkout:

```sh
dsh plugin --profile web add /path/to/dsh-opencode-models
dsh --profile web
```

From GitHub (sources install without any build step — the shipped `lib/` artifacts are plain ESM):

```sh
dsh plugin --profile web add github:wyouwd1/dsh-opencode-models
```

Requirements: DeepSeek Harness ≥ 0.1.1-rc.1 (the `llm-pi-ai` adapter family, settings seam, and web app), Node ≥ 22.

## Configuration

No config keys. The two tier definitions (route keys, base URLs) follow the official OpenCode Zen endpoint layout and the shared credential comes from each route's existing `apiKeyEnv` (`PI_AI_API_KEY`). Missing credentials surface the endpoint's 401 message verbatim in tool output and in the panel.

## Assumed capacities

The zen listing discloses nothing but ids, so any entry adopted by id needs capacities from somewhere. This plugin's policy:

- Explicit `models` entries win — pass real figures when you know them.
- Otherwise `assumeDefaults: true` (tools) or accepting the panel's checkbox flow fills `contextWindow: 128000, maxTokens: 32000, input: ["text"]`.
- Every assumed value is reported back by name; correct them via `oc_model_remove` + a full re-add whenever you learn better numbers.

Assuming wrong capacities degrades context filing and output caps; it never blocks requests.

## Development

```sh
npm test          # node:test suites over lib/shared.js, lib/writer.js, lib/tools.js
```

The host face (`lib/index.js`) imports no `@deepseek-ai/*` package: tools register as plain definitions and all services resolve through the cordis context at call time. The browser face (`lib/client.js`) ships as the closure-factory artifact the module loader expects and requires only platform-seeded modules (`react`, `dsh-client-ui-primitives`).

## Verification

Reproduce the install smoke test against an isolated DSH home (no effect on your real `~/.dsh`):

```sh
DSH_HOME=/tmp/ocmm-home dsh plugin --profile web add /path/to/dsh-opencode-models
DSH_HOME=/tmp/ocmm-home dsh --profile web --dump-config | grep opencode-model   # shows the "# == dsh-opencode-models" layer
DSH_HOME=/tmp/ocmm-home dsh --profile web --port 3101 --no-open                 # then open http://127.0.0.1:3101
curl -f http://127.0.0.1:3101/plugins/dsh-opencode-models/client.js             # the served browser half
```

## License

[MIT](LICENSE)
