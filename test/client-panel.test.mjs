// Headless mount of the settings-section bundle: loads lib/client.js through
// a fake module loader, registers into a fake ctx, mounts the section with
// react-test-renderer (passive effects run), and drives the load path against
// stubbed wire APIs. Guards the async wire unwrap: a synchronous unwrap of a
// Promise crashed the whole section on mount (blank page under a live nav).
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
  // require() caches the bundle, so the factory registers exactly once per
  // process; factory() itself is pure, so every test re-derives from it.
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

const NAMESPACE = {
  ns: 'llm-pi-ai',
  value: { providers: {
    opencode: { displayName: 'OpenCode Free', models: [
      { id: 'x-preview-f-free', name: 'Ox Alpha Free', contextWindow: 1048576, maxTokens: 131072, input: ['text', 'image'] },
    ] },
    'opencode-go': { displayName: 'OpenCode Go', models: [] },
  } },
  revision: 3,
}

function stubApi({ describeFails = false } = {}) {
  const calls = { describe: 0, discover: [] }
  const api = {
    settings: {
      async describe() {
        calls.describe += 1
        if (describeFails) return { result: { ok: false, error: { code: 'TEST_DOWN' } } }
        return { result: { ok: true, value: { writable: true, hasDocument: true, namespaces: [NAMESPACE] } } }
      },
      async update() { return { result: { ok: true, value: NAMESPACE } } },
    },
    llm: {
      async discoverModels(request) {
        calls.discover.push(request)
        const models = request.baseURL === 'https://opencode.ai/zen/v1'
          ? [{ id: 'x-preview-f-free' }, { id: 'fresh-free' }]
          : [{ id: 'go-only' }]
        return { result: { ok: true, value: { models } } }
      },
    },
  }
  return { api, calls }
}

async function flush(millis = 50) {
  await new Promise((resolve) => setTimeout(resolve, millis))
}

test('section mounts, loads both tiers, and renders configured plus available rows', async () => {
  const loaded = loadFactory()
  const { api, calls } = stubApi()
  const captured = {}
  const { apply, inject } = loaded.factory((name) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') {
      return { Button: (props) => React.createElement('button', props, props.children) }
    }
    throw new Error('unexpected require: ' + name)
  })
  assert.deepEqual(inject, ['slots', 'locale', 'connection', 'remote'])
  apply(fakeCtx(api, captured))
  assert.equal(captured.options.id, 'opencode-models')

  const face = captured.options.inject()
  let renderer
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(captured.Component, { ...face, close() {} }))
  })
  await flush()

  assert.equal(calls.describe, 1)
  assert.equal(calls.discover.length, 2)
  const text = JSON.stringify(renderer.toJSON())
  assert.ok(text.includes('OpenCode Free') && text.includes('OpenCode Go'), 'tier headers render')
  assert.ok(text.includes('x-preview-f-free'), 'configured row renders')
  assert.ok(text.includes('fresh-free') && text.includes('go-only'), 'available picks render')
  assert.match(text, /t:configured/)
})

test('a failing describe degrades to the inline error instead of unmounting', async () => {
  const loaded = loadFactory()
  const { api } = stubApi({ describeFails: true })
  const captured = {}
  const { apply } = loaded.factory((name) => {
    if (name === 'react') return React
    if (name === '@deepseek-ai/dsh-client-ui-primitives') return { Button: (props) => React.createElement('button', props) }
    throw new Error('unexpected require: ' + name)
  })
  apply(fakeCtx(api, captured))
  const face = captured.options.inject()
  let renderer
  TestRenderer.act(() => {
    renderer = TestRenderer.create(React.createElement(captured.Component, { ...face, close() {} }))
  })
  await flush()
  const text = JSON.stringify(renderer.toJSON())
  assert.ok(text.includes('t:loadFailed'), 'inline load error renders')
  assert.ok(text.includes('TEST_DOWN'), 'wire error code surfaces')
})
