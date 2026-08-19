import {
  Color,
  EquirectangularReflectionMapping,
  Euler,
  FloatType,
  Matrix3,
  Matrix4,
  Scene,
  Texture,
  Vector3,
  WebGLRenderTarget,
  type WebGLRenderer,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import { EnvironmentLoadError, type EnvironmentDisplaySettings } from '../domain/environment'
import {
  createRemoteHdrLoader,
  EnvironmentService,
  type EnvironmentServiceDependencies,
} from './EnvironmentService'

interface Deferred<T> {
  promise: Promise<T>
  resolve(value: T): void
  reject(reason: unknown): void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

interface TextureFixture {
  texture: Texture
  dispose: ReturnType<typeof vi.spyOn>
}

interface TargetFixture {
  target: WebGLRenderTarget
  dispose: ReturnType<typeof vi.spyOn>
}

function textureFixture(): TextureFixture {
  const texture = new Texture()
  return { texture, dispose: vi.spyOn(texture, 'dispose') }
}

function targetFixture(): TargetFixture {
  const target = new WebGLRenderTarget(1, 1)
  return { target, dispose: vi.spyOn(target, 'dispose') }
}

function settings(overrides: Partial<EnvironmentDisplaySettings> = {}): EnvironmentDisplaySettings {
  return {
    backgroundMode: 'skybox',
    clearColor: '#17191d',
    rotation: 0,
    intensity: 1,
    ...overrides,
  }
}

function serviceFixture(
  scene: Scene,
  overrides: Partial<EnvironmentServiceDependencies> = {},
): EnvironmentService {
  const dependencies: EnvironmentServiceDependencies = {
    loadHdr: async () => {
      throw new Error('Unexpected HDR load')
    },
    createPmrem: () => {
      throw new Error('Unexpected PMREM generation')
    },
    createObjectURL: vi.fn(() => 'blob:environment'),
    revokeObjectURL: vi.fn(),
    ...overrides,
  }
  return new EnvironmentService({} as WebGLRenderer, scene, dependencies)
}

describe('EnvironmentService', () => {
  it('installs one decoded skybox and its PMREM lighting map atomically', async () => {
    const scene = new Scene()
    const source = textureFixture()
    const pmrem = targetFixture()
    const service = serviceFixture(scene, {
      loadHdr: async () => source.texture,
      createPmrem: () => pmrem.target,
    })

    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })

    expect(source.texture.mapping).toBe(EquirectangularReflectionMapping)
    expect(scene.background).toBe(source.texture)
    expect(scene.environment).toBe(pmrem.target.texture)
    expect(service.binding.environmentMap.value).toBe(pmrem.target.texture)
    expect(source.dispose).not.toHaveBeenCalled()
    expect(pmrem.dispose).not.toHaveBeenCalled()
  })

  it('preserves the active environment when a later HDR load fails', async () => {
    const scene = new Scene()
    const source = textureFixture()
    const pmrem = targetFixture()
    const failure = new Error('CORS denied')
    const loadHdr = vi.fn()
      .mockResolvedValueOnce(source.texture)
      .mockRejectedValueOnce(failure)
    const service = serviceFixture(scene, {
      loadHdr,
      createPmrem: () => pmrem.target,
    })
    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })

    const result = service.load({ kind: 'remote', url: 'https://bad.example/x.hdr' })

    await expect(result).rejects.toMatchObject({
      name: 'EnvironmentLoadError',
      message: 'Unable to load HDR environment',
      cause: failure,
    })
    expect(scene.background).toBe(source.texture)
    expect(scene.environment).toBe(pmrem.target.texture)
    expect(service.binding.environmentMap.value).toBe(pmrem.target.texture)
    expect(source.dispose).not.toHaveBeenCalled()
    expect(pmrem.dispose).not.toHaveBeenCalled()
  })

  it('disposes an already-stale decoded source without generating PMREM', async () => {
    const scene = new Scene()
    const firstLoad = deferred<Texture>()
    const secondLoad = deferred<Texture>()
    const firstSource = textureFixture()
    const secondSource = textureFixture()
    const secondPmrem = targetFixture()
    const loadHdr = vi.fn()
      .mockReturnValueOnce(firstLoad.promise)
      .mockReturnValueOnce(secondLoad.promise)
    const createPmrem = vi.fn(() => secondPmrem.target)
    const service = serviceFixture(scene, { loadHdr, createPmrem })

    const first = service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })
    const second = service.load({ kind: 'bundled', id: 'studio', url: 'studio.hdr' })
    secondLoad.resolve(secondSource.texture)
    await second
    firstLoad.resolve(firstSource.texture)
    await first

    expect(scene.background).toBe(secondSource.texture)
    expect(service.binding.environmentMap.value).toBe(secondPmrem.target.texture)
    expect(firstSource.dispose).toHaveBeenCalledTimes(1)
    expect(createPmrem).toHaveBeenCalledTimes(1)
    expect(createPmrem).toHaveBeenCalledWith(secondSource.texture)
    expect(secondSource.dispose).not.toHaveBeenCalled()
    expect(secondPmrem.dispose).not.toHaveBeenCalled()
  })

  it('disposes a PMREM target when generation is superseded re-entrantly during filtering', async () => {
    const scene = new Scene()
    const firstSource = textureFixture()
    const secondSource = textureFixture()
    const firstPmrem = targetFixture()
    const secondPmrem = targetFixture()
    const loadHdr = vi.fn()
      .mockResolvedValueOnce(firstSource.texture)
      .mockResolvedValueOnce(secondSource.texture)
    let replacement: Promise<void> | undefined
    const createPmrem = vi.fn((texture: Texture) => {
      if (texture === firstSource.texture) {
        replacement = service.load({ kind: 'bundled', id: 'studio', url: 'studio.hdr' })
        return firstPmrem.target
      }
      return secondPmrem.target
    })
    const service = serviceFixture(scene, { loadHdr, createPmrem })

    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })
    await replacement

    expect(firstSource.dispose).toHaveBeenCalledTimes(1)
    expect(firstPmrem.dispose).toHaveBeenCalledTimes(1)
    expect(secondSource.dispose).not.toHaveBeenCalled()
    expect(secondPmrem.dispose).not.toHaveBeenCalled()
    expect(scene.background).toBe(secondSource.texture)
    expect(service.binding.environmentMap.value).toBe(secondPmrem.target.texture)
  })

  it('disposes the predecessor only after a successful replacement is installed', async () => {
    const scene = new Scene()
    const firstSource = textureFixture()
    const secondSource = textureFixture()
    const firstPmrem = targetFixture()
    const secondPmrem = targetFixture()
    const loadHdr = vi.fn()
      .mockResolvedValueOnce(firstSource.texture)
      .mockResolvedValueOnce(secondSource.texture)
    const createPmrem = vi.fn((texture: Texture) => (
      texture === firstSource.texture ? firstPmrem.target : secondPmrem.target
    ))
    const service = serviceFixture(scene, { loadHdr, createPmrem })
    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })
    firstSource.dispose.mockImplementation(() => {
      expect(scene.background).toBe(secondSource.texture)
      expect(scene.environment).toBe(secondPmrem.target.texture)
      expect(service.binding.environmentMap.value).toBe(secondPmrem.target.texture)
    })
    firstPmrem.dispose.mockImplementation(() => {
      expect(scene.background).toBe(secondSource.texture)
      expect(scene.environment).toBe(secondPmrem.target.texture)
      expect(service.binding.environmentMap.value).toBe(secondPmrem.target.texture)
    })

    await service.load({ kind: 'bundled', id: 'studio', url: 'studio.hdr' })

    expect(scene.background).toBe(secondSource.texture)
    expect(service.binding.environmentMap.value).toBe(secondPmrem.target.texture)
    expect(firstSource.dispose).toHaveBeenCalledTimes(1)
    expect(firstPmrem.dispose).toHaveBeenCalledTimes(1)
    expect(secondSource.dispose).not.toHaveBeenCalled()
    expect(secondPmrem.dispose).not.toHaveBeenCalled()
  })

  it('keeps a committed replacement active when predecessor disposal reenters and throws', async () => {
    const scene = new Scene()
    const firstSource = textureFixture()
    const secondSource = textureFixture()
    const firstPmrem = targetFixture()
    const secondPmrem = targetFixture()
    const loadHdr = vi.fn()
      .mockResolvedValueOnce(firstSource.texture)
      .mockResolvedValueOnce(secondSource.texture)
    const createPmrem = vi.fn((texture: Texture) => (
      texture === firstSource.texture ? firstPmrem.target : secondPmrem.target
    ))
    const service = serviceFixture(scene, { loadHdr, createPmrem })
    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })
    const retirementSnapshots: boolean[] = []
    firstSource.texture.addEventListener('dispose', () => {
      retirementSnapshots.push(
        scene.background === secondSource.texture
        && scene.environment === secondPmrem.target.texture
        && service.binding.environmentMap.value === secondPmrem.target.texture,
      )
      service.update(settings({ intensity: 2 }))
      throw new Error('source retirement listener failed')
    })
    firstPmrem.target.addEventListener('dispose', () => {
      retirementSnapshots.push(
        scene.background === secondSource.texture
        && scene.environment === secondPmrem.target.texture
        && service.binding.environmentMap.value === secondPmrem.target.texture,
      )
      service.update(settings({ rotation: 45, intensity: 3 }))
      throw new Error('PMREM retirement listener failed')
    })

    await expect(service.load({ kind: 'bundled', id: 'studio', url: 'studio.hdr' }))
      .resolves.toBeUndefined()

    expect(retirementSnapshots).toEqual([true, true])
    expect(firstSource.dispose).toHaveBeenCalledTimes(1)
    expect(firstPmrem.dispose).toHaveBeenCalledTimes(1)
    expect(secondSource.dispose).not.toHaveBeenCalled()
    expect(secondPmrem.dispose).not.toHaveBeenCalled()
    expect(scene.background).toBe(secondSource.texture)
    expect(scene.environment).toBe(secondPmrem.target.texture)
    expect(service.binding.environmentMap.value).toBe(secondPmrem.target.texture)
    expect(service.binding.environmentIntensity.value).toBe(3)
  })

  it('revokes a local object URL exactly once after successful decode', async () => {
    const scene = new Scene()
    const source = textureFixture()
    const pmrem = targetFixture()
    const createObjectURL = vi.fn(() => 'blob:local-hdr')
    const revokeObjectURL = vi.fn()
    const loadHdr = vi.fn(async () => source.texture)
    const service = serviceFixture(scene, {
      loadHdr,
      createPmrem: () => pmrem.target,
      createObjectURL,
      revokeObjectURL,
    })
    const file = new File(['hdr'], 'studio.hdr')

    await service.load({ kind: 'local', file })

    expect(createObjectURL).toHaveBeenCalledWith(file)
    expect(loadHdr).toHaveBeenCalledWith('blob:local-hdr')
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:local-hdr')
  })

  it('revokes a superseded local object URL on cancellation and does not revoke it again', async () => {
    const scene = new Scene()
    const localLoad = deferred<Texture>()
    const localSource = textureFixture()
    const remoteSource = textureFixture()
    const remotePmrem = targetFixture()
    const revokeObjectURL = vi.fn()
    const loadHdr = vi.fn()
      .mockReturnValueOnce(localLoad.promise)
      .mockResolvedValueOnce(remoteSource.texture)
    const createPmrem = vi.fn(() => remotePmrem.target)
    const service = serviceFixture(scene, {
      loadHdr,
      createPmrem,
      createObjectURL: () => 'blob:pending-hdr',
      revokeObjectURL,
    })

    const local = service.load({ kind: 'local', file: new File(['hdr'], 'city.hdr') })
    const remote = service.load({ kind: 'remote', url: 'https://example.com/studio.hdr' })

    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    await remote
    localLoad.resolve(localSource.texture)
    await local
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(localSource.dispose).toHaveBeenCalledTimes(1)
    expect(createPmrem).toHaveBeenCalledTimes(1)
    expect(createPmrem).toHaveBeenCalledWith(remoteSource.texture)
  })

  it('revokes a local object URL exactly once when HDR decode fails', async () => {
    const scene = new Scene()
    const failure = new Error('Invalid HDR bytes')
    const revokeObjectURL = vi.fn()
    const service = serviceFixture(scene, {
      loadHdr: async () => {
        throw failure
      },
      createObjectURL: () => 'blob:invalid-hdr',
      revokeObjectURL,
    })

    const result = service.load({ kind: 'local', file: new File(['bad'], 'broken.hdr') })

    await expect(result).rejects.toMatchObject({
      name: 'EnvironmentLoadError',
      cause: failure,
    })
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:invalid-hdr')
    service.dispose()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('revokes a pending local object URL exactly once when the service is disposed', async () => {
    const scene = new Scene()
    const pending = deferred<Texture>()
    const source = textureFixture()
    const createPmrem = vi.fn(() => targetFixture().target)
    const revokeObjectURL = vi.fn()
    const service = serviceFixture(scene, {
      loadHdr: () => pending.promise,
      createPmrem,
      createObjectURL: () => 'blob:disposed-hdr',
      revokeObjectURL,
    })
    const load = service.load({ kind: 'local', file: new File(['hdr'], 'city.hdr') })

    service.dispose()
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledWith('blob:disposed-hdr')

    pending.resolve(source.texture)
    await load
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(source.dispose).toHaveBeenCalledTimes(1)
    expect(createPmrem).not.toHaveBeenCalled()
  })

  it('keeps PMREM lighting active in clear-color mode and updates stable settings objects', async () => {
    const scene = new Scene()
    const source = textureFixture()
    const pmrem = targetFixture()
    const service = serviceFixture(scene, {
      loadHdr: async () => source.texture,
      createPmrem: () => pmrem.target,
    })
    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })

    service.update(settings({
      backgroundMode: 'clear-color',
      clearColor: '#123456',
      rotation: 90,
      intensity: 2.5,
    }))

    expect(scene.background).toBeInstanceOf(Color)
    const clearColor = scene.background as Color
    expect(clearColor.getHexString()).toBe('123456')
    expect(scene.environment).toBe(pmrem.target.texture)
    expect(service.binding.environmentMap.value).toBe(pmrem.target.texture)
    expect(service.binding.environmentIntensity.value).toBe(2.5)
    expect(scene.backgroundIntensity).toBe(2.5)
    expect(scene.environmentIntensity).toBe(2.5)
    expect(scene.backgroundRotation.y).toBeCloseTo(Math.PI / 2)
    expect(scene.environmentRotation.y).toBeCloseTo(Math.PI / 2)
    const expectedPmremRotation = new Matrix3().setFromMatrix4(
      new Matrix4().makeRotationFromEuler(new Euler(0, -Math.PI / 2, 0)),
    )
    service.binding.environmentRotation.value.elements.forEach((element, index) => {
      expect(element).toBeCloseTo(expectedPmremRotation.elements[index]!)
    })
    const rotatedDirection = new Vector3(1, 0, 0)
      .applyMatrix3(service.binding.environmentRotation.value)
    expect(rotatedDirection.x).toBeCloseTo(0)
    expect(rotatedDirection.y).toBeCloseTo(0)
    expect(rotatedDirection.z).toBeCloseTo(1)

    service.update(settings({ backgroundMode: 'clear-color', clearColor: '#abcdef' }))
    expect(scene.background).toBe(clearColor)
    expect(clearColor.getHexString()).toBe('abcdef')
  })

  it('preserves binding and uniform container identities across settings and replacement', async () => {
    const scene = new Scene()
    const firstSource = textureFixture()
    const secondSource = textureFixture()
    const firstPmrem = targetFixture()
    const secondPmrem = targetFixture()
    const loadHdr = vi.fn()
      .mockResolvedValueOnce(firstSource.texture)
      .mockResolvedValueOnce(secondSource.texture)
    const createPmrem = vi.fn((texture: Texture) => (
      texture === firstSource.texture ? firstPmrem.target : secondPmrem.target
    ))
    const service = serviceFixture(scene, { loadHdr, createPmrem })
    const binding = service.binding
    const environmentMap = binding.environmentMap
    const environmentRotation = binding.environmentRotation
    const rotationMatrix = environmentRotation.value
    const environmentIntensity = binding.environmentIntensity

    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })
    service.update(settings({ rotation: 45, intensity: 2 }))
    await service.load({ kind: 'bundled', id: 'studio', url: 'studio.hdr' })

    expect(service.binding).toBe(binding)
    expect(service.binding.environmentMap).toBe(environmentMap)
    expect(service.binding.environmentRotation).toBe(environmentRotation)
    expect(service.binding.environmentRotation.value).toBe(rotationMatrix)
    expect(service.binding.environmentIntensity).toBe(environmentIntensity)
    expect(environmentMap.value).toBe(secondPmrem.target.texture)
    expect(environmentIntensity.value).toBe(2)
  })

  it('rolls back fully to the active predecessor when PMREM generation fails', async () => {
    const scene = new Scene()
    const activeSource = textureFixture()
    const failingSource = textureFixture()
    const activePmrem = targetFixture()
    const failure = new Error('PMREM failed')
    const loadHdr = vi.fn()
      .mockResolvedValueOnce(activeSource.texture)
      .mockResolvedValueOnce(failingSource.texture)
    const service = serviceFixture(scene, {
      loadHdr,
      createPmrem: (texture) => {
        if (texture === activeSource.texture) return activePmrem.target
        throw failure
      },
    })
    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })

    const result = service.load({ kind: 'bundled', id: 'studio', url: 'studio.hdr' })

    await expect(result).rejects.toEqual(new EnvironmentLoadError('Unable to load HDR environment', failure))
    expect(failingSource.dispose).toHaveBeenCalledTimes(1)
    expect(activeSource.dispose).not.toHaveBeenCalled()
    expect(activePmrem.dispose).not.toHaveBeenCalled()
    expect(scene.background).toBe(activeSource.texture)
    expect(scene.environment).toBe(activePmrem.target.texture)
    expect(service.binding.environmentMap.value).toBe(activePmrem.target.texture)
  })

  it('routes validated remote sources through the credentialless loader boundary', async () => {
    const scene = new Scene()
    const source = textureFixture()
    const pmrem = targetFixture()
    const loadHdr = vi.fn(async () => {
      throw new Error('Generic loader must not fetch remote URLs')
    })
    const loadRemoteHdr = vi.fn(async () => source.texture)
    const service = serviceFixture(scene, {
      loadHdr,
      loadRemoteHdr,
      createPmrem: () => pmrem.target,
    })

    await service.load({ kind: 'remote', url: 'https://example.com/studio.hdr' })

    expect(loadRemoteHdr).toHaveBeenCalledWith('https://example.com/studio.hdr')
    expect(loadHdr).not.toHaveBeenCalled()
    expect(scene.background).toBe(source.texture)
    expect(service.binding.environmentMap.value).toBe(pmrem.target.texture)
  })

  it('rejects insecure remote URLs as typed load failures without decoding them', async () => {
    const scene = new Scene()
    const loadHdr = vi.fn(async () => new Texture())
    const service = serviceFixture(scene, { loadHdr })

    const result = service.load({ kind: 'remote', url: 'http://example.com/city.hdr' })

    await expect(result).rejects.toBeInstanceOf(EnvironmentLoadError)
    await expect(result).rejects.toThrow('Unable to load HDR environment')
    expect(loadHdr).not.toHaveBeenCalled()
  })

  it('disposes owned active resources once and ignores later updates', async () => {
    const scene = new Scene()
    const source = textureFixture()
    const pmrem = targetFixture()
    const service = serviceFixture(scene, {
      loadHdr: async () => source.texture,
      createPmrem: () => pmrem.target,
    })
    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })

    service.dispose()
    service.dispose()
    service.update(settings({ backgroundMode: 'skybox', intensity: 3 }))

    expect(source.dispose).toHaveBeenCalledTimes(1)
    expect(pmrem.dispose).toHaveBeenCalledTimes(1)
    expect(service.binding.environmentMap.value).toBeNull()
    expect(scene.environment).toBeNull()
    expect(scene.background).toBeInstanceOf(Color)
  })

  it('clears terminal state before callbacks and attempts every cleanup once despite reentry and throws', async () => {
    const scene = new Scene()
    const source = textureFixture()
    const pmrem = targetFixture()
    const pendingSource = textureFixture()
    const pendingLoad = deferred<Texture>()
    const revokeSnapshots: boolean[] = []
    const sourceSnapshots: boolean[] = []
    const pmremSnapshots: boolean[] = []
    const generatorSnapshots: boolean[] = []
    const revokeObjectURL = vi.fn(() => {
      revokeSnapshots.push(
        service.binding.environmentMap.value === null
        && scene.environment === null
        && scene.background !== source.texture,
      )
      service.dispose()
      throw new Error('URL revoke callback failed')
    })
    const disposePmremGenerator = vi.fn(() => {
      generatorSnapshots.push(
        service.binding.environmentMap.value === null
        && scene.environment === null
        && scene.background !== source.texture,
      )
      service.dispose()
      throw new Error('generator dispose callback failed')
    })
    const loadHdr = vi.fn()
      .mockResolvedValueOnce(source.texture)
      .mockReturnValueOnce(pendingLoad.promise)
    const service = serviceFixture(scene, {
      loadHdr,
      createPmrem: () => pmrem.target,
      createObjectURL: () => 'blob:pending-terminal-hdr',
      revokeObjectURL,
      disposePmremGenerator,
    })
    await service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })
    const pending = service.load({
      kind: 'local',
      file: new File(['hdr'], 'pending-terminal.hdr'),
    })
    source.texture.addEventListener('dispose', () => {
      sourceSnapshots.push(
        service.binding.environmentMap.value === null
        && scene.environment === null
        && scene.background !== source.texture,
      )
      service.dispose()
      throw new Error('source dispose listener failed')
    })
    pmrem.target.addEventListener('dispose', () => {
      pmremSnapshots.push(
        service.binding.environmentMap.value === null
        && scene.environment === null
        && scene.background !== source.texture,
      )
      service.dispose()
      throw new Error('PMREM dispose listener failed')
    })

    expect(() => service.dispose()).not.toThrow()
    expect(() => service.dispose()).not.toThrow()

    expect(sourceSnapshots).toEqual([true])
    expect(pmremSnapshots).toEqual([true])
    expect(generatorSnapshots).toEqual([true])
    expect(revokeSnapshots).toEqual([true])
    expect(source.dispose).toHaveBeenCalledTimes(1)
    expect(pmrem.dispose).toHaveBeenCalledTimes(1)
    expect(disposePmremGenerator).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
    expect(service.binding.environmentMap.value).toBeNull()
    expect(scene.environment).toBeNull()
    expect(scene.background).toBeInstanceOf(Color)

    pendingLoad.resolve(pendingSource.texture)
    await pending
    expect(pendingSource.dispose).toHaveBeenCalledTimes(1)
    expect(revokeObjectURL).toHaveBeenCalledTimes(1)
  })

  it('does not generate PMREM after disposal while HDR decoding is pending', async () => {
    const scene = new Scene()
    const pending = deferred<Texture>()
    const source = textureFixture()
    const createPmrem = vi.fn(() => targetFixture().target)
    const service = serviceFixture(scene, {
      loadHdr: () => pending.promise,
      createPmrem,
    })
    const load = service.load({ kind: 'bundled', id: 'city', url: 'city.hdr' })

    service.dispose()
    pending.resolve(source.texture)
    await load

    expect(createPmrem).not.toHaveBeenCalled()
    expect(source.dispose).toHaveBeenCalledTimes(1)
    expect(service.binding.environmentMap.value).toBeNull()
    expect(scene.environment).toBeNull()
  })
})

