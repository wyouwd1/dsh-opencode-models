/**
 * The four agent tools of dsh-opencode-models (host plane).
 *
 * Factories take one `resolve` accessor pair instead of a Context so tests can
 * drive them with plain doubles; the plugin entry wires the real readers.
 * Tool bodies never throw across the registry boundary: expected failures are
 * returned as structured `{ error }` values so the model sees the recovery
 * text and the panel can render it.
 */

import {
  ASSUMED_CONTEXT_WINDOW,
  ASSUMED_MAX_TOKENS,
  SETTINGS_NS,
  TIERS,
  TIER_IDS,
  buildRoutePatch,
  diffModels,
  displayNameFromId,
  mergeEntries,
  normalizeModelEntry,
  removeEntries,
} from './shared.js'
import { OpencodeModelsError, describeRevision, readRouteModels, writeRouteModels } from './writer.js'

/**
 * @param resolve - `{ settings(): object|undefined, llm(): object|undefined }`
 *   resolved at call time, so late-mounting services are picked up.
 * @returns the four tool definitions ready for `ctx.tools.register`.
 */
export function createTools(resolve) {
  return [
    statusTool(resolve),
    addTool(resolve),
    removeTool(resolve),
    syncTool(resolve),
  ]
}

/** Human-readable message of any thrown value. */
function messageOf(error) {
  if (error instanceof Error) return error.message
  return String(error)
}

/** Require both backing services, teaching the fix when either is absent. */
function requireServices(resolve) {
  const settings = resolve.settings()
  const llm = resolve.llm()
  if (settings === undefined) {
    throw new OpencodeModelsError(
      `the settings service is unavailable; this tool manages "${SETTINGS_NS}" routes and needs the settings seam`,
      'NO_SETTINGS',
    )
  }
  if (llm === undefined || typeof llm.discoverModels !== 'function') {
    throw new OpencodeModelsError(
      'the llm service is unavailable; live model discovery needs the llm-pi-ai adapter',
      'NO_LLM',
    )
  }
  return { settings, llm }
}

/**
 * Fetch one tier's live listing through the llm-pi-ai discovery contract,
 * which resolves the route's stored credential automatically.
 */
async function liveList(llm, tier, signal) {
  const models = await llm.discoverModels(SETTINGS_NS, {
    provider: tier.route,
    baseURL: tier.baseURL,
    api: tier.api,
    signal,
  })
  return Array.isArray(models) ? models : []
}

/** Build one route report; a failed side becomes an `error` entry. */
async function routeReport(resolve, tierId, signal) {
  const tier = TIERS[tierId]
  try {
    const { settings, llm } = requireServices(resolve)
    const configured = readRouteModels(settings, tier.route)
    const live = await liveList(llm, tier, signal)
    const drift = diffModels(configured.models, live)
    return {
      tier: tierId,
      route: tier.route,
      baseURL: tier.baseURL,
      routeExists: configured.exists,
      configuredCount: configured.models.length,
      liveCount: live.length,
      added: drift.added,
      stale: drift.stale,
      configured: configured.models.map((entry) => entry.id),
    }
  } catch (error) {
    return { tier: tierId, route: tier.route, error: messageOf(error) }
  }
}

/** Render one route's report as text lines. */
function renderReport(report) {
  if (report.error !== undefined) return `  ${report.tier}: ${report.error}`
  const lines = [
    `${TIERS[report.tier].label} (route "${report.route}", ${report.baseURL})`,
  ]
  if (report.routeExists === false) {
    lines.push('  route not declared under llm-pi-ai.providers;'
      + ' declare it (apiKeyEnv/baseURL) on the Models page first')
    return lines.join('\n')
  }
  lines.push(`  configured ${report.configuredCount} · live ${report.liveCount}`)
  if (report.added.length > 0) lines.push(`  + online, not configured (${report.added.length}): ${report.added.join(', ')}`)
  else lines.push('  + nothing new online')
  if (report.stale.length > 0) lines.push(`  - delisted, still configured (${report.stale.length}): ${report.stale.join(', ')}`)
  return lines.join('\n')
}

