import {
  Color,
  DataTexture,
  EquirectangularReflectionMapping,
  LinearFilter,
  LinearSRGBColorSpace,
  Matrix3,
  PMREMGenerator,
  type Scene,
  type Texture,
  type WebGLRenderer,
  type WebGLRenderTarget,
} from 'three'
import { RGBELoader } from 'three/addons/loaders/RGBELoader.js'
import {
  DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS,
  EnvironmentLoadError,
  validateRemoteEnvironmentUrl,
  type EnvironmentDisplaySettings,
  type EnvironmentLoadSource,
} from '../domain/environment'
import type { EnvironmentBinding } from './materialBindings/types'

const HDR_LOAD_ERROR_MESSAGE = 'Unable to load HDR environment'

interface ActiveEnvironment {
  sourceTexture: Texture
  pmremTarget: WebGLRenderTarget
}

interface ObjectUrlLease {
  url: string
  revoked: boolean
}

export interface EnvironmentServiceDependencies {
  loadHdr(url: string): Promise<Texture>
  loadRemoteHdr?(url: string): Promise<Texture>
  createPmrem(texture: Texture): WebGLRenderTarget
  createObjectURL(file: File): string
  revokeObjectURL(url: string): void
}

interface ProductionDependencies {
  dependencies: EnvironmentServiceDependencies
  dispose(): void
}

/** Owns HDR source textures and PMREM targets independently from model resources. */
export class EnvironmentService {
  readonly binding: EnvironmentBinding = {
    environmentMap: { value: null },
    environmentRotation: { value: new Matrix3() },
    environmentIntensity: { value: DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS.intensity },
  }

  private readonly dependencies: EnvironmentServiceDependencies
  private readonly disposeDependencies: () => void
  private readonly clearColor = new Color(DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS.clearColor)
  private readonly objectUrlLeases = new Set<ObjectUrlLease>()
  private settings: EnvironmentDisplaySettings = { ...DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS }
  private active?: ActiveEnvironment
  private generation = 0
  private disposed = false

  constructor(
    renderer: WebGLRenderer,
    private readonly scene: Scene,
    dependencies?: EnvironmentServiceDependencies,
  ) {
    if (dependencies !== undefined) {
      this.dependencies = dependencies
      this.disposeDependencies = () => undefined
      return
    }

    const production = createProductionDependencies(renderer)
    this.dependencies = production.dependencies
    this.disposeDependencies = production.dispose
  }

  async load(source: EnvironmentLoadSource): Promise<void> {
    const generation = ++this.generation
    this.revokePendingObjectUrls()

    let sourceTexture: Texture | undefined
    let pmremTarget: WebGLRenderTarget | undefined
    let objectUrlLease: ObjectUrlLease | undefined
    try {
      if (this.disposed) throw new Error('Environment service is disposed')

      const resolved = this.resolveSourceUrl(source)
      objectUrlLease = resolved.objectUrlLease
      const loadHdr = source.kind === 'remote'
        ? this.dependencies.loadRemoteHdr ?? this.dependencies.loadHdr
        : this.dependencies.loadHdr
      sourceTexture = await loadHdr(resolved.url)
      sourceTexture.mapping = EquirectangularReflectionMapping
      if (this.disposed || generation !== this.generation) {
        sourceTexture.dispose()
        return
      }
      pmremTarget = this.dependencies.createPmrem(sourceTexture)

      if (this.disposed || generation !== this.generation) {
        sourceTexture.dispose()
        pmremTarget.dispose()
        return
      }

      const previous = this.active
      this.active = { sourceTexture, pmremTarget }
      this.binding.environmentMap.value = pmremTarget.texture
      this.scene.environment = pmremTarget.texture
      this.applyDisplaySettings()
      previous?.sourceTexture.dispose()
      previous?.pmremTarget.dispose()
    } catch (error) {
      pmremTarget?.dispose()
      sourceTexture?.dispose()
      throw new EnvironmentLoadError(HDR_LOAD_ERROR_MESSAGE, error)
    } finally {
      if (objectUrlLease !== undefined) this.revokeObjectUrl(objectUrlLease)
    }
  }

