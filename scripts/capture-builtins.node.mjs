import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import test from 'node:test'

import * as captureDriver from './capture-builtins.mjs'

const { captureBuiltins } = captureDriver

const BUILTIN_CAPTURES = [
  ['builtin-normal', 'normal'],
  ['builtin-unlit-color', 'unlit-color'],
  ['builtin-uv-grid', 'uv-grid'],
  ['builtin-fresnel', 'fresnel'],
  ['builtin-toon', 'toon'],
  ['builtin-pbr', 'pbr'],
  ['builtin-procedural-matcap', 'procedural-matcap'],
  ['builtin-rim-light', 'rim-light'],
]

function pngFixture(width = 320, height = 200) {
  const bytes = Buffer.alloc(24)
  Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]).copy(bytes)
  bytes.writeUInt32BE(13, 8)
  bytes.write('IHDR', 12, 'ascii')
  bytes.writeUInt32BE(width, 16)
  bytes.writeUInt32BE(height, 20)
  return bytes
}

class FakeWebSocket {
  readyState = 0
  sent = []
  closeCalls = 0
  #listeners = new Map()

  addEventListener(type, listener, options = {}) {
    const listeners = this.#listeners.get(type) ?? []
    listeners.push({ listener, once: options.once === true })
    this.#listeners.set(type, listeners)
  }

  removeEventListener(type, listener) {
    this.#listeners.set(type, (this.#listeners.get(type) ?? [])
      .filter((entry) => entry.listener !== listener))
  }

  emit(type, event = {}) {
    const listeners = [...(this.#listeners.get(type) ?? [])]
    for (const entry of listeners) {
      entry.listener(event)
      if (entry.once) this.removeEventListener(type, entry.listener)
    }
  }

  open() {
    this.readyState = 1
    this.emit('open')
  }

  send(message) {
    this.sent.push(JSON.parse(message))
  }

  close() {
    this.closeCalls += 1
    this.readyState = 3
    this.emit('close')
  }
}

async function makeHarness({
  states,
  screenshot = pngFixture(),
  stallEvaluate = false,
  cdpCloseError,
  chromeStopError,
  viteStopError,
} = {}) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'gltfvisu-capture-test-'))
  const commands = []
  const visits = []
  const stopped = []
  const closedTargets = []
  const stateQueues = new Map()
  const sessionShaders = new Map()
  const attachedSessions = new Set()
  let targetSequence = 0
  let sessionSequence = 0

  const cdp = {
    async send(method, params = {}, sessionId) {
      commands.push({ method, params, sessionId })
      if (method === 'Target.createTarget') return { targetId: `target-${++targetSequence}` }
      if (method === 'Target.attachToTarget') {
        assert.deepEqual(params, { targetId: `target-${targetSequence}`, flatten: true })
        const attachedSessionId = `session-${++sessionSequence}`
        attachedSessions.add(attachedSessionId)
        return { sessionId: attachedSessionId }
      }
      if (/^(?:Emulation|Page|Runtime)\./.test(method)) {
        assert.ok(attachedSessions.has(sessionId), `${method} must use the attached sessionId`)
      }
      if (method === 'Page.navigate') {
        const shaderId = new URL(params.url).searchParams.get('shader')
        visits.push(shaderId)
        sessionShaders.set(sessionId, shaderId)
        stateQueues.set(sessionId, [...(states?.[shaderId] ?? [
          { status: 'loading', shaderId },
          { status: 'ready', shaderId },
        ])])
        return { frameId: `frame-${sessionId}` }
      }
      if (method === 'Runtime.evaluate') {
        if (stallEvaluate) return new Promise(() => {})
        const queue = stateQueues.get(sessionId) ?? []
        const shaderId = sessionShaders.get(sessionId)
        const value = queue.length > 1
          ? queue.shift()
          : (queue[0] ?? { status: 'loading', shaderId })
        return { result: { type: 'object', value } }
      }
      if (method === 'Page.captureScreenshot') return { data: screenshot.toString('base64') }
      if (method === 'Target.closeTarget') {
        closedTargets.push(params.targetId)
        return { success: true }
      }
      return {}
    },
    async close() {
      stopped.push('cdp')
      if (cdpCloseError !== undefined) throw cdpCloseError
    },
  }

  return {
    outputDirectory,
    commands,
    visits,
    stopped,
    closedTargets,
    options: {
      outputDirectory,
      startVite: async () => ({
        origin: 'http://127.0.0.1:4173',
        stop: async () => {
          stopped.push('vite')
          if (viteStopError !== undefined) throw viteStopError
        },
      }),
      launchChrome: async () => ({
        webSocketUrl: 'ws://127.0.0.1/devtools/browser/test',
        stop: async () => {
          stopped.push('chrome')
          if (chromeStopError !== undefined) throw chromeStopError
        },
      }),
      connectCdp: async () => cdp,
      sleep: async () => {},
    },
    async cleanup() {
      await rm(outputDirectory, { recursive: true, force: true })
    },
  }
}

