/**
 * Settings read/write path for dsh-opencode-models (host plane).
 *
 * Every mutation goes through `ctx.settings` for the `llm-pi-ai` namespace, so
 * schema validation and persistence stay owned by the settings seam: an
 * invalid candidate rejects before anything persists, and each write carries
 * the `expectedRevision` read immediately before it so a concurrent editor
 * (the Models page, another session) wins instead of being overwritten.
 */

import { SETTINGS_NS } from './shared.js'

/** Coded failure surfaced verbatim in tool output and panel messages. */
export class OpencodeModelsError extends Error {
  /**
   * @param message - human-facing explanation, model-readable.
   * @param code - stable machine code (`NO_SETTINGS`, `NO_LLM`, `ROUTE_MISSING`, `CONFLICT`).
   */
  constructor(message, code) {
    super(message)
    this.name = 'OpencodeModelsError'
    this.code = code
  }
}

/**
 * Read the configured `providers` section of the llm-pi-ai namespace.
 * @param settings - the host settings service.
 * @returns the resolved providers object (may be empty).
 */
export function readProviders(settings) {
  const section = settings.get(SETTINGS_NS)
  if (section === undefined || section === null || typeof section !== 'object') {
    throw new OpencodeModelsError(
      `the "${SETTINGS_NS}" settings namespace is not registered; install the harness base bundle (llm-pi-ai) first`,
      'NO_SETTINGS',
    )
  }
  const providers = section.providers
  return providers !== null && typeof providers === 'object' ? providers : {}
}

/**
 * Read one route's configured models as plain owned copies.
 * @param settings - the host settings service.
 * @param route - provider route key (`opencode` / `opencode-go`).
 * @returns `{ route, exists, models }`; entries carry only the documented fields.
 */
export function readRouteModels(settings, route) {
  const providers = readProviders(settings)
  const profile = providers[route]
  if (profile === undefined || profile === null || typeof profile !== 'object') {
    return { route, exists: false, models: [] }
  }
  const raw = Array.isArray(profile.models) ? profile.models : []
  const models = raw
    .filter((entry) => entry !== null && typeof entry === 'object' && typeof entry.id === 'string')
    .map((entry) => {
      const copy = {
        id: entry.id,
        name: typeof entry.name === 'string' ? entry.name : entry.id,
      }
      if (typeof entry.contextWindow === 'number') copy.contextWindow = entry.contextWindow
      if (typeof entry.maxTokens === 'number') copy.maxTokens = entry.maxTokens
      if (Array.isArray(entry.input)) copy.input = [...entry.input]
      if (entry.reasoningEfforts !== undefined) copy.reasoningEfforts = entry.reasoningEfforts
      return copy
    })
  return { route, exists: true, models }
}

/**
 * Read the namespace's current revision for optimistic writes.
 * @param settings - the host settings service.
 * @returns the revision number, or `undefined` when the namespace is absent.
 */
export function describeRevision(settings) {
  const descriptors = typeof settings.describe === 'function' ? settings.describe() : []
  const found = descriptors.find((descriptor) => descriptor.ns === SETTINGS_NS)
  return found === undefined ? undefined : found.revision
}

/**
 * Replace exactly one route's models array through a deep-merge patch.
 * A stale-revision rejection is retried once against the fresh revision;
 * every other rejection (schema, storage) propagates unchanged so the caller
 * sees the settings seam's own diagnostic.
 * @param settings - the host settings service.
 * @param route - provider route key; must already exist in the section.
 * @param models - the complete next models array (plain JSON).
 * @returns the post-write revision.
 */
export async function writeRouteModels(settings, route, models) {
  if (settings.writable === false) {
    throw new OpencodeModelsError(
      'the settings provider is read-only; enable a writable settings file to manage models',
      'READ_ONLY',
    )
  }
  const providers = readProviders(settings)
  if (!(route in providers)) {
    throw new OpencodeModelsError(
      `provider route "${route}" does not exist under ${SETTINGS_NS}.providers;`
        + ' declare the route itself (apiKeyEnv/baseURL) on the Models page first —'
        + ' adding a whole new route also needs a restart',
      'ROUTE_MISSING',
    )
  }
  const patch = { providers: { [route]: { models } } }
  let expectedRevision = describeRevision(settings)
  try {
    await settings.update(SETTINGS_NS, patch, expectedRevision)
  } catch (error) {
    const coded = error !== null && typeof error === 'object' ? error.code : undefined
    if (coded !== 'SETTINGS_CONFLICT') throw error
    // Another writer landed first; re-read once and reapply over its state.
    expectedRevision = describeRevision(settings)
    await settings.update(SETTINGS_NS, patch, expectedRevision)
  }
  return describeRevision(settings)
}