  update(settings: EnvironmentDisplaySettings): void {
    if (this.disposed) return
    this.settings = { ...settings }
    this.applyDisplaySettings()
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.revokePendingObjectUrls()

    const active = this.active
    this.active = undefined
    this.binding.environmentMap.value = null
    if (active !== undefined) {
      if (this.scene.background === active.sourceTexture) this.scene.background = this.clearColor
      if (this.scene.environment === active.pmremTarget.texture) this.scene.environment = null
      active.sourceTexture.dispose()
      active.pmremTarget.dispose()
    }
    this.disposeDependencies()
  }

  private resolveSourceUrl(source: EnvironmentLoadSource): {
    url: string
    objectUrlLease?: ObjectUrlLease
  } {
    if (source.kind === 'bundled') return { url: source.url }
    if (source.kind === 'remote') {
      const validation = validateRemoteEnvironmentUrl(source.url)
      if (!validation.valid) throw new Error(validation.message)
      return { url: source.url }
    }

    const lease: ObjectUrlLease = {
      url: this.dependencies.createObjectURL(source.file),
      revoked: false,
    }
    this.objectUrlLeases.add(lease)
    return { url: lease.url, objectUrlLease: lease }
  }

  private applyDisplaySettings(): void {
    const radians = this.settings.rotation * Math.PI / 180
    setYRotation(this.binding.environmentRotation.value, -radians)
    this.binding.environmentIntensity.value = this.settings.intensity

    this.scene.backgroundRotation.set(0, radians, 0)
    this.scene.environmentRotation.set(0, radians, 0)
    this.scene.backgroundIntensity = this.settings.intensity
    this.scene.environmentIntensity = this.settings.intensity

    this.clearColor.set(this.settings.clearColor)
    if (this.settings.backgroundMode === 'clear-color') {
      this.scene.background = this.clearColor
    } else if (this.active !== undefined) {
      this.scene.background = this.active.sourceTexture
    }
  }

  private revokePendingObjectUrls(): void {
    for (const lease of this.objectUrlLeases) this.revokeObjectUrl(lease)
  }

  private revokeObjectUrl(lease: ObjectUrlLease): void {
    if (lease.revoked) return
    lease.revoked = true
    this.objectUrlLeases.delete(lease)
    this.dependencies.revokeObjectURL(lease.url)
  }
}

function setYRotation(matrix: Matrix3, radians: number): void {
  const cosine = Math.cos(radians)
  const sine = Math.sin(radians)
  matrix.set(
    cosine, 0, sine,
    0, 1, 0,
    -sine, 0, cosine,
  )
}

function createProductionDependencies(renderer: WebGLRenderer): ProductionDependencies {
  const loader = new RGBELoader()
  const pmremGenerator = new PMREMGenerator(renderer)
  return {
    dependencies: {
      loadHdr: (url) => loader.loadAsync(url),
      loadRemoteHdr: createRemoteHdrLoader(loader),
      createPmrem: (texture) => pmremGenerator.fromEquirectangular(texture),
      createObjectURL: (file) => URL.createObjectURL(file),
      revokeObjectURL: (url) => URL.revokeObjectURL(url),
    },
    dispose: () => pmremGenerator.dispose(),
  }
}

type HdrParser = Pick<RGBELoader, 'parse'>
type RemoteFetch = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

/** @internal Production remote transport separated for credential-policy verification. */
export function createRemoteHdrLoader(
  parser: HdrParser,
  fetchRemote: RemoteFetch = globalThis.fetch,
): (url: string) => Promise<Texture> {
  return async (url) => {
    const response = await fetchRemote(url, { credentials: 'omit' })
    if (!response.ok) {
      throw new Error(`HTTP ${response.status} ${response.statusText}`.trim())
    }

    const parsed = parser.parse(await response.arrayBuffer())
    const texture = new DataTexture(parsed.data, parsed.width, parsed.height)
    texture.type = parsed.type
    texture.colorSpace = LinearSRGBColorSpace
    texture.minFilter = LinearFilter
    texture.magFilter = LinearFilter
    texture.generateMipmaps = false
    texture.flipY = true
    texture.needsUpdate = true
    return texture
  }
}
