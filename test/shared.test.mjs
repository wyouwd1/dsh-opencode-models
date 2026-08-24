import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  ASSUMED_CONTEXT_WINDOW,
  ASSUMED_MAX_TOKENS,
  TIERS,
  buildRoutePatch,
  diffModels,
  displayNameFromId,
  filterFreeTierLive,
  mergeEntries,
  normalizeModelEntry,
  removeEntries,
} from '../lib/shared.js'

test('tier table follows the official endpoint layout', () => {
  assert.equal(TIERS.free.route, 'opencode')
  assert.equal(TIERS.free.baseURL, 'https://opencode.ai/zen/v1')
  assert.equal(TIERS.go.route, 'opencode-go')
  assert.equal(TIERS.go.baseURL, 'https://opencode.ai/zen/go/v1')
})

test('displayNameFromId capitalizes words and keeps version digits', () => {
  assert.equal(displayNameFromId('x-preview-f-free'), 'X Preview F Free')
  assert.equal(displayNameFromId('deepseek-v4-flash'), 'Deepseek V4 Flash')
  assert.equal(displayNameFromId('glm-5.2'), 'Glm 5.2')
})

test('normalizeModelEntry accepts a fully specified entry', () => {
  const result = normalizeModelEntry({
    id: ' x ',
    name: 'X',
    contextWindow: 1000,
    maxTokens: 100,
    input: ['text', 'image'],
    reasoningEfforts: { low: 'low', off: null },
  })
  assert.deepEqual(result, {
    ok: true,
    entry: {
      id: 'x',
      name: 'X',
      contextWindow: 1000,
      maxTokens: 100,
      input: ['text', 'image'],
      reasoningEfforts: { low: 'low', off: null },
    },
  })
})

test('normalizeModelEntry derives name/input defaults and fills assumed capacities', () => {
  const result = normalizeModelEntry({ id: 'new-model' }, { assumeDefaults: true })
  assert.equal(result.ok, true)
  assert.equal(result.entry.name, 'New Model')
  assert.equal(result.entry.contextWindow, ASSUMED_CONTEXT_WINDOW)
  assert.equal(result.entry.maxTokens, ASSUMED_MAX_TOKENS)
  assert.deepEqual(result.entry.input, ['text'])
  assert.equal('reasoningEfforts' in result.entry, false)
})

test('normalizeModelEntry keeps reasoningEfforts: false distinct from omitted', () => {
  const disabled = normalizeModelEntry({ id: 'a', contextWindow: 1, maxTokens: 1, reasoningEfforts: false })
  assert.equal(disabled.ok, true)
  assert.equal(disabled.entry.reasoningEfforts, false)
  const omitted = normalizeModelEntry({ id: 'a', contextWindow: 1, maxTokens: 1 })
  assert.equal(omitted.ok, true)
  assert.equal('reasoningEfforts' in omitted.entry, false)
})

test('normalizeModelEntry rejects missing capacities without assumeDefaults', () => {
  const result = normalizeModelEntry({ id: 'a' })
  assert.equal(result.ok, false)
  assert.match(result.errors.join('; '), /contextWindow is required/)
  assert.match(result.errors.join('; '), /maxTokens is required/)
})

test('normalizeModelEntry rejects invalid fields', () => {
  const cases = [
    [{}, /id is required/],
    [{ id: 'a', contextWindow: -1, maxTokens: 1 }, /contextWindow must be a positive integer/],
    [{ id: 'a', contextWindow: 1, maxTokens: 1.5 }, /maxTokens must be a positive integer/],
    [{ id: 'a', contextWindow: 1, maxTokens: 1, input: ['video'] }, /input must be a non-empty array/],
    [{ id: 'a', contextWindow: 1, maxTokens: 1, reasoningEfforts: { fast: 'fast' } }, /reasoningEfforts level "fast"/],
    [{ id: 'a', contextWindow: 1, maxTokens: 1, reasoningEfforts: 3 }, /reasoningEfforts must be false, an object/],
  ]
  for (const [raw, pattern] of cases) {
    const result = normalizeModelEntry(raw)
    assert.equal(result.ok, false, JSON.stringify(raw))
    assert.match(result.errors.join('; '), pattern)
  }
})

test('filterFreeTierLive keeps only the -free family plus configured ids', () => {
  const live = [
    { id: 'deepseek-v4-pro' },
    { id: 'deepseek-v4-flash-free' },
    { id: 'x-preview-f-free' },
    { id: 'big-pickle' },
    { id: 'claude-opus-5' },
  ]
  assert.deepEqual(filterFreeTierLive(live, ['big-pickle']).map((entry) => entry.id),
    ['deepseek-v4-flash-free', 'x-preview-f-free', 'big-pickle'])
  assert.deepEqual(filterFreeTierLive(live, []).map((entry) => entry.id),
    ['deepseek-v4-flash-free', 'x-preview-f-free'])
})
test('diffModels splits added and stale in order', () => {
  const configured = [{ id: 'kept' }, { id: 'delisted' }]
  const live = [{ id: 'delisted-x' }, { id: 'kept' }, { id: 'fresh' }]
  const drift = diffModels(configured, live)
  assert.deepEqual(drift.added, ['delisted-x', 'fresh'])
  assert.deepEqual(drift.stale, ['delisted'])
})

test('mergeEntries never overwrites an existing id', () => {
  const existing = [{ id: 'a', name: 'A', contextWindow: 10, maxTokens: 5, input: ['text'] }]
  const additions = [
    { id: 'a', name: 'A corrected elsewhere', contextWindow: 999, maxTokens: 999, input: ['text'] },
    { id: 'b', name: 'B', contextWindow: 20, maxTokens: 10, input: ['text'] },
  ]
  const { merged, addedIds, skippedIds } = mergeEntries(existing, additions)
  assert.deepEqual(addedIds, ['b'])
  assert.deepEqual(skippedIds, ['a'])
  assert.equal(merged.length, 2)
  assert.equal(merged[0].contextWindow, 10)
})

test('removeEntries reports removed and not-found ids', () => {
  const existing = [{ id: 'a' }, { id: 'b' }]
  const { merged, removedIds, notFoundIds } = removeEntries(existing, ['b', 'zzz', 'zzz'])
  assert.deepEqual(removedIds, ['b'])
  assert.deepEqual(notFoundIds, ['zzz', 'zzz'])
  assert.deepEqual(merged.map((entry) => entry.id), ['a'])
})

test('buildRoutePatch targets exactly one route models list', () => {
  assert.deepEqual(buildRoutePatch('opencode', []), { providers: { opencode: { models: [] } } })
  assert.deepEqual(buildRoutePatch('opencode-go', [{ id: 'x' }]), {
    providers: { 'opencode-go': { models: [{ id: 'x' }] } },
  })
})
