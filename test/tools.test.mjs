import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createTools } from '../lib/tools.js'

const FREE_URL = 'https://opencode.ai/zen/v1'
const GO_URL = 'https://opencode.ai/zen/go/v1'

/** Live listings keyed by base URL, mirroring the two zen endpoints. */
function fakeLlm({ free, go, failFor }) {
  const calls = []
  const state = { failFor }
  return {
    calls,
    state,
    async discoverModels(ns, request) {
      calls.push({ ns, ...request })
      if (request.baseURL === state.failFor) throw new Error('could not reach ' + request.baseURL)
      if (request.signal?.aborted) throw new Error('aborted')
      return request.baseURL === FREE_URL ? structuredClone(free) : structuredClone(go)
    },
  }
}

/** Fake settings service with revision-guarded deep merge. */
function fakeSettings({ section, revision = 7 }) {
  const state = { revision, updates: [], section }
  const settings = {
    state,
    get(ns) {
      return ns === 'llm-pi-ai' ? section : undefined
    },
    describe() {
      return [{ ns: 'llm-pi-ai', revision: state.revision }]
    },
    async update(ns, patch, expectedRevision) {
      if (expectedRevision !== state.revision) {
        const error = new Error('conflict')
        error.code = 'SETTINGS_CONFLICT'
        throw error
      }
      state.updates.push({ ns, patch, expectedRevision })
      for (const [route, profile] of Object.entries(patch.providers)) {
        section.providers[route] = { ...section.providers[route], ...profile }
      }
      state.revision += 1
    },
    register() {},
  }
  state.settings = settings
  return settings
}

function fixture({ freeListings, goListings, providers }) {
  const section = { providers: structuredClone(providers) }
  const settings = fakeSettings({ section })
  const llm = fakeLlm({ free: freeListings, go: goListings })
  const resolve = { settings: () => settings, llm: () => llm }
  const tools = Object.fromEntries(createTools(resolve).map((tool) => [tool.name, tool]))
  const exec = { signal: new AbortController().signal }
  return { tools, exec, settings, llm }
}

const CONFIGURED_FREE = {
  opencode: {
    displayName: 'OpenCode Free',
    models: [
      { id: 'kept-free', name: 'Kept', contextWindow: 1000, maxTokens: 100, input: ['text'] },
      { id: 'delisted-free', name: 'Delisted', contextWindow: 1000, maxTokens: 100, input: ['text'] },
    ],
  },
}

const LIVE_FREE = [
  { id: 'kept-free' },
  { id: 'fresh-free' },
]
const LIVE_GO = [
  { id: 'go-only' },
]

test('status reports per-tier drift and isolates a failing tier', async () => {
  const fx = fixture({
    freeListings: LIVE_FREE,
    goListings: LIVE_GO,
    providers: CONFIGURED_FREE,
    // no opencode-go route configured on purpose
  })
  fx.settings.get = ((original) => (ns) => {
    const value = original(ns)
    value.providers['opencode-go'] = {
      displayName: 'OpenCode Go',
      models: [{ id: 'go-only', name: 'Go Only', contextWindow: 1, maxTokens: 1, input: ['text'] }],
    }
    return value
  })(fx.settings.get)
  // Make the Go discovery fail to prove isolation.
  fx.llm.state.failFor = GO_URL

  const value = await fx.tools.oc_model_status.execute({}, fx.exec)
  assert.equal(value.routes.free.stale.length, 1)
  assert.deepEqual(value.routes.free.added, ['fresh-free'])
  assert.match(value.routes.go.error, /could not reach/)

  const blocks = fx.tools.oc_model_status.output.render({}, value)
  const text = blocks.map((block) => block.text).join('')
  assert.match(text, /configured 2 · live 2/)
  assert.match(text, /delisted, still configured \(1\): delisted-free/)
})

test('add adopts ids only with assumeDefaults when the listing hides capacities', async () => {
  const fx = fixture({
    freeListings: LIVE_FREE,
    goListings: LIVE_GO,
    providers: CONFIGURED_FREE,
  })
  const refused = await fx.tools.oc_model_add.execute(
    { tier: 'free', ids: ['fresh-free'] },
    fx.exec,
  )
  assert.deepEqual(refused.addedIds, [])
  assert.match(refused.rejected[0].reason, /assumeDefaults/)

  const accepted = await fx.tools.oc_model_add.execute(
    { tier: 'free', ids: ['fresh-free'], assumeDefaults: true },
    fx.exec,
  )
  assert.deepEqual(accepted.addedIds, ['fresh-free'])
  assert.deepEqual(accepted.assumedCapacityIds, ['fresh-free'])
})

test('add writes the merged models array through the guarded patch', async () => {
  const fx = fixture({
    freeListings: LIVE_FREE,
    goListings: LIVE_GO,
    providers: CONFIGURED_FREE,
  })
  await fx.tools.oc_model_add.execute({ tier: 'free', ids: ['fresh-free'], assumeDefaults: true }, fx.exec)
  const last = fx.settings.state.updates.at(-1)
  assert.equal(last.expectedRevision, 7)
  const merged = last.patch.providers.opencode.models
  assert.deepEqual(merged.map((entry) => entry.id), ['kept-free', 'delisted-free', 'fresh-free'])
  assert.equal(merged.at(-1).contextWindow, 128000)
})