test('captures every built-in exactly once with fixed viewport and PNG screenshot settings', async () => {
  const harness = await makeHarness()
  try {
    await captureBuiltins(harness.options)

    assert.deepEqual(harness.visits, BUILTIN_CAPTURES.map(([id]) => id))
    assert.equal(new Set(harness.visits).size, BUILTIN_CAPTURES.length)
    assert.deepEqual(
      harness.commands
        .filter(({ method }) => method === 'Emulation.setDeviceMetricsOverride')
        .map(({ params }) => params),
      Array.from({ length: 8 }, () => ({
        width: 320,
        height: 200,
        deviceScaleFactor: 1,
        mobile: false,
      })),
    )
    assert.deepEqual(
      harness.commands
        .filter(({ method }) => method === 'Page.captureScreenshot')
        .map(({ params }) => params),
      Array.from({ length: 8 }, () => ({ format: 'png', fromSurface: true })),
    )
    assert.equal(harness.commands.filter(({ method }) => method === 'Runtime.evaluate').length, 16)
    assert.equal(harness.closedTargets.length, 8)
    assert.deepEqual((await readdir(harness.outputDirectory)).sort(), BUILTIN_CAPTURES
      .map(([, slug]) => `${slug}.png`)
      .sort())
    for (const [, slug] of BUILTIN_CAPTURES) {
      assert.deepEqual(await readFile(join(harness.outputDirectory, `${slug}.png`)), pngFixture())
    }
    assert.deepEqual(harness.stopped, ['cdp', 'chrome', 'vite'])
  } finally {
    await harness.cleanup()
  }
})

test('rejects a harness error without polling again and cleans up every process', async () => {
  const shaderId = BUILTIN_CAPTURES[0][0]
  const harness = await makeHarness({
    states: { [shaderId]: [{ status: 'error', shaderId, message: 'shader compile failed' }] },
  })
  try {
    await assert.rejects(captureBuiltins(harness.options), /shader compile failed/)
    assert.equal(harness.commands.filter(({ method }) => method === 'Runtime.evaluate').length, 1)
    assert.equal(harness.commands.filter(({ method }) => method === 'Page.captureScreenshot').length, 0)
    assert.equal(harness.closedTargets.length, 1)
    assert.deepEqual(harness.stopped, ['cdp', 'chrome', 'vite'])
  } finally {
    await harness.cleanup()
  }
})

test('wall-clock timeout rejects a never-settling readiness request and cleans up', async () => {
  const harness = await makeHarness({ stallEvaluate: true })
  try {
    const outcome = await Promise.race([
      captureBuiltins({ ...harness.options, readinessTimeoutMs: 20 }).then(
        () => ({ status: 'resolved' }),
        (error) => ({ status: 'rejected', error }),
      ),
      delay(250, { status: 'hung' }),
    ])
    assert.equal(outcome.status, 'rejected')
    assert.match(outcome.error.message, /Timed out after 20ms waiting for builtin-normal/)
    assert.equal(harness.closedTargets.length, 1)
    assert.deepEqual(harness.stopped, ['cdp', 'chrome', 'vite'])
  } finally {
    await harness.cleanup()
  }
})

test('validates PNG signature and IHDR dimensions before replacing a portrait', async () => {
  const invalidFixtures = [
    { name: 'signature', bytes: Buffer.from('not a png'), message: /PNG signature/ },
    { name: 'dimensions', bytes: pngFixture(319, 200), message: /expected 320 x 200, received 319 x 200/ },
  ]

  for (const fixture of invalidFixtures) {
    const harness = await makeHarness({ screenshot: fixture.bytes })
    const target = join(harness.outputDirectory, 'normal.png')
    const original = Buffer.from(`original-${fixture.name}`)
    await writeFile(target, original)
    try {
      await assert.rejects(captureBuiltins(harness.options), fixture.message)
      assert.deepEqual(await readFile(target), original)
      assert.deepEqual(
        (await readdir(harness.outputDirectory)).map((path) => basename(path)),
        ['normal.png'],
      )
      assert.equal(harness.closedTargets.length, 1)
      assert.deepEqual(harness.stopped, ['cdp', 'chrome', 'vite'])
    } finally {
      await harness.cleanup()
    }
  }
})

