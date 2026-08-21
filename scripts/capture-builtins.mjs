import { createServer } from 'node:net'
import { access, mkdir, mkdtemp, rename, rm, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { randomUUID } from 'node:crypto'

const PORTRAIT_WIDTH = 320
const PORTRAIT_HEIGHT = 200
const READINESS_TIMEOUT_MS = 20_000
const READINESS_POLL_MS = 100
const PNG_SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
const SCRIPT_DIRECTORY = dirname(fileURLToPath(import.meta.url))
const DEFAULT_PROJECT_ROOT = resolve(SCRIPT_DIRECTORY, '..')

export const BUILTIN_CAPTURES = Object.freeze([
  Object.freeze({ id: 'builtin-normal', slug: 'normal' }),
  Object.freeze({ id: 'builtin-unlit-color', slug: 'unlit-color' }),
  Object.freeze({ id: 'builtin-uv-grid', slug: 'uv-grid' }),
  Object.freeze({ id: 'builtin-fresnel', slug: 'fresnel' }),
  Object.freeze({ id: 'builtin-toon', slug: 'toon' }),
  Object.freeze({ id: 'builtin-pbr', slug: 'pbr' }),
  Object.freeze({ id: 'builtin-procedural-matcap', slug: 'procedural-matcap' }),
  Object.freeze({ id: 'builtin-rim-light', slug: 'rim-light' }),
])

export async function captureBuiltins(options = {}) {
  const projectRoot = resolve(options.projectRoot ?? DEFAULT_PROJECT_ROOT)
  const outputDirectory = resolve(options.outputDirectory ?? join(projectRoot, 'src', 'assets', 'portraits'))
  const startVite = options.startVite ?? startViteProcess
  const launchChrome = options.launchChrome ?? launchChromeProcess
  const connectCdp = options.connectCdp ?? connectCdpWebSocket
  const sleep = options.sleep ?? delay
  const readinessTimeoutMs = options.readinessTimeoutMs ?? READINESS_TIMEOUT_MS
  const connectionTimeoutMs = options.connectionTimeoutMs ?? READINESS_TIMEOUT_MS
  let vite
  let chrome
  let cdp
  let failure
  const cleanupErrors = []

  await mkdir(outputDirectory, { recursive: true })
  try {
    vite = await startVite({ projectRoot })
    chrome = await launchChrome({ projectRoot })
    cdp = await connectCdp(chrome.webSocketUrl, { timeoutMs: connectionTimeoutMs })

    for (const capture of BUILTIN_CAPTURES) {
      await captureBuiltin({
        capture,
        cdp,
        origin: vite.origin,
        outputDirectory,
        sleep,
        readinessTimeoutMs,
      })
    }
  } catch (error) {
    failure = error
  } finally {
    for (const resource of [cdp, chrome, vite]) {
      if (resource === undefined) continue
      try {
        await resource.close?.() ?? await resource.stop?.()
      } catch (error) {
        cleanupErrors.push(error)
      }
    }
  }

  if (failure !== undefined && cleanupErrors.length > 0) {
    throw new AggregateError(
      [failure, ...cleanupErrors],
      'Portrait capture failed and one or more resources could not be cleaned up',
      { cause: failure },
    )
  }
  if (failure !== undefined) throw failure
  if (cleanupErrors.length > 0) throw new AggregateError(cleanupErrors, 'Unable to clean up portrait capture resources')
}

async function captureBuiltin({ capture, cdp, origin, outputDirectory, sleep, readinessTimeoutMs }) {
  let targetId
  let failure
  try {
    const target = await cdp.send('Target.createTarget', { url: 'about:blank' })
    targetId = target.targetId
    if (typeof targetId !== 'string') throw new Error(`Chrome did not create a page for ${capture.id}`)

    const attachment = await cdp.send('Target.attachToTarget', { targetId, flatten: true })
    const sessionId = attachment.sessionId
    if (typeof sessionId !== 'string') throw new Error(`Chrome did not attach to the page for ${capture.id}`)

    await cdp.send('Page.enable', {}, sessionId)
    await cdp.send('Runtime.enable', {}, sessionId)
    await cdp.send('Emulation.setDeviceMetricsOverride', {
      width: PORTRAIT_WIDTH,
      height: PORTRAIT_HEIGHT,
      deviceScaleFactor: 1,
      mobile: false,
    }, sessionId)

    const url = new URL('/', origin)
    url.searchParams.set('capture', 'builtin-portrait')
    url.searchParams.set('shader', capture.id)
    await cdp.send('Page.navigate', { url: url.href }, sessionId)
    await waitForPortraitReady({ cdp, sessionId, shaderId: capture.id, sleep, readinessTimeoutMs })

    const screenshot = await cdp.send('Page.captureScreenshot', {
      format: 'png',
      fromSurface: true,
    }, sessionId)
    if (typeof screenshot.data !== 'string') throw new Error(`Chrome did not return PNG data for ${capture.id}`)
    const bytes = Buffer.from(screenshot.data, 'base64')
    validatePortraitPng(bytes)
    await replacePortraitAtomically(join(outputDirectory, `${capture.slug}.png`), bytes)
    console.log(`Captured ${capture.id} -> ${capture.slug}.png (${PORTRAIT_WIDTH} x ${PORTRAIT_HEIGHT})`)
  } catch (error) {
    failure = error
  } finally {
    if (targetId !== undefined) {
      try {
        await cdp.send('Target.closeTarget', { targetId })
      } catch (error) {
        if (failure === undefined) failure = error
      }
    }
  }

  if (failure !== undefined) throw failure
}

async function waitForPortraitReady({ cdp, sessionId, shaderId, sleep, readinessTimeoutMs }) {
  await rejectAfter(pollPortraitReady({ cdp, sessionId, shaderId, sleep }), {
    timeoutMs: readinessTimeoutMs,
    message: `Timed out after ${readinessTimeoutMs}ms waiting for ${shaderId}`,
  })
}

async function pollPortraitReady({ cdp, sessionId, shaderId, sleep }) {
  while (true) {
    const evaluation = await cdp.send('Runtime.evaluate', {
      expression: "globalThis.__GLTFVISU_PORTRAIT__ ?? { status: 'loading' }",
      returnByValue: true,
      awaitPromise: true,
    }, sessionId)
    const state = evaluation?.result?.value
    if (state?.status === 'ready' && state.shaderId === shaderId) return
    if (state?.status === 'error') {
      throw new Error(`Portrait harness failed for ${shaderId}: ${state.message ?? 'unknown error'}`)
    }

    await sleep(READINESS_POLL_MS)
  }
}

async function rejectAfter(operation, { timeoutMs, message, onTimeout }) {
  const { promise: timeout, reject } = Promise.withResolvers()
  const timer = setTimeout(() => {
    reject(new Error(message))
    try {
      onTimeout?.()
    } catch {
      // The timeout rejection remains the primary failure.
    }
  }, timeoutMs)
  try {
    return await Promise.race([operation, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export function validatePortraitPng(bytes) {
  if (!Buffer.isBuffer(bytes) || bytes.length < 24 || !bytes.subarray(0, 8).equals(PNG_SIGNATURE)) {
    throw new Error('Portrait capture has an invalid PNG signature')
  }
  if (bytes.readUInt32BE(8) !== 13 || bytes.toString('ascii', 12, 16) !== 'IHDR') {
    throw new Error('Portrait capture is missing a valid PNG IHDR')
  }
  const width = bytes.readUInt32BE(16)
  const height = bytes.readUInt32BE(20)
  if (width !== PORTRAIT_WIDTH || height !== PORTRAIT_HEIGHT) {
    throw new Error(`Portrait PNG expected ${PORTRAIT_WIDTH} x ${PORTRAIT_HEIGHT}, received ${width} x ${height}`)
  }
}

async function replacePortraitAtomically(target, bytes) {
  const temporary = `${target}.tmp-${process.pid}-${randomUUID()}`
  try {
    await writeFile(temporary, bytes, { flag: 'wx' })
    await rename(temporary, target)
  } finally {
    await unlink(temporary).catch((error) => {
      if (error?.code !== 'ENOENT') throw error
    })
  }
}

async function reservePort() {
  const server = createServer()
  await new Promise((resolvePromise, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolvePromise)
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('Unable to reserve a Vite port')
  await new Promise((resolvePromise, reject) => server.close((error) => error === undefined ? resolvePromise() : reject(error)))
  return address.port
}

async function startViteProcess({ projectRoot }) {
  const port = await reservePort()
  const origin = `http://127.0.0.1:${port}`
  const viteCli = join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js')
  const child = spawn(process.execPath, [
    viteCli,
    '--host', '127.0.0.1',
    '--port', String(port),
    '--strictPort',
  ], {
    cwd: projectRoot,
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })
  const diagnostics = collectDiagnostics(child.stderr)

  try {
    await waitForVite(origin, child, diagnostics)
  } catch (error) {
    await terminateProcess(child)
    throw error
  }
  return {
    origin,
    stop: async () => terminateProcess(child),
  }
}

async function waitForVite(origin, child, diagnostics) {
  const deadline = Date.now() + READINESS_TIMEOUT_MS
  while (Date.now() < deadline) {
    if (child.exitCode !== null) {
      throw new Error(`Vite exited before capture started${formatDiagnostics(diagnostics())}`)
    }
    try {
      const response = await fetch(origin, { signal: AbortSignal.timeout(1_000) })
      if (response.ok) return
    } catch {
      // Vite is still starting.
    }
    await delay(50)
  }
  throw new Error(`Timed out after ${READINESS_TIMEOUT_MS}ms waiting for Vite${formatDiagnostics(diagnostics())}`)
}

async function launchChromeProcess() {
  const executable = await resolveChromeExecutable()
  const profileDirectory = await mkdtemp(join(tmpdir(), 'gltfvisu-chrome-'))
  const child = spawn(executable, [
    '--headless=new',
    '--remote-debugging-port=0',
    `--user-data-dir=${profileDirectory}`,
    '--hide-scrollbars',
    '--disable-extensions',
    '--force-device-scale-factor=1',
    'about:blank',
  ], {
    stdio: ['ignore', 'ignore', 'pipe'],
    windowsHide: true,
  })

  try {
    const webSocketUrl = await readDevToolsUrl(child)
    return {
      webSocketUrl,
      stop: async () => cleanupChromeProcess(child, profileDirectory),
    }
  } catch (error) {
    try {
      await cleanupChromeProcess(child, profileDirectory)
    } catch (cleanupError) {
      throw new AggregateError(
        [error, cleanupError],
        'Chrome startup failed and its resources could not be cleaned up',
        { cause: error },
      )
    }
    throw error
  }
}

export async function cleanupChromeProcess(child, profileDirectory, options = {}) {
  const terminate = options.terminate ?? terminateProcess
  const removeProfile = options.removeProfile ?? rm
  const cleanupErrors = []
  try {
    await terminate(child)
  } catch (error) {
    cleanupErrors.push(error)
  } finally {
    try {
      await removeProfile(profileDirectory, {
        recursive: true,
        force: true,
        maxRetries: 5,
        retryDelay: 100,
      })
    } catch (error) {
      cleanupErrors.push(error)
    }
  }

  if (cleanupErrors.length === 1) throw cleanupErrors[0]
  if (cleanupErrors.length > 1) {
    throw new AggregateError(cleanupErrors, 'Unable to terminate Chrome and remove its temporary profile')
  }
}

async function resolveChromeExecutable() {
  const candidates = [
    process.env.CHROME_PATH,
    'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
    'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
    'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  ].filter((candidate) => typeof candidate === 'string' && candidate.length > 0)

  for (const candidate of candidates) {
    try {
      await access(candidate)
      return candidate
    } catch {
      // Try the next known browser location.
    }
  }
  throw new Error('Unable to find Chrome or Edge. Set CHROME_PATH to a Chromium executable.')
}

function readDevToolsUrl(child) {
  return new Promise((resolvePromise, reject) => {
    let stderr = ''
    let settled = false
    const timeout = setTimeout(() => finish(new Error(`Timed out after ${READINESS_TIMEOUT_MS}ms waiting for Chrome DevTools${formatDiagnostics(stderr)}`)), READINESS_TIMEOUT_MS)

    const finish = (error, value) => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.stderr?.off('data', onData)
      child.off('error', onError)
      child.off('exit', onExit)
      if (error !== undefined) reject(error)
      else resolvePromise(value)
    }
    const onData = (chunk) => {
      stderr += chunk.toString()
      const match = stderr.match(/DevTools listening on (ws:\/\/\S+)/)
      if (match !== null) finish(undefined, match[1])
    }
    const onError = (error) => finish(error)
    const onExit = (code) => finish(new Error(`Chrome exited with code ${code}${formatDiagnostics(stderr)}`))

    child.stderr?.on('data', onData)
    child.once('error', onError)
    child.once('exit', onExit)
  })
}

export async function connectCdpWebSocket(webSocketUrl, options = {}) {
  const createWebSocket = options.createWebSocket ?? ((url) => {
    if (typeof WebSocket !== 'function') throw new Error('Node.js 22 or newer is required for WebSocket support')
    return new WebSocket(url)
  })
  const timeoutMs = options.timeoutMs ?? READINESS_TIMEOUT_MS
  const socket = createWebSocket(webSocketUrl)
  const handshake = new Promise((resolvePromise, reject) => {
    const onOpen = () => finish()
    const onError = () => finish(new Error('Unable to connect to Chrome DevTools'))
    const onClose = () => finish(new Error('Chrome DevTools closed before connecting'))
    const finish = (error) => {
      socket.removeEventListener('open', onOpen)
      socket.removeEventListener('error', onError)
      socket.removeEventListener('close', onClose)
      if (error === undefined) resolvePromise()
      else reject(error)
    }
    socket.addEventListener('open', onOpen)
    socket.addEventListener('error', onError)
    socket.addEventListener('close', onClose)
  })
  await rejectAfter(handshake, {
    timeoutMs,
    message: `Timed out after ${timeoutMs}ms connecting to Chrome DevTools`,
    onTimeout: () => socket.close(),
  })
  return new CdpClient(socket)
}

class CdpClient {
  #nextId = 1
  #pending = new Map()
  #socket

  constructor(socket) {
    this.#socket = socket
    socket.addEventListener('message', (event) => this.#receive(event.data))
    socket.addEventListener('close', () => this.#rejectPending(new Error('Chrome DevTools disconnected')))
    socket.addEventListener('error', () => this.#rejectPending(new Error('Chrome DevTools connection failed')))
  }

  send(method, params = {}, sessionId) {
    if (this.#socket.readyState !== 1) return Promise.reject(new Error('Chrome DevTools is not connected'))
    const id = this.#nextId++
    const message = { id, method, params }
    if (sessionId !== undefined) message.sessionId = sessionId
    return new Promise((resolvePromise, reject) => {
      this.#pending.set(id, { resolve: resolvePromise, reject })
      this.#socket.send(JSON.stringify(message))
    })
  }

  async close() {
    if (this.#socket.readyState === 2 || this.#socket.readyState === 3) return
    const closed = new Promise((resolvePromise) => this.#socket.addEventListener('close', resolvePromise, { once: true }))
    this.#socket.close()
    await Promise.race([closed, delay(1_000)])
  }

  #receive(data) {
    let message
    try {
      message = JSON.parse(typeof data === 'string' ? data : Buffer.from(data).toString('utf8'))
    } catch {
      return
    }
    if (typeof message.id !== 'number') return
    const pending = this.#pending.get(message.id)
    if (pending === undefined) return
    this.#pending.delete(message.id)
    if (message.error !== undefined) {
      pending.reject(new Error(`CDP ${message.error.code}: ${message.error.message}`))
    } else {
      pending.resolve(message.result ?? {})
    }
  }

  #rejectPending(error) {
    for (const pending of this.#pending.values()) pending.reject(error)
    this.#pending.clear()
  }
}

function collectDiagnostics(stream) {
  let text = ''
  stream?.on('data', (chunk) => {
    text = `${text}${chunk.toString()}`.slice(-8_000)
  })
  return () => text
}

function formatDiagnostics(value) {
  const text = typeof value === 'function' ? value() : value
  return text.trim().length === 0 ? '' : `:\n${text.trim()}`
}

export async function terminateProcess(child, options = {}) {
  const graceMs = options.graceMs ?? 5_000
  if (child.exitCode !== null || child.signalCode !== null) return
  const exited = new Promise((resolvePromise) => child.once('exit', resolvePromise))
  child.kill()
  if (await Promise.race([exited.then(() => true), delay(graceMs, false)])) return
  child.kill('SIGKILL')
  await exited
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await captureBuiltins().catch((error) => {
    console.error(error)
    process.exitCode = 1
  })
}
