# Changelog

## Unreleased

- The OpenCode Models section is pinned to the top of the settings sidebar (order -100): the Free tier card first, the Go tier card second, every other settings section below.
- Third card shows the official DeepSeek section (llm-deepseek) with its configured models.
- Every configured row gains a checkbox; the bulk bar deletes any mix of selected models across the three cards in one confirmation, with one revision-guarded write per affected namespace.
- Fix: the settings section crashed on mount (blank content under a live nav entry) because the wire envelope was unwrapped synchronously from a Promise; the unwrap now awaits the call, covered by a headless mount test.

## 0.1.0

- Four agent tools (`oc_model_status`, `oc_model_add`, `oc_model_remove`, `oc_model_sync`) that fetch the OpenCode Zen free/Go listings live and manage the two `llm-pi-ai` routes in `~/.dsh/settings.yaml` with a settings-revision guard.
- "OpenCode Models" web settings section with per-tier drift view, checkbox adoption of online ids, per-row remove, and two-step sync; honors a read-only settings provider.
- Cross-tier id protection: an id absent from the target tier's listing but present in the sibling tier's is refused, never silently added.
- Assumed-capacity policy for the id-only listing endpoints, reported per entry.