/* ------------------------------------------------------------------ */

function statusTool(resolve) {
  return {
    name: 'oc_model_status',
    description:
      'Report OpenCode Zen model configuration versus the live endpoint listings. '
      + 'Fetches https://opencode.ai/zen/v1/models (free tier, route "opencode") and '
      + 'https://opencode.ai/zen/go/v1/models (Go tier, route "opencode-go") right now, '
      + 'then lists per tier: how many models are configured, how many are listed online, '
      + 'which online ids are not configured yet, and which configured ids have been delisted. '
      + 'Read-only; use oc_model_add / oc_model_remove / oc_model_sync to change anything.',
    parameters: { type: 'object', properties: {} },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        const lines = [`OpenCode model status @ ${value.fetchedAt}`]
        for (const tierId of TIER_IDS) lines.push(renderReport(value.routes[tierId]))
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 30000,
    async execute(args, exec) {
      const routes = {}
      for (const tierId of TIER_IDS) routes[tierId] = await routeReport(resolve, tierId, exec.signal)
      return { fetchedAt: new Date().toISOString(), routes }
    },
  }
}

/* ------------------------------------------------------------------ */

const ENTRY_PROPERTIES = {
  id: { type: 'string', description: 'model id exactly as the endpoint serves it' },
  name: { type: 'string' },
  contextWindow: { type: 'integer', minimum: 1 },
  maxTokens: { type: 'integer', minimum: 1 },
  input: { type: 'array', items: { type: 'string', enum: ['text', 'image'] } },
  reasoningEfforts: {
    type: 'object',
    description: 'keys off/low/medium/high/xhigh/max → wire spelling; null value means "do not send"',
    additionalProperties: { type: ['string', 'null'] },
  },
}

