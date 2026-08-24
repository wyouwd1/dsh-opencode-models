/**
 * Shared model-entry logic for dsh-opencode-models.
 *
 * Pure functions over plain JSON only: the host tools and the browser panel
 * both need the same tier table, entry normalization, drift computation, and
 * list merging. The client bundle cannot import across files (it ships as one
 * closure-factory artifact), so it carries an inlined copy of this file —
 * keep the two byte-for-byte equivalent in behavior.
 */

/** The settings namespace whose `providers` section owns the two routes. */
export const SETTINGS_NS = 'llm-pi-ai'

/**
 * The two OpenCode Zen tiers this plugin manages, per the official endpoint
 * layout: the free tier serves `-free`-suffixed ids at `zen/v1`, the Go tier
 * serves unsuffixed ids at `zen/go/v1`. One shared API key covers both
 * (`PI_AI_API_KEY` through the route's `apiKeyEnv`).
 */
export const TIERS = {
  free: {
    id: 'free',
    route: 'opencode',
    label: 'OpenCode Free',
    baseURL: 'https://opencode.ai/zen/v1',
    api: 'openai-completions',
  },
  go: {
    id: 'go',
    route: 'opencode-go',
    label: 'OpenCode Go',
    baseURL: 'https://opencode.ai/zen/go/v1',
    api: 'openai-completions',
  },
}

/** Tier ids in presentation order. */
export const TIER_IDS = ['free', 'go']

/**
 * Capacity values applied when a caller adopts live listing ids without
 * declaring them: the zen listing endpoints disclose ids only, while every
 * configured entry needs a context window and output cap. Deliberately
 * conservative; every entry filled this way is reported to the caller so the
 * real figures can replace them.
 */
export const ASSUMED_CONTEXT_WINDOW = 128000
export const ASSUMED_MAX_TOKENS = 32000

/** Modalities a models entry may declare; the pi-ai adapter supports these two. */
const INPUT_MODALITIES = ['text', 'image']

/** Reasoning-effort levels the llm-pi-ai schema accepts as dict keys. */
const EFFORT_LEVELS = ['off', 'low', 'medium', 'high', 'xhigh', 'max']

/**
 * Derive a display name from a model id: split on separators, capitalize
 * words, keep version digits intact (`x-preview-f-free` → `X Preview F Free`).
 * @param id - the model id.
 * @returns a human-readable fallback name.
 */
export function displayNameFromId(id) {
  return String(id)
    .split(/[-_]+/)
    .filter((part) => part.length > 0)
    .map((part) => (/^\d/.test(part) ? part : part.charAt(0).toUpperCase() + part.slice(1)))
    .join(' ')
}

/**
 * Normalize one caller-supplied models entry against the llm-pi-ai schema.
 * @param raw - the draft entry (id required; everything else checked).
 * @param options - when `assumeDefaults` is set, missing positive capacity
 *   numbers fall back to the documented assumptions instead of failing.
 * @returns `{ ok: true, entry }` or `{ ok: false, errors }`.
 */
