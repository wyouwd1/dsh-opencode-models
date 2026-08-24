import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readRouteModels, writeRouteModels } from '../lib/writer.js'

/** Fake settings service: resolved section + describe/update with revision guard. */
function fakeSettings({ section, revision = 7 }) {
  const state = { revision, updates: [] }
  return {
    state,
    get(ns) {
      assert.equal(ns, 'llm-pi-ai')
      return section
    },
    describe() {
      return [{ ns: 'llm-pi-ai', revision: state.revision }]
    },
    async update(ns, patch, expectedRevision) {
      state.updates.push({ ns, patch, expectedRevision })
      if (expectedRevision !== state.revision) {
        const error = new Error('stale')
        error.code = 'SETTINGS_CONFLICT'
        throw error
      }
      // Apply the deep merge only as far as these tests need.
      for (const [route, profile] of Object.entries(patch.providers)) {
        section.providers[route] = { ...section.providers[route], ...profile }
      }
      state.revision += 1
    },
  }
}

const SECTION = () => ({
  providers: {
    opencode: {
      displayName: 'OpenCode Free',
      models: [
        { id: 'a-free', name: 'A', contextWindow: 1000, maxTokens: 100, input: ['text'] },
        { name: 'unusable row without an id' }, // filtered
      ],
    },
  },
})

test('readRouteModels copies documented fields only and filters unusable rows', () => {
  const settings = fakeSettings({ section: SECTION() })
  const route = readRouteModels(settings, 'opencode')
  assert.equal(route.exists, true)
  assert.deepEqual(route.models.map((entry) => entry.id), ['a-free'])
  const entry = route.models[0]
  assert.deepEqual(Object.keys(entry).sort(), ['contextWindow', 'id', 'input', 'maxTokens', 'name'])
})

test('readRouteModels reports an absent route without throwing', () => {
  const settings = fakeSettings({ section: { providers: {} } })
  const route = readRouteModels(settings, 'opencode-go')
  assert.equal(route.exists, false)
  assert.deepEqual(route.models, [])
})

test('writeRouteModels sends the patch guarded by the current revision', async () => {
  const settings = fakeSettings({ section: SECTION(), revision: 41 })
  const next = [{ id: 'a-free', name: 'A', contextWindow: 1000, maxTokens: 100, input: ['text'] }]
  const revision = await writeRouteModels(settings, 'opencode', next)
  assert.equal(revision, 42)
  assert.equal(settings.state.updates.length, 1)
  const call = settings.state.updates[0]
  assert.equal(call.expectedRevision, 41)
  assert.deepEqual(call.patch, { providers: { opencode: { models: next } } })
})

test('writeRouteModels retries once over a concurrent writer', async () => {
  const settings = fakeSettings({ section: SECTION(), revision: 3 })
  // First attempt races a concurrent write that bumps the revision.
  const originalUpdate = settings.update.bind(settings)
  let attempts = 0
  settings.update = async (ns, patch, expectedRevision) => {
    attempts += 1
    if (attempts === 1) {
      settings.state.revision += 1 // concurrent writer landed first
      const error = new Error('conflict')
      error.code = 'SETTINGS_CONFLICT'
      throw error
    }
    return originalUpdate(ns, patch, expectedRevision)
  }
  await writeRouteModels(settings, 'opencode', [])
  assert.equal(attempts, 2)
  assert.equal(settings.state.updates.length, 1)
  assert.equal(settings.state.updates[0].expectedRevision, 4)
})

test('writeRouteModels refuses to invent a whole route', async () => {
  const settings = fakeSettings({ section: { providers: {} } })
  await assert.rejects(
    () => writeRouteModels(settings, 'opencode-go', []),
    /declare the route itself/,
  )
})
