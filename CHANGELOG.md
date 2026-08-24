# Changelog

## 0.1.0

- Four agent tools (`oc_model_status`, `oc_model_add`, `oc_model_remove`, `oc_model_sync`) that fetch the OpenCode Zen free/Go listings live and manage the two `llm-pi-ai` routes in `~/.dsh/settings.yaml` with a settings-revision guard.
- "OpenCode Models" web settings section with per-tier drift view, checkbox adoption of online ids, per-row remove, and two-step sync; honors a read-only settings provider.
- Cross-tier id protection: an id absent from the target tier's listing but present in the sibling tier's is refused, never silently added.
- Assumed-capacity policy for the id-only listing endpoints, reported per entry.