test('add refuses cross-tier ids and unknown ids with teaching reasons', async () => {
  const fx = fixture({
    freeListings: LIVE_FREE,
    goListings: LIVE_GO,
    providers: CONFIGURED_FREE,
  })
  const value = await fx.tools.oc_model_add.execute(
    { tier: 'go', ids: ['fresh-free', 'nope'] },
    fx.exec,
  )
  const reasons = Object.fromEntries(value.rejected.map((entry) => [entry.id, entry.reason]))
  assert.match(reasons['fresh-free'], /do not cross tiers/)
  assert.match(reasons.nope, /not in the current live listing/)
  assert.deepEqual(value.addedIds, [])
})

test('add keeps an existing entry untouched and reports the skip', async () => {
  const fx = fixture({
    freeListings: [
      { id: 'kept-free', name: 'Renamed Online', contextWindow: 42, maxTokens: 7 },
    ],
    goListings: [],
    providers: { opencode: { displayName: 'x', models: [
      { id: 'kept-free', name: 'My Corrected Name', contextWindow: 1000, maxTokens: 100, input: ['text'] },
    ] } },
  })
  const value = await fx.tools.oc_model_add.execute(
    { tier: 'free', ids: ['kept-free'] },
    fx.exec,
  )
  assert.deepEqual(value.skippedIds, ['kept-free'])
  assert.deepEqual(value.addedIds, [])
  assert.equal(fx.settings.state.updates.length, 0)
})

test('remove drops only configured ids and skips the write when nothing matched', async () => {
  const fx = fixture({
    freeListings: LIVE_FREE,
    goListings: LIVE_GO,
    providers: CONFIGURED_FREE,
  })
  const miss = await fx.tools.oc_model_remove.execute({ tier: 'go', ids: ['go-only'] }, fx.exec)
  assert.deepEqual(miss.removedIds, [])
  assert.deepEqual(miss.notFoundIds, ['go-only'])
  assert.equal(fx.settings.state.updates.length, 0)

  const hit = await fx.tools.oc_model_remove.execute(
    { tier: 'free', ids: ['delisted-free', 'ghost'] },
    fx.exec,
  )
  assert.deepEqual(hit.removedIds, ['delisted-free'])
  assert.deepEqual(hit.notFoundIds, ['ghost'])
  const merged = fx.settings.state.updates.at(-1).patch.providers.opencode.models
  assert.deepEqual(merged.map((entry) => entry.id), ['kept-free'])
})

test('sync previews without writing, applies additions, prunes only on request', async () => {
  const build = () => fixture({
    freeListings: LIVE_FREE,
    goListings: [{ id: 'go-only' }],
    providers: {
      opencode: CONFIGURED_FREE.opencode,
      'opencode-go': { displayName: 'Go', models: [
        { id: 'stale-go', name: 'Stale', contextWindow: 1, maxTokens: 1, input: ['text'] },
      ] },
    },
  })

  const preview = build()
  const previewValue = await preview.tools.oc_model_sync.execute({}, preview.exec)
  assert.equal(previewValue.applied, false)
  assert.deepEqual(previewValue.routes.free.planAdd, ['fresh-free'])
  assert.deepEqual(previewValue.routes.go.planRemove, ['stale-go'])
  assert.equal(preview.settings.state.updates.length, 0)

  const applied = build()
  const appliedValue = await applied.tools.oc_model_sync.execute(
    { apply: true, pruneStale: true },
    applied.exec,
  )
  assert.equal(appliedValue.applied, true)
  assert.deepEqual(appliedValue.routes.free.appliedAdd, ['fresh-free'])
  assert.deepEqual(appliedValue.routes.go.appliedRemove, ['stale-go'])
  assert.equal(applied.settings.state.updates.length, 2)
  // Prune removes the delisted id while the newly adopted online id stays.
  assert.deepEqual(
    applied.settings.state.updates[1].patch.providers['opencode-go'].models.map((entry) => entry.id),
    ['go-only'],
  )

  const keepStale = build()
  await keepStale.tools.oc_model_sync.execute({ apply: true }, keepStale.exec)
  const goModels = keepStale.settings.state.updates.find(
    (call) => 'opencode-go' in call.patch.providers,
  )?.patch.providers['opencode-go'].models
  // Without pruneStale the delisted id stays; the new online id lands beside it.
  assert.deepEqual(goModels?.map((entry) => entry.id), ['stale-go', 'go-only'])
})

test('tools surface a teaching error when services are absent', async () => {
  const tools = Object.fromEntries(
    createTools({ settings: () => undefined, llm: () => undefined }).map((tool) => [tool.name, tool]),
  )
  const value = await tools.oc_model_status.execute({}, { signal: new AbortController().signal })
  assert.match(value.routes.free.error, /settings service is unavailable/)
})
