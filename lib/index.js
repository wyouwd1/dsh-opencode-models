/**
 * dsh-opencode-models — manage OpenCode Zen free-tier and Go-tier models.
 *
 * Host-plane plugin. Registers four agent tools (`oc_model_status`, `oc_model_add`,
 * `oc_model_remove`, `oc_model_sync`) that read the live model listings from
 * `https://opencode.ai/zen/v1/models` and `https://opencode.ai/zen/go/v1/models`
 * through the llm-pi-ai discovery contract, compare them with the configured
 * routes under `llm-pi-ai.providers` (`opencode` = free tier, `opencode-go` =
 * Go tier), and write changes back through the settings seam with an
 * `expectedRevision` guard. Model-list edits take effect on the next request;
 * only adding a whole new route needs a restart (this plugin never does that).
 *
 * The browser half of this package registers an "OpenCode Models" settings
 * section on top of the same wire contracts; see lib/client.js.
 */

import { createTools } from './tools.js'

export const name = 'dsh-opencode-models'
export const inject = ['tools']

/**
 * Mount the tools. Services resolve lazily inside each execution so a profile
 * where settings or llm-pi-ai mount late still works, and a profile without
 * them produces a teaching error instead of breaking activation.
 * @param ctx - host cordis context.
 */
export function apply(ctx) {
  const resolve = {
    settings: () => ctx.get('settings'),
    llm: () => ctx.get('llm'),
  }
  // register() binds each tool to this plugin's fiber and returns its disposer,
  // so stop/uninstall removes all four without extra bookkeeping here.
  for (const tool of createTools(resolve)) ctx.tools.register(tool)
}
