import { afterEach, describe, expect, it, vi } from 'vitest'
import { IndexedDbShaderRepository } from './IndexedDbShaderRepository'
import { openShaderDatabase, StorageError } from './database'
import type { ShaderDefinition } from '../domain/shader'

let databaseNumber = 0
const databaseNames: string[] = []
const repositories: IndexedDbShaderRepository[] = []

function createRepository(name = `shader-repository-${databaseNumber++}`): IndexedDbShaderRepository {
  databaseNames.push(name)
  const repository = new IndexedDbShaderRepository(name)
  repositories.push(repository)
  return repository
}

function createShader(overrides: Partial<ShaderDefinition> = {}): ShaderDefinition {
  return {
    id: 'shader-id',
    name: 'Soft glow',
    fragmentSource: 'void main() { outColor = vec4(1.0); }',
    origin: 'local',
    parameters: [{ id: 'gain', type: 'float', uniformName: 'uGain', label: 'Gain', min: 0, max: 2, step: 0.1, defaultValue: 1 }],
    parameterValues: { gain: 1 },
    createdAt: 10,
    updatedAt: 20,
    schemaVersion: 1,
    ...overrides,
  }
}

function deleteDatabase(name: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(name)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`Database deletion blocked: ${name}`))
  })
}

function writeRawV1Record(name: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(name, 1)
    request.onupgradeneeded = () => {
      const database = request.result
      const store = database.createObjectStore('shaders', { keyPath: 'id' })
      store.createIndex('updatedAt', 'updatedAt')
    }
    request.onerror = () => reject(request.error)
    request.onblocked = () => reject(new Error(`Database open blocked: ${name}`))
    request.onsuccess = () => {
      const database = request.result
      const transaction = database.transaction('shaders', 'readwrite')
      transaction.objectStore('shaders').put(value)
      transaction.oncomplete = () => {
        database.close()
        resolve()
      }
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    }
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  repositories.splice(0).forEach((repository) => repository.close())
  await Promise.all(databaseNames.splice(0).map(deleteDatabase))
})

describe('IndexedDbShaderRepository', () => {
  it('lists no shaders from a new database', async () => {
    const repository = createRepository()

    await expect(repository.list()).resolves.toEqual([])
    repository.close()
  })

  it('wraps a synchronous database open exception in StorageError', async () => {
    const error = new DOMException('Open failed', 'InvalidStateError')
    vi.spyOn(indexedDB, 'open').mockImplementation(() => { throw error })

    await expect(openShaderDatabase('failing-database')).rejects.toMatchObject({
      name: 'StorageError',
      message: 'Unable to open shader storage: IndexedDB open setup failed',
      cause: error,
    } satisfies Partial<StorageError>)
  })

  it('saves and gets an independent shader snapshot', async () => {
    const repository = createRepository()
    const shader = createShader()

    await repository.save(shader)
    shader.name = 'Changed after save'
    shader.parameters[0].label = 'Changed parameter after save'
    shader.parameterValues.gain = 2

    await expect(repository.get(shader.id)).resolves.toEqual(createShader())
    repository.close()
  })

  it('replaces a shader with the same id', async () => {
    const repository = createRepository()
    await repository.save(createShader())
    await repository.save(createShader({ name: 'Replacement', updatedAt: 21 }))

    await expect(repository.list()).resolves.toEqual([createShader({ name: 'Replacement', updatedAt: 21 })])
    repository.close()
  })

  it('lists shaders by updated time descending and name for ties', async () => {
    const repository = createRepository()
    await repository.save(createShader({ id: 'old', name: 'Zulu', updatedAt: 10 }))
    await repository.save(createShader({ id: 'alpha', name: 'Alpha', updatedAt: 20 }))
    await repository.save(createShader({ id: 'beta', name: 'Beta', updatedAt: 20 }))

    await expect(repository.list()).resolves.toMatchObject([
      { id: 'alpha', name: 'Alpha' },
      { id: 'beta', name: 'Beta' },
      { id: 'old', name: 'Zulu' },
    ])
    repository.close()
  })

  it('deletes a stored shader', async () => {
    const repository = createRepository()
    await repository.save(createShader())

    await repository.delete('shader-id')

    await expect(repository.get('shader-id')).resolves.toBeUndefined()
    await expect(repository.list()).resolves.toEqual([])
    repository.close()
  })

  it('wraps a synchronous transaction setup exception in StorageError', async () => {
    const repository = createRepository()
    await repository.save(createShader())
    repository.close()

    await expect(repository.save(createShader())).rejects.toMatchObject({
      name: 'StorageError',
      message: 'save shader: IndexedDB transaction setup failed',
    } satisfies Partial<StorageError>)
  })

  it('preserves a captured Blob portrait', async () => {
    const browserBlob = globalThis.Blob
    const nodeBufferModule = ['node', 'buffer'].join(':')
    const { Blob: nodeBlob } = await import(nodeBufferModule) as { Blob: typeof Blob }
    globalThis.Blob = nodeBlob
    const repository = createRepository()
    try {
      const portrait = new Blob(['portrait data'], { type: 'image/png' })
      await repository.save(createShader({ portrait: { kind: 'captured', blob: portrait, mimeType: 'image/png', width: 120, height: 80 } }))

      const stored = await repository.get('shader-id')

      expect(stored?.portrait).toMatchObject({ kind: 'captured', mimeType: 'image/png', width: 120, height: 80 })
      expect(stored?.portrait?.kind === 'captured' && await stored.portrait.blob.text()).toBe('portrait data')
      repository.close()
    } finally {
      globalThis.Blob = browserBlob
    }
  })

  it('isolates records by injected database name', async () => {
    const first = createRepository('first-database')
    const second = createRepository('second-database')
    await first.save(createShader())

    await expect(second.list()).resolves.toEqual([])
    first.close()
    second.close()
  })

  it('migrates a raw v1 record when it is read', async () => {
    const name = `shader-repository-${databaseNumber++}`
    await writeRawV1Record(name, {
      ...createShader(),
      parameters: [{ id: 'tint', type: 'color', uniformName: 'uTint', label: 'Tint', defaultValue: '#AABBCC' }],
      parameterValues: { tint: '#DDEEFF' },
    })
    const repository = createRepository(name)

    await expect(repository.get('shader-id')).resolves.toMatchObject({
      schemaVersion: 1,
      parameters: [{ defaultValue: '#aabbcc' }],
      parameterValues: { tint: '#ddeeff' },
    })
    repository.close()
  })
})
