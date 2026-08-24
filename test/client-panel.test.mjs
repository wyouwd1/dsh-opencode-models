// Headless mount of the settings-section bundle: loads lib/client.js through
// a fake module loader, registers into a fake ctx, mounts the section with
// react-test-renderer (passive effects run), and drives the load path against
// stubbed wire APIs. Guards the async wire unwrap (a synchronous unwrap of a
// Promise crashed the whole section on mount), the pinned sidebar order, the
// two opencode-only cards, and the cross-card batch removal flow with one
// guarded write per affected route.
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
  }
  const revisions = { 'llm-pi-ai': 3 }
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
        revisions[ns] += 1
        return { result: { ok: true, value: store[ns] } }
      },
    },
    llm: {
      async discoverModels(request) {
        calls.discover.push(request)
        const models = request.baseURL === 'https://opencode.ai/zen/v1'
          ? [{ id: 'big-pickle' }, { id: 'x-preview-f-free' }, { id: 'ox-alpha-free' }, { id: 'deepseek-v4-pro' }]
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

test('section mounts, loads the two opencode cards, and batch-deletes across routes', async () => {
  const { api, calls, store } = stubApi()
  const { renderer, captured } = mount(api)
  assert.equal(captured.options.id, 'opencode-models')
  assert.equal(captured.options.order, -100, 'pinned to the top of the settings sidebar')
  await flush()

  assert.equal(calls.describe, 1)
  assert.equal(calls.discover.length, 2)
  const text = JSON.stringify(renderer.toJSON())
  assert.ok(text.includes('OpenCode Free') && text.includes('OpenCode Go'), 'opencode tier headers render')
  assert.ok(text.includes('Big Pickle') && text.includes('X Preview Free'), 'free configured rows render')
  assert.ok(text.includes('Go A'), 'go configured rows render')
  assert.ok(text.includes('ox-alpha-free'), 'official free pick renders')
  assert.ok(!text.includes('deepseek-v4-pro'), 'a paid id riding the free listing never renders')
  assert.ok(!text.includes('deepseek-v4-flash-free'), 'a suffix-only id never renders')
  assert.equal(checkboxes(renderer).length, 3, 'one checkbox per configured row (no other providers)')

  // Row order: free[big-pickle, x-preview-f-free], go[go-a].
  const boxes = checkboxes(renderer)
  TestRenderer.act(() => { boxes[1].props.onChange() }) // x-preview-f-free
  TestRenderer.act(() => { boxes[2].props.onChange() }) // go-a
  assert.ok(button(renderer, 't:deleteSelected'), 'bulk bar appears once anything is selected')
  assert.equal(calls.update.length, 0, 'arming the delete does not write')

  TestRenderer.act(() => { button(renderer, 't:deleteSelected').props.onClick() })
  assert.ok(button(renderer, 't:confirmDelete (2)'), 'confirm step waits for a second click')
  assert.equal(calls.update.length, 0)

  TestRenderer.act(() => { button(renderer, 't:confirmDelete (2)').props.onClick() })
  await flush(100)

  assert.equal(calls.update.length, 2, 'one guarded write per affected route')
  assert.deepEqual(calls.update[0], {
    ns: 'llm-pi-ai',
    patch: { providers: { opencode: { models: [{ id: 'big-pickle', name: 'Big Pickle', contextWindow: 1048576, maxTokens: 131072, input: ['text'] }] } } },
    expectedRevision: 3,
  })
  assert.deepEqual(calls.update[1], {
    ns: 'llm-pi-ai',
    patch: { providers: { 'opencode-go': { models: [] } } },
    expectedRevision: 4,
  })
  assert.deepEqual(store['llm-pi-ai'].providers.opencode.models.map((m) => m.id), ['big-pickle'])
  assert.deepEqual(store['llm-pi-ai'].providers['opencode-go'].models.map((m) => m.id), [])

  // The post-delete reload renders without the removed configured rows and shows the notice.
  const after = JSON.stringify(renderer.toJSON())
  const rows = renderer.root.findAll((node) => node.props.className === 'ocm-row')
  assert.equal(rows.length, 1, 'configured rows shrink to the survivors')
  const rowText = (node, out = []) => {
    if (node === null || node === undefined) return out
    if (typeof node === 'string') { out.push(node); return out }
    if (Array.isArray(node)) { for (const child of node) rowText(child, out); return out }
    if (node.props && node.props.children !== undefined) rowText(node.props.children, out)
    return out
  }
  const texts = rows.map((r) => rowText(r).join(' '))
  assert.ok(!texts.some((t) => t.includes('go-a')), 'removed go row disappears')
  assert.ok(!texts.some((t) => t.includes('x-preview-f-free')), 'removed free row disappears')
  assert.ok(after.includes('ox-alpha-free'), 'the surviving official free model is available to re-adopt')
  assert.ok(!after.includes('deepseek-v4-pro'), 'paid id stays invisible after reload')
  assert.ok(after.includes('t:deleted'), 'summary notice renders')
})

test('single-row removal writes only that route', async () => {
  const { api, calls, store } = stubApi()
  const { renderer } = mount(api)
  await flush()

  const removes = renderer.root.findAll((node) => node.props.className === 'ocm-remove')
  assert.equal(removes.length, 3)
  TestRenderer.act(() => { removes[0].props.onClick() }) // big-pickle row
  await flush(100)
  assert.equal(calls.update.length, 1)
  assert.equal(calls.update[0].ns, 'llm-pi-ai')
  assert.deepEqual(store['llm-pi-ai'].providers.opencode.models.map((m) => m.id), ['x-preview-f-free'])
})

test('a failing describe degrades to the inline error instead of unmounting', async () => {
  const { api } = stubApi({ describeFails: true })
  const { renderer } = mount(api)
  await flush()
  const text = JSON.stringify(renderer.toJSON())
  assert.ok(text.includes('t:loadFailed'), 'inline load error renders')
  assert.ok(text.includes('TEST_DOWN'), 'wire error code surfaces')
})