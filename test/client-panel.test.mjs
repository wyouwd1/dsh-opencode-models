// Headless mount of the settings-section bundle: loads lib/client.js through
// a fake module loader, registers into a fake ctx, mounts the section with
// react-test-renderer (passive effects run), and drives the load path against
// stubbed wire APIs. Guards the async wire unwrap (a synchronous unwrap of a
// Promise crashed the whole section on mount), the pinned sidebar order, the
// third "other" card (official llm-deepseek models), and the cross-card batch
// removal flow with one guarded write per affected namespace.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const React = require('react')
const TestRenderer = require('react-test-renderer')

const CLIENT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../lib/client.js')

let cachedFactory
function loadFactory() {
  if (cachedFactory) return cachedFactory
  let loaded
  global.window = { __ModuleLoader__: { load(def) { loaded = def } } }
  require(CLIENT)
  delete global.window
  assert.ok(loaded, 'factory never registered')
  cachedFactory = loaded
  return loaded
}

function fakeCtx(api, captured) {
  return {
    connection: { api },
    locale: { register() {}, bind: () => (key) => `t:${key}` },
    remote: { $on: () => () => {} },
    effect(fn) { return fn() },
    slots: {
      inject(_name, cb) { cb() },
      register(options, Component) { captured.options = options; captured.Component = Component },
    },
  }
}

// ── mutable store stub: update() merges patches and bumps revisions ─────
function stubApi({ describeFails = false } = {}) {
  const store = {
    'llm-pi-ai': {
      providers: {
        opencode: { displayName: 'OpenCode Free', models: [
          { id: 'big-pickle', name: 'Big Pickle', contextWindow: 1048576, maxTokens: 131072, input: ['text'] },
          { id: 'x-preview-f-free', name: 'X Preview Free', contextWindow: 1048576, maxTokens: 131072, input: ['text'] },
        ] },
        'opencode-go': { displayName: 'OpenCode Go', models: [
          { id: 'go-a', name: 'Go A', contextWindow: 128000, maxTokens: 32000, input: ['text'] },
        ] },
      },
    },
    'llm-deepseek': { models: [
      { id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxTokens: 32000, input: ['text'] },
      { id: 'deepseek-v4-pro', name: 'DeepSeek V4 Pro', contextWindow: 128000, maxTokens: 32000, input: ['text'] },
    ] },
  }
  const revisions = { 'llm-pi-ai': 3, 'llm-deepseek': 1 }
  const calls = { describe: 0, discover: [], update: [] }
  const api = {
    settings: {
      async describe() {
        calls.describe += 1
        if (describeFails) return { result: { ok: false, error: { code: 'TEST_DOWN' } } }
        const namespaces = Object.keys(store).map((ns) => ({
          ns,
          writable: true,
          revision: revisions[ns],
          value: store[ns],
        }))
        return { result: { ok: true, value: { writable: true, hasDocument: true, namespaces } } }
      },
      async update(request) {
        calls.update.push(request)
        const { ns, patch } = request
        assert.ok(request.expectedRevision !== undefined, 'update must carry expectedRevision')
        assert.equal(request.expectedRevision, revisions[ns], 'expectedRevision must match the live revision')
        if (patch.providers) {
          for (const route of Object.keys(patch.providers)) store[ns].providers[route].models = patch.providers[route].models
        }
        if (patch.models) store[ns].models = patch.models
        revisions[ns] += 1
        return { result: { ok: true, value: store[ns] } }
      },
    },
    llm: {
      async discoverModels(request) {
        calls.discover.push(request)
        const models = request.baseURL === 'https://opencode.ai/zen/v1'
          ? [{ id: 'x-preview-f-free' }, { id: 'fresh-free' }]
          : [{ id: 'go-a' }]
        return { result: { ok: true, value: { models } } }
      },
    },
  }
  return { api, calls, store }
}

async function flush(millis = 60) {
  await new Promise((resolve) => setTimeout(resolve, millis))
}

function mount(api) {
  const captured = {}
  const { apply, inject } = loadFactory().factory((name) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return { Button: (props) => React.createElement('button', props, props.children) }
    }
    throw new Error('unexpected require: ' + name)
  })
  assert.deepEqual(inject, ['slots', 'locale', 'connection', 'remote'])
  apply(fakeCtx(api, captured))
  const face = captured.options.inject()
  let renderer
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(captured.Component, { ...face, close() {} }))
  })
  return { renderer, captured }
}

function checkboxes(renderer) {
  return renderer.root.findAll((node) => node.props.className === 'ocm-check')
}

function button(renderer, text) {
  return renderer.root.findAll((node) =>
    node.type === 'button' && node.props.children === text)[0]
}

