import assert from 'node:assert/strict'
import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { basename, join } from 'node:path'
import test from 'node:test'

import { captureBuiltins } from './capture-builtins.mjs'

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

async function makeHarness({ states, screenshot = pngFixture(), onSleep } = {}) {
  const outputDirectory = await mkdtemp(join(tmpdir(), 'gltfvisu-capture-test-'))
  const commands = []
  const visits = []
  const stopped = []
  const closedTargets = []
  const stateQueues = new Map()
  const sessionShaders = new Map()
  let targetSequence = 0
  let sessionSequence = 0

  const cdp = {
    async send(method, params = {}, sessionId) {
      commands.push({ method, params, sessionId })
      if (method === 'Target.createTarget') return { targetId: `target-${++targetSequence}` }
      if (method === 'Target.attachToTarget') return { sessionId: `session-${++sessionSequence}` }
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
        stop: async () => stopped.push('vite'),
      }),
      launchChrome: async () => ({
        webSocketUrl: 'ws://127.0.0.1/devtools/browser/test',
        stop: async () => stopped.push('chrome'),
      }),
      connectCdp: async () => cdp,
      sleep: async (milliseconds) => onSleep?.(milliseconds),
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
  let sleeps = 0
  const harness = await makeHarness({
    states: { [shaderId]: [{ status: 'error', shaderId, message: 'shader compile failed' }] },
    onSleep: () => { sleeps += 1 },
  })
  try {
    await assert.rejects(captureBuiltins(harness.options), /shader compile failed/)
    assert.equal(sleeps, 0)
    assert.equal(harness.commands.filter(({ method }) => method === 'Page.captureScreenshot').length, 0)
    assert.equal(harness.closedTargets.length, 1)
    assert.deepEqual(harness.stopped, ['cdp', 'chrome', 'vite'])
  } finally {
    await harness.cleanup()
  }
})

test('times out a loading harness after exactly 20 seconds and cleans up', async () => {
  let clock = 0
  const shaderId = BUILTIN_CAPTURES[0][0]
  const harness = await makeHarness({
    states: { [shaderId]: [{ status: 'loading', shaderId }] },
    onSleep: (milliseconds) => { clock += milliseconds },
  })
  try {
    await assert.rejects(captureBuiltins({
      ...harness.options,
      now: () => clock,
    }), /Timed out after 20000ms waiting for builtin-normal/)
    assert.equal(clock, 20_000)
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