describe('createRemoteHdrLoader', () => {
  it('fetches remote HDR bytes without ambient credentials before parsing', async () => {
    const bytes = new ArrayBuffer(8)
    const fetchRemote = vi.fn(async () => ({
      ok: true,
      status: 200,
      statusText: 'OK',
      arrayBuffer: async () => bytes,
    } as Response))
    const pixels = new Float32Array([1, 2, 3, 4])
    const parser = {
      parse: vi.fn(() => ({
        width: 1,
        height: 1,
        data: pixels,
        header: '#?RADIANCE',
        gamma: 1,
        exposure: 1,
        type: FloatType,
      })),
    }

    const texture = await createRemoteHdrLoader(parser, fetchRemote)('https://example.com/studio.hdr')

    expect(fetchRemote).toHaveBeenCalledWith(
      'https://example.com/studio.hdr',
      { credentials: 'omit' },
    )
    expect(parser.parse).toHaveBeenCalledWith(bytes)
    expect(texture.image).toMatchObject({ width: 1, height: 1, data: pixels })
    expect(texture.type).toBe(FloatType)
    expect(texture.generateMipmaps).toBe(false)
    expect(texture.flipY).toBe(true)
  })

  it('rejects an HTTP error without attempting to parse its response body', async () => {
    const fetchRemote = vi.fn(async () => ({
      ok: false,
      status: 403,
      statusText: 'Forbidden',
      arrayBuffer: vi.fn(),
    } as unknown as Response))
    const parser = { parse: vi.fn() }

    const result = createRemoteHdrLoader(parser, fetchRemote)('https://example.com/private.hdr')

    await expect(result).rejects.toThrow('HTTP 403 Forbidden')
    expect(parser.parse).not.toHaveBeenCalled()
  })
})