function addTool(resolve) {
  return {
    name: 'oc_model_add',
    description:
      'Add model entries to one OpenCode Zen route in ~/.dsh/settings.yaml (effective on the next request). '
      + 'Pick the tier ("free" → route opencode, "go" → route opencode-go) and pass either `ids` copied verbatim '
      + 'from oc_model_status\'s live listing, or full `models` entries. The zen listing discloses ids only, so '
      + '`ids` without disclosed capacities require `assumeDefaults: true` (contextWindow 128000, maxTokens 32000, '
      + 'input text) — every such assumption is reported and should be corrected later. An id that is absent from '
      + `this tier's live listing but present in the other tier's is refused: the two tiers use different ids `
      + '(free adds "-free"), never mix them.',
    parameters: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: TIER_IDS, description: 'which route to edit' },
        ids: { type: 'array', items: { type: 'string' }, description: 'live listing ids to adopt' },
        models: { type: 'array', items: { type: 'object', properties: ENTRY_PROPERTIES, required: ['id'] }, description: 'fully specified entries' },
        assumeDefaults: { type: 'boolean', description: 'fill missing contextWindow/maxTokens/input with documented assumptions' },
      },
      required: ['tier'],
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        if (value.error !== undefined) return [{ type: 'text', text: `${value.tier}: ${value.error}` }]
        const lines = []
        if (value.addedIds.length > 0) lines.push(`Added to ${TIERS[value.tier].label} (${value.route}): ${value.addedIds.join(', ')}`)
        else lines.push('Nothing added.')
        if (value.skippedIds.length > 0) lines.push(`Already configured, left untouched: ${value.skippedIds.join(', ')}`)
        if (value.assumedCapacityIds.length > 0) {
          lines.push(`Assumed capacities (contextWindow ${ASSUMED_CONTEXT_WINDOW}, maxTokens ${ASSUMED_MAX_TOKENS}) — correct them when known: ${value.assumedCapacityIds.join(', ')}`)
        }
        for (const rejection of value.rejected) lines.push(`Refused "${rejection.id}": ${rejection.reason}`)
        lines.push(`Revision now ${value.revision}.`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 30000,
    async execute(args, exec) {
      const tier = TIERS[args.tier]
      if (tier === undefined) return { tier: args.tier, error: `unknown tier "${args.tier}"; use one of ${TIER_IDS.join(', ')}` }
      const requestedIds = Array.isArray(args.ids) ? [...new Set(args.ids)] : []
      const draftEntries = Array.isArray(args.models) ? args.models : []
      if (requestedIds.length === 0 && draftEntries.length === 0) {
        return { tier: args.tier, error: 'pass `ids` (from oc_model_status) or full `models` entries' }
      }
      let deps
      try {
        deps = requireServices(resolve)
      } catch (error) {
        return { tier: args.tier, error: messageOf(error) }
      }
      try {
        const live = await liveList(deps.llm, tier, exec.signal)
        const liveById = new Map(live.map((entry) => [entry.id, entry]))
        const assumedCapacityIds = []
        const accepted = []
        const rejected = []

        for (const raw of draftEntries) {
          const result = normalizeModelEntry(raw, { assumeDefaults: args.assumeDefaults === true })
          if (result.ok) {
            if (raw.contextWindow === undefined && raw.maxTokens === undefined) assumedCapacityIds.push(result.entry.id)
            accepted.push(result.entry)
          } else {
            rejected.push({ id: typeof raw?.id === 'string' ? raw.id : '(no id)', reason: result.errors.join('; ') })
          }
        }

        const otherLiveByIdHolder = { map: null }
        for (const id of requestedIds) {
          const found = liveById.get(id)
          if (found === undefined) {
            // Cross-check the sibling tier once, only when something is missing.
            if (otherLiveByIdHolder.map === null) {
              const sibling = args.tier === 'free' ? TIERS.go : TIERS.free
              try {
                otherLiveByIdHolder.map = new Map((await liveList(deps.llm, sibling, exec.signal)).map((entry) => [entry.id, entry]))
              } catch {
                otherLiveByIdHolder.map = new Map()
              }
            }
            if (otherLiveByIdHolder.map.has(id)) {
              rejected.push({
                id,
                reason: `not in the ${args.tier}-tier listing but present in the ${args.tier === 'free' ? 'Go' : 'free'}-tier listing;`
                  + ' the two tiers serve different ids — do not cross tiers',
              })
            } else {
              rejected.push({
                id,
                reason: 'not in the current live listing; verify the id and pass a full `models` entry to add it unverified',
              })
            }
            continue
          }
          const hasCapacities = typeof found.contextWindow === 'number' && typeof found.maxTokens === 'number'
          if (!hasCapacities && args.assumeDefaults !== true) {
            rejected.push({
              id,
              reason: 'the listing does not disclose capacities; pass contextWindow/maxTokens via `models`, or set assumeDefaults: true'
                + ` (assumes contextWindow ${ASSUMED_CONTEXT_WINDOW}, maxTokens ${ASSUMED_MAX_TOKENS})`,
            })
            continue
          }
          accepted.push({
            id,
            name: typeof found.name === 'string' && found.name.length > 0 ? found.name : displayNameFromId(id),
            contextWindow: hasCapacities ? found.contextWindow : ASSUMED_CONTEXT_WINDOW,
            maxTokens: hasCapacities ? found.maxTokens : ASSUMED_MAX_TOKENS,
            input: ['text'],
          })
          if (!hasCapacities) assumedCapacityIds.push(id)
        }

        if (accepted.length === 0) {
          return {
            tier: args.tier,
            addedIds: [],
            skippedIds: [],
            assumedCapacityIds: [],
            rejected,
            revision: undefined,
            ...(rejected.length > 0 ? {} : { error: 'nothing to add after filtering' }),
          }
        }

        const current = readRouteModels(deps.settings, tier.route)
        const { merged, addedIds, skippedIds } = mergeEntries(current.models, accepted)
        if (addedIds.length === 0) {
          // Everything requested was already configured; leave the document
          // (and its revision) untouched instead of rewriting an equal list.
          return {
            tier: args.tier,
            route: tier.route,
            addedIds,
            skippedIds,
            assumedCapacityIds: [],
            rejected,
            revision: describeRevision(deps.settings),
          }
        }
        const revision = await writeRouteModels(deps.settings, tier.route, merged)
        return { tier: args.tier, route: tier.route, addedIds, skippedIds, assumedCapacityIds, rejected, revision }
      } catch (error) {
        return { tier: args.tier, error: messageOf(error) }
      }
    },
  }
}