test('section mounts, loads three cards, and batch-deletes across namespaces', async () => {
  const { api, calls, store } = stubApi()
  const { renderer, captured } = mount(api)
  assert.equal(captured.options.id, 'opencode-models')
  assert.equal(captured.options.order, -100, 'pinned to the top of the settings sidebar')
  await flush()

  assert.equal(calls.describe, 1)
  assert.equal(calls.discover.length, 2)
  const text = JSON.stringify(renderer.toJSON())
  assert.ok(text.includes('OpenCode Free') && text.includes('OpenCode Go'), 'opencode tier headers render')
  assert.ok(text.includes('t:others'), 'other card header renders')
  assert.ok(text.includes('deepseek-v4-flash') && text.includes('deepseek-v4-pro'), 'official models render in the other card')
  assert.ok(text.includes('fresh-free'), 'available pick renders')
  assert.equal(checkboxes(renderer).length, 5, 'one checkbox per configured row across all cards')

  // Row order: free[big-pickle, x-preview-f-free], go[go-a], other[deepseek-v4-flash, deepseek-v4-pro].
  const boxes = checkboxes(renderer)
  TestRenderer.act(() => { boxes[1].props.onChange() })
  TestRenderer.act(() => { boxes[4].props.onChange() })
  assert.ok(button(renderer, 't:deleteSelected'), 'bulk bar appears once anything is selected')
  assert.equal(calls.update.length, 0, 'arming the delete does not write')

  TestRenderer.act(() => { button(renderer, 't:deleteSelected').props.onClick() })
  assert.ok(button(renderer, 't:confirmDelete (2)'), 'confirm step waits for a second click')
  assert.equal(calls.update.length, 0)

  TestRenderer.act(() => { button(renderer, 't:confirmDelete (2)').props.onClick() })
  await flush(100)

  assert.equal(calls.update.length, 2, 'one guarded write per affected namespace')
  assert.deepEqual(calls.update[0], {
    ns: 'llm-pi-ai',
    patch: { providers: { opencode: { models: [{ id: 'big-pickle', name: 'Big Pickle', contextWindow: 1048576, maxTokens: 131072, input: ['text'] }] } } },
    expectedRevision: 3,
  })
  assert.deepEqual(calls.update[1], {
    ns: 'llm-deepseek',
    patch: { models: [{ id: 'deepseek-v4-flash', name: 'DeepSeek V4 Flash', contextWindow: 128000, maxTokens: 32000, input: ['text'] }] },
    expectedRevision: 1,
  })
  assert.deepEqual(store['llm-pi-ai'].providers.opencode.models.map((m) => m.id), ['big-pickle'])
  assert.deepEqual(store['llm-deepseek'].models.map((m) => m.id), ['deepseek-v4-flash'])
  assert.deepEqual(store['llm-pi-ai'].providers['opencode-go'].models.map((m) => m.id), ['go-a'], 'untouched route stays')

  // The post-delete reload renders without the removed rows and shows the notice.
  const after = JSON.stringify(renderer.toJSON())
  // The removed free model is still live, so it now shows under "available";
  // what must disappear is its CONFIGURED row. The official model is gone entirely.
  const rows = renderer.root.findAll((node) => node.props.className === 'ocm-row')
  assert.equal(rows.length, 3, 'configured rows shrink to the survivors')
  assert.ok(!after.includes('deepseek-v4-pro'), 'removed official model disappears')
  assert.ok(after.includes('fresh-free'), 'the surviving live free model is available to re-adopt')
  assert.ok(after.includes('t:deleted'), 'summary notice renders')
})

test('single-row removal on the other card writes only its namespace', async () => {
  const { api, calls, store } = stubApi()
  const { renderer } = mount(api)
  await flush()

  const removes = renderer.root.findAll((node) => node.props.className === 'ocm-remove')
  assert.equal(removes.length, 5)
  TestRenderer.act(() => { removes[4].props.onClick() }) // deepseek-v4-pro row
  await flush(100)
  assert.equal(calls.update.length, 1)
  assert.equal(calls.update[0].ns, 'llm-deepseek')
  assert.deepEqual(store['llm-deepseek'].models.map((m) => m.id), ['deepseek-v4-flash'])
})

test('a failing describe degrades to the inline error instead of unmounting', async () => {
  const { api } = stubApi({ describeFails: true })
  const { renderer } = mount(api)
  await flush()
  const text = JSON.stringify(renderer.toJSON())
  assert.ok(text.includes('t:loadFailed'), 'inline load error renders')
  assert.ok(text.includes('TEST_DOWN'), 'wire error code surfaces')
})