test('WebSocket handshake times out on the wall clock and closes a stalled socket', async () => {
  const socket = new FakeWebSocket()
  await assert.rejects(
    captureDriver.connectCdpWebSocket('ws://devtools.test', {
      createWebSocket: () => socket,
      timeoutMs: 20,
    }),
    /Timed out after 20ms connecting to Chrome DevTools/,
  )
  assert.equal(socket.closeCalls, 1)
})

test('WebSocket handshake rejects a pre-open close or error without waiting for timeout', async (context) => {
  for (const scenario of [
    { event: 'close', message: /closed before connecting/ },
    { event: 'error', message: /Unable to connect/ },
  ]) {
    await context.test(scenario.event, async () => {
      const socket = new FakeWebSocket()
      const connection = captureDriver.connectCdpWebSocket('ws://devtools.test', {
        createWebSocket: () => socket,
        timeoutMs: 250,
      })
      queueMicrotask(() => socket.emit(scenario.event))
      await assert.rejects(connection, scenario.message)
    })
  }
})

test('CDP transport matches increasing request IDs and preserves flattened session framing', async () => {
  const socket = new FakeWebSocket()
  const connection = captureDriver.connectCdpWebSocket('ws://devtools.test', {
    createWebSocket: () => socket,
    timeoutMs: 250,
  })
  socket.open()
  const cdp = await connection

  const attached = cdp.send('Target.attachToTarget', { targetId: 'target-1', flatten: true })
  assert.deepEqual(socket.sent[0], {
    id: 1,
    method: 'Target.attachToTarget',
    params: { targetId: 'target-1', flatten: true },
  })
  socket.emit('message', { data: JSON.stringify({ id: 1, result: { sessionId: 'session-1' } }) })
  assert.deepEqual(await attached, { sessionId: 'session-1' })

  const enabled = cdp.send('Page.enable', {}, 'session-1')
  assert.deepEqual(socket.sent[1], {
    id: 2,
    method: 'Page.enable',
    params: {},
    sessionId: 'session-1',
  })
  socket.emit('message', { data: JSON.stringify({ id: 2, result: {} }) })
  assert.deepEqual(await enabled, {})
  await cdp.close()
})

test('CDP transport rejects pending requests when the socket closes or errors', async (context) => {
  for (const scenario of [
    { event: 'close', message: /disconnected/ },
    { event: 'error', message: /connection failed/ },
  ]) {
    await context.test(scenario.event, async () => {
      const socket = new FakeWebSocket()
      const connection = captureDriver.connectCdpWebSocket('ws://devtools.test', {
        createWebSocket: () => socket,
        timeoutMs: 250,
      })
      socket.open()
      const cdp = await connection
      const pending = cdp.send('Runtime.evaluate', { expression: 'never' }, 'session-1')
      socket.emit(scenario.event)
      await assert.rejects(pending, scenario.message)
    })
  }
})

test('capture failure aggregates cleanup failures while attempting every resource', async () => {
  const shaderId = BUILTIN_CAPTURES[0][0]
  const harness = await makeHarness({
    states: { [shaderId]: [{ status: 'error', shaderId, message: 'shader compile failed' }] },
    chromeStopError: new Error('chrome stop failed'),
  })
  try {
    let failure
    try {
      await captureBuiltins(harness.options)
    } catch (error) {
      failure = error
    }
    assert.ok(failure instanceof AggregateError)
    assert.deepEqual(failure.errors.map((error) => error.message), [
      'Portrait harness failed for builtin-normal: shader compile failed',
      'chrome stop failed',
    ])
    assert.deepEqual(harness.stopped, ['cdp', 'chrome', 'vite'])
  } finally {
    await harness.cleanup()
  }
})

test('Chrome cleanup removes the profile even when controllable process termination throws', async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.kill = () => { throw new Error('kill failed') }
  const removals = []

  await assert.rejects(
    captureDriver.cleanupChromeProcess(child, 'temporary-profile', {
      removeProfile: async (...args) => removals.push(args),
    }),
    /kill failed/,
  )
  assert.deepEqual(removals, [[
    'temporary-profile',
    { recursive: true, force: true, maxRetries: 5, retryDelay: 100 },
  ]])
})

test('controllable child process escalates from graceful termination to SIGKILL', async () => {
  const child = new EventEmitter()
  child.exitCode = null
  child.signalCode = null
  child.signals = []
  child.kill = (signal = 'SIGTERM') => {
    child.signals.push(signal)
    if (signal === 'SIGKILL') {
      child.signalCode = signal
      queueMicrotask(() => child.emit('exit', null, signal))
    }
    return true
  }

  await captureDriver.terminateProcess(child, { graceMs: 10 })
  assert.deepEqual(child.signals, ['SIGTERM', 'SIGKILL'])
})