/* ------------------------------------------------------------------ */

function removeTool(resolve) {
  return {
    name: 'oc_model_remove',
    description:
      'Remove model entries from one OpenCode Zen route in ~/.dsh/settings.yaml (effective on the next request). '
      + 'Pass the tier ("free" or "go") and the exact configured ids; run oc_model_status first to see them. '
      + 'Delisted time-limited models should be removed this way.',
    parameters: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: TIER_IDS, description: 'which route to edit' },
        ids: { type: 'array', items: { type: 'string' }, description: 'configured ids to drop' },
      },
      required: ['tier', 'ids'],
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        if (value.error !== undefined) return [{ type: 'text', text: `${value.tier}: ${value.error}` }]
        const lines = []
        if (value.removedIds.length > 0) lines.push(`Removed from ${TIERS[value.tier].label} (${value.route}): ${value.removedIds.join(', ')}`)
        else lines.push('Nothing removed.')
        if (value.notFoundIds.length > 0) lines.push(`Not configured there (ignored): ${value.notFoundIds.join(', ')}`)
        lines.push(`Revision now ${value.revision}.`)
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 15000,
    async execute(args) {
      const tier = TIERS[args.tier]
      if (tier === undefined) return { tier: args.tier, error: `unknown tier "${args.tier}"; use one of ${TIER_IDS.join(', ')}` }
      const ids = Array.isArray(args.ids) ? [...new Set(args.ids)] : []
      if (ids.length === 0) return { tier: args.tier, error: 'pass at least one id' }
      let deps
      try {
        deps = requireServices(resolve)
      } catch (error) {
        return { tier: args.tier, error: messageOf(error) }
      }
      try {
        const current = readRouteModels(deps.settings, tier.route)
        const { merged, removedIds, notFoundIds } = removeEntries(current.models, ids)
        if (removedIds.length === 0) {
          return { tier: args.tier, route: tier.route, removedIds, notFoundIds, revision: describeRevision(deps.settings) }
        }
        const revision = await writeRouteModels(deps.settings, tier.route, merged)
        return { tier: args.tier, route: tier.route, removedIds, notFoundIds, revision }
      } catch (error) {
        return { tier: args.tier, error: messageOf(error) }
      }
    },
  }
}

/* ------------------------------------------------------------------ */