export function normalizeModelEntry(raw, { assumeDefaults = false } = {}) {
  const errors = []
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, errors: ['entry must be an object'] }
  }
  const id = typeof raw.id === 'string' ? raw.id.trim() : ''
  if (id.length === 0) errors.push('id is required')
  let name
  if (raw.name === undefined || raw.name === null || String(raw.name).trim() === '') {
    name = id.length > 0 ? displayNameFromId(id) : undefined
  } else if (typeof raw.name === 'string') {
    name = raw.name.trim()
  } else {
    errors.push('name must be a string')
  }

  let contextWindow
  if (raw.contextWindow === undefined || raw.contextWindow === null) {
    if (assumeDefaults && id.length > 0) contextWindow = ASSUMED_CONTEXT_WINDOW
    else errors.push('contextWindow is required (a positive integer), or set assumeDefaults')
  } else if (Number.isInteger(raw.contextWindow) && raw.contextWindow > 0) {
    contextWindow = raw.contextWindow
  } else {
    errors.push('contextWindow must be a positive integer')
  }

  let maxTokens
  if (raw.maxTokens === undefined || raw.maxTokens === null) {
    if (assumeDefaults && id.length > 0) maxTokens = ASSUMED_MAX_TOKENS
    else errors.push('maxTokens is required (a positive integer), or set assumeDefaults')
  } else if (Number.isInteger(raw.maxTokens) && raw.maxTokens > 0) {
    maxTokens = raw.maxTokens
  } else {
    errors.push('maxTokens must be a positive integer')
  }

  let input
  if (raw.input === undefined || raw.input === null) {
    input = ['text']
  } else if (Array.isArray(raw.input) && raw.input.every((m) => INPUT_MODALITIES.includes(m))) {
    input = raw.input.length > 0 ? [...raw.input] : ['text']
  } else {
    errors.push(`input must be a non-empty array drawn from ${JSON.stringify(INPUT_MODALITIES)}`)
  }

  let reasoningEfforts
  if (raw.reasoningEfforts === undefined || raw.reasoningEfforts === null) {
    reasoningEfforts = undefined
  } else if (raw.reasoningEfforts === false) {
    reasoningEfforts = false
  } else if (typeof raw.reasoningEfforts === 'object' && !Array.isArray(raw.reasoningEfforts)) {
    const efforts = {}
    for (const [level, spelling] of Object.entries(raw.reasoningEfforts)) {
      if (!EFFORT_LEVELS.includes(level)) {
        errors.push(`reasoningEfforts level "${level}" is not one of ${EFFORT_LEVELS.join(', ')}`)
        continue
      }
      if (spelling !== null && spelling !== undefined && typeof spelling !== 'string') {
        errors.push(`reasoningEfforts.${level} must be a string or null`)
        continue
      }
      efforts[level] = spelling === undefined ? null : spelling
    }
    if (Object.keys(efforts).length > 0) reasoningEfforts = efforts
    else if (errors.length === 0) reasoningEfforts = false
  } else {
    errors.push('reasoningEfforts must be false, an object of level → wire spelling, or omitted')
  }

  if (errors.length > 0 || name === undefined) {
    return { ok: false, errors: errors.length > 0 ? errors : ['name could not be derived'] }
  }
  const entry = { id, name, contextWindow, maxTokens, input }
  if (reasoningEfforts !== undefined) entry.reasoningEfforts = reasoningEfforts
  return { ok: true, entry }
}

/**
 * Compare one route's configured entries with its live listing.
 * @param configured - configured entries (at least `id` each).
 * @param live - discovered entries (at least `id` each).
 * @returns `added` (live but not configured) and `stale` (configured but no
 *   longer listed) as arrays of ids, both in listing/configured order.
 */
/** The free-tier listing also advertises paid ids shared with the Go tier;
 * only the "-free" family belongs on the free route — plus ids this user
 * already configured (legacy ids like "big-pickle" predate the suffix). */
export function filterFreeTierLive(live, configuredIds) {
  const keep = new Set(configuredIds || [])
  return live.filter((entry) => entry.id.endsWith('-free') || keep.has(entry.id))
}

export function diffModels(configured, live) {
  const configuredIds = new Set(configured.map((entry) => entry.id))
  const liveIds = new Set(live.map((entry) => entry.id))
  return {
    added: live.filter((entry) => !configuredIds.has(entry.id)).map((entry) => entry.id),
    stale: configured.filter((entry) => !liveIds.has(entry.id)).map((entry) => entry.id),
  }
}

/**
 * Merge normalized entries into an existing models list. Existing ids win:
 * adopting a candidate never overwrites a capacity someone corrected.
 * @param existing - the route's current models array.
 * @param additions - normalized entries to add.
 * @returns `{ merged, addedIds, skippedIds }`.
 */
export function mergeEntries(existing, additions) {
  const known = new Set(existing.map((entry) => entry.id))
  const merged = [...existing]
  const addedIds = []
  const skippedIds = []
  for (const entry of additions) {
    if (known.has(entry.id)) {
      skippedIds.push(entry.id)
      continue
    }
    known.add(entry.id)
    merged.push(entry)
    addedIds.push(entry.id)
  }
  return { merged, addedIds, skippedIds }
}

/**
 * Remove entries by id from one route's models list.
 * @param existing - the route's current models array.
 * @param ids - ids to drop.
 * @returns `{ merged, removedIds, notFoundIds }`.
 */
export function removeEntries(existing, ids) {
  const drop = new Set(ids)
  const removedIds = []
  const merged = existing.filter((entry) => {
    if (!drop.has(entry.id)) return true
    removedIds.push(entry.id)
    return false
  })
  const notFoundIds = ids.filter((id) => !removedIds.includes(id))
  return { merged, removedIds, notFoundIds }
}

/**
 * Build the deep-merge patch that replaces exactly one route's models array.
 * Sibling routes and every other key of the target route survive the merge.
 * @param route - the provider route key (`opencode` / `opencode-go`).
 * @param models - the complete next models array.
 */
export function buildRoutePatch(route, models) {
  return { providers: { [route]: { models } } }
}
