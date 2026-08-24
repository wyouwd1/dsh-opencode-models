# Changelog

## Unreleased

- The free-tier live view is now an explicit official allowlist sourced from the OpenCode Zen docs pricing table (https://opencode.ai/docs/zh-cn/zen/, fetched 2026-08-24): big-pickle, ox-alpha-free, mimo-v2.5-free, hy3-free, nemotron-3-ultra-free, nemotron-3.5-lightning-free, muse-spark-1.2-contributor-free. Ids this user already configured stay managed (never flagged delisted), but neither the paid ids the endpoint also advertises nor suffix-only ids outside the official table (x-preview-f-free, deepseek-v4-flash-free, laguna-s-2.1-free) count, drift or appear under "available" — in the panel or in oc_model_status / oc_model_add / oc_model_sync.
- The OpenCode Models section is pinned to the top of the settings sidebar (order -100): the Free tier card first, the Go tier card second, every other settings section below.
- Every configured row gains a checkbox; the bulk bar deletes any mix of selected models across the two OpenCode cards in one confirmation, with one revision-guarded write per affected route. The panel manages the two OpenCode routes only.
- Fix: the settings section crashed on mount (blank content under a live nav entry) because the wire envelope was unwrapped synchronously from a Promise; the unwrap now awaits the call, covered by a headless mount test.

## 0.1.0

- Four agent tools (`oc_model_status`, `oc_model_add`, `oc_model_remove`, `oc_model_sync`) that fetch the OpenCode Zen free/Go listings live and manage the two `llm-pi-ai` routes in `~/.dsh/settings.yaml` with a settings-revision guard.
- "OpenCode Models" web settings section with per-tier drift view, checkbox adoption of online ids, per-row remove, and two-step sync; honors a read-only settings provider.
- Cross-tier id protection: an id absent from the target tier's listing but present in the sibling tier's is refused, never silently added.
- Assumed-capacity policy for the id-only listing endpoints, reported per entry.