function syncTool(resolve) {
  return {
    name: 'oc_model_sync',
    description:
      'Bring both OpenCode Zen routes up to date with the live endpoint listings. Without `apply` this is a '
      + 'preview: it reports what would be added (online, not configured) and removed (delisted, still configured) '
      + 'per tier. With `apply: true` it adds every online-not-configured id — capacities are assumed '
      + `(contextWindow ${ASSUMED_CONTEXT_WINDOW}, maxTokens ${ASSUMED_MAX_TOKENS}) because the listing does not `
      + 'disclose them, and every assumption is reported. Delisted entries are removed only with `pruneStale: true`.',
    parameters: {
      type: 'object',
      properties: {
        tiers: { type: 'array', items: { type: 'string', enum: TIER_IDS }, description: 'default: both tiers' },
        apply: { type: 'boolean', description: 'default false — preview only' },
        pruneStale: { type: 'boolean', description: 'with apply: also remove delisted ids; default false' },
      },
    },
    output: {
      schema: { type: 'object' },
      render(_args, value) {
        const lines = [value.applied ? 'Sync applied.' : 'Preview (pass apply: true to apply).']
        for (const tierId of TIER_IDS) {
          const report = value.routes[tierId]
          if (report.error !== undefined) {
            lines.push(renderReport(report))
            continue
          }
          lines.push(`${TIERS[tierId].label}: would add ${report.planAdd.length}${report.appliedAdd.length > 0 ? `, added ${report.appliedAdd.length}` : ''}`
            + ` · delisted ${report.planRemove.length}${report.appliedRemove.length > 0 ? `, removed ${report.appliedRemove.length}` : ''}`)
          if (report.planAdd.length > 0 && report.appliedAdd.length === 0) lines.push(`  add: ${report.planAdd.join(', ')}`)
          if (report.planRemove.length > 0 && report.appliedRemove.length === 0) lines.push(`  remove: ${report.planRemove.join(', ')}`)
          if (report.assumedCapacityIds.length > 0) {
            lines.push(`  assumed capacities on: ${report.assumedCapacityIds.join(', ')}`)
          }
          if (report.error2 !== undefined) lines.push(`  write failed: ${report.error2}`)
        }
        return [{ type: 'text', text: lines.join('\n') }]
      },
    },
    timeoutMs: 60000,
    async execute(args, exec) {
      const tierIds = Array.isArray(args.tiers) && args.tiers.length > 0
        ? args.tiers.filter((id) => TIER_IDS.includes(id))
        : [...TIER_IDS]
      if (tierIds.length === 0) return { applied: false, error: `tiers must be drawn from ${TIER_IDS.join(', ')}` }
      const apply = args.apply === true
      const pruneStale = args.pruneStale === true
      const routes = {}
      for (const tierId of tierIds) {
        const report = {
          tier: tierId,
          planAdd: [],
          planRemove: [],
          appliedAdd: [],
          appliedRemove: [],
          assumedCapacityIds: [],
        }
        try {
          const preview = await routeReport(resolve, tierId, exec.signal)
          if (preview.error !== undefined) {
            routes[tierId] = { ...report, error: preview.error }
            continue
          }
          report.planAdd = preview.added
          report.planRemove = preview.stale
          if (!apply || (preview.added.length === 0 && (!pruneStale || preview.stale.length === 0))) {
            routes[tierId] = report
            continue
          }
          const { settings, llm } = requireServices(resolve)
          const tier = TIERS[tierId]
          const live = await liveList(llm, tier, exec.signal)
          const liveById = new Map(live.map((entry) => [entry.id, entry]))
          const current = readRouteModels(settings, tier.route)

          let working = current.models
          if (preview.added.length > 0) {
            const additions = preview.added.map((id) => {
              const found = liveById.get(id)
              const name = typeof found?.name === 'string' && found.name.length > 0 ? found.name : displayNameFromId(id)
              report.assumedCapacityIds.push(id)
              return { id, name, contextWindow: ASSUMED_CONTEXT_WINDOW, maxTokens: ASSUMED_MAX_TOKENS, input: ['text'] }
            })
            const result = mergeEntries(working, additions)
            working = result.merged
            report.appliedAdd = result.addedIds
          }
          if (pruneStale && preview.stale.length > 0) {
            const result = removeEntries(working, preview.stale)
            working = result.merged
            report.appliedRemove = result.removedIds
          }
          await writeRouteModels(settings, tier.route, working)
          routes[tierId] = report
        } catch (error) {
          routes[tierId] = { ...report, error2: messageOf(error) }
        }
      }
      return { applied: apply, routes }
    },
  }
}
