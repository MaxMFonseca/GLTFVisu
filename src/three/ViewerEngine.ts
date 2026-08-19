import {
  Box3,
  Clock,
  Color,
  CubeUVReflectionMapping,
  DirectionalLight,
  HemisphereLight,
  Line,
  Mesh,
  PerspectiveCamera,
  Points,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type Material,
  type Object3D,
  type ShaderMaterial,
  type Texture,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { AnimationClipInfo, CompileDiagnostic, CompileResult, ModelInfo, ViewerPort } from '../application/ViewerPort'
import type { MaterialInputProfile } from '../domain/materialInput'
import type { ShaderParameterDefinition, ShaderParameterValue } from '../domain/parameters'
import type { ShaderDraft, ShaderPortrait } from '../domain/shader'
import {
  ENVIRONMENT_LOAD_ERROR_MESSAGE,
  EnvironmentLoadError,
  type EnvironmentDisplaySettings,
  type EnvironmentLoadSource,
} from '../domain/environment'
import { AnimationController } from './AnimationController'
import { calculateCameraFit, type CameraFit } from './cameraFit'
import { CaptureService, type CapturedImage } from './CaptureService'
import { disposeObjectTree } from './disposeObject'
import { EnvironmentService } from './EnvironmentService'
import { GltfAssetLoader, ModelLoadError } from './GltfAssetLoader'
import { isMaterialRenderable, MaterialOverride } from './MaterialOverride'
import { createGltfPbrBindingOwner, type EnvironmentShaderMaterial } from './materialBindings/GltfPbrBinding'
import { createGltfSurfaceBindingOwner } from './materialBindings/GltfSurfaceBinding'
import {
  createMaterialBindingOwner,
  type EnvironmentBinding,
  type MaterialBindingOwner,
  type MaterialVariantFactory,
} from './materialBindings/types'
import {
  ShaderCompiler,
  type PreparedRuntimeMaterial,
  type RuntimeMaterialPreparer,
  type ShaderValidationRenderer,
} from './ShaderCompiler'
import { getMaterialInputProfile } from './shaders/materialFactory'

export interface AnimationState {
  clips: readonly AnimationClipInfo[]
  selectedClipId?: string
  playing: boolean
}

export interface ViewerEngineEvents {
  onModelInfo?(info: ModelInfo): void
  onAnimationState?(state: AnimationState): void
}

export interface LoadedModel {
  scene: Object3D
  animations: readonly AnimationClip[]
}

export interface ModelLoaderPort {
  load(files: readonly File[], rootFile: File, signal?: AbortSignal): Promise<LoadedModel>
}

export interface ViewerRenderer extends ShaderValidationRenderer {
  domElement: HTMLCanvasElement
  dispose(): void
  getDrawingBufferSize(target: Vector2): Vector2
  setPixelRatio(value: number): void
  setSize(width: number, height: number, updateStyle?: boolean): void
}

export interface ViewerControls {
  target: Vector3
  update(deltaSeconds?: number): boolean | void
  saveState(): void
  dispose(): void
}

export interface ResizeObserverPort {
  observe(target: Element): void
  disconnect(): void
}

export interface ClockPort {
  elapsedTime: number
  getDelta(): number
}

export interface CompilerPort {
  readonly material: ShaderMaterial | undefined
  compile(draft: ShaderDraft, prepareRuntime?: RuntimeMaterialPreparer): Promise<CompileResult>
  validateRuntime?(prepareRuntime: RuntimeMaterialPreparer): CompileDiagnostic[]
  updateParameter(definition: ShaderParameterDefinition, value: ShaderParameterValue): void
  dispose(): void
}

export interface CapturePort {
  capture(): Promise<CapturedImage>
}

export interface EnvironmentPort {
  readonly binding: EnvironmentBinding
  load(source: EnvironmentLoadSource): Promise<void>
  update(settings: EnvironmentDisplaySettings): void
  dispose(): void
}

export interface AnimationPort {
  readonly clips: readonly AnimationClipInfo[]
  readonly selectedClipId?: string
  readonly playing: boolean
  select(name: string): void
  setPlaying(playing: boolean): void
  update(deltaSeconds: number): void
  dispose(): void
}

export interface ViewerEngineDependencies {
  createRenderer?: () => ViewerRenderer
  createControls?: (camera: PerspectiveCamera, canvas: HTMLCanvasElement) => ViewerControls
  createResizeObserver?: (callback: ResizeObserverCallback) => ResizeObserverPort
  createCompiler?: (renderer: ShaderValidationRenderer) => CompilerPort
  createEnvironment?: (renderer: WebGLRenderer, scene: Scene) => EnvironmentPort
  createVariantFactory?: (
    profile: MaterialInputProfile,
    binding: EnvironmentBinding,
  ) => MaterialVariantFactory
  createCapture?: (renderer: ViewerRenderer, scene: Scene, camera: PerspectiveCamera) => CapturePort
  createAnimation?: (root: Object3D, clips: readonly AnimationClip[]) => AnimationPort
  loader?: ModelLoaderPort
  clock?: ClockPort
  requestAnimationFrame?: (callback: FrameRequestCallback) => number
  cancelAnimationFrame?: (handle: number) => void
  devicePixelRatio?: number
}

export class ViewerInitializationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ViewerInitializationError'
  }
}

export class ShaderRuntimeValidationError extends Error {
  constructor(readonly diagnostics: readonly CompileDiagnostic[]) {
    super(`Shader runtime validation failed: ${diagnostics.map((diagnostic) => diagnostic.message).join(', ')}`)
    this.name = 'ShaderRuntimeValidationError'
  }
}

type MaterialAssignment = Material | Material[]
type ModelMaterialRenderable = Mesh | Line | Points
type ModelMaterialSnapshot = Map<ModelMaterialRenderable, MaterialAssignment>

interface ProfileMaterialRuntime {
  readonly profile: MaterialInputProfile
  readonly override: MaterialOverride
  readonly bindingOwner?: MaterialBindingOwner
}

interface PendingMaterialRuntime {
  readonly root: Object3D
  readonly materialRuntime: ProfileMaterialRuntime
  readonly compileGeneration: number
  isInvalidatable(): boolean
  disposeVariants(): void
  disposeOwner(): void
}

/** Imperative owner of the complete Three viewer lifecycle. */
export class ViewerEngine implements ViewerPort {
  private readonly scene = createViewerScene()
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 1000)
  private readonly renderer: ViewerRenderer
  private readonly controls: ViewerControls
  private readonly loader: ModelLoaderPort
  private readonly compiler: CompilerPort
  private readonly environment: EnvironmentPort
  private readonly capture: CapturePort
  private readonly clock: ClockPort
  private readonly observer: ResizeObserverPort
  private readonly requestFrame: (callback: FrameRequestCallback) => number
  private readonly cancelFrame: (handle: number) => void
  private readonly createAnimation: (root: Object3D, clips: readonly AnimationClip[]) => AnimationPort
  private readonly createVariantFactory?: ViewerEngineDependencies['createVariantFactory']
  private readonly drawingBufferSize = new Vector2()
  private readonly pendingMaterialRuntimes = new Set<PendingMaterialRuntime>()
  private readonly injectedVariantIdentities = new WeakSet<ShaderMaterial>()
  private frameHandle?: number
  private loadAbort?: AbortController
  private loadGeneration = 0
  private compileGeneration = 0
  private environmentGeneration = 0
  private modelRoot?: Object3D
  private modelMaterials?: ModelMaterialSnapshot
  private materialRuntime?: ProfileMaterialRuntime
  private animation?: AnimationPort
  private criticalMutation = false
  private disposalRequested = false
  private disposed = false

  constructor(
    private readonly host: HTMLElement,
    private readonly events: ViewerEngineEvents = {},
    dependencies: ViewerEngineDependencies = {},
  ) {
    this.renderer = dependencies.createRenderer?.() ?? createWebGl2Renderer()
    this.renderer.setPixelRatio(Math.min(2, Math.max(1, dependencies.devicePixelRatio ?? window.devicePixelRatio ?? 1)))
    const canvas = this.renderer.domElement
    canvas.style.display = 'block'
    canvas.style.width = '100%'
    canvas.style.height = '100%'
    host.appendChild(canvas)

    this.camera.position.set(2, 1.5, 3)
    this.controls = dependencies.createControls?.(this.camera, canvas) ?? new OrbitControls(this.camera, canvas)
    this.loader = dependencies.loader ?? new GltfAssetLoader()
    this.compiler = dependencies.createCompiler?.(this.renderer) ?? new ShaderCompiler(this.renderer)
    this.environment = dependencies.createEnvironment?.(this.renderer as WebGLRenderer, this.scene)
      ?? new EnvironmentService(this.renderer as WebGLRenderer, this.scene)
    this.createVariantFactory = dependencies.createVariantFactory
    this.capture = dependencies.createCapture?.(this.renderer, this.scene, this.camera)
      ?? new CaptureService(this.renderer, this.scene, this.camera)
    this.clock = dependencies.clock ?? new Clock()
    this.createAnimation = dependencies.createAnimation ?? ((root, clips) => new AnimationController(root, clips))
    this.requestFrame = dependencies.requestAnimationFrame ?? ((callback) => window.requestAnimationFrame(callback))
    this.cancelFrame = dependencies.cancelAnimationFrame ?? ((handle) => window.cancelAnimationFrame(handle))
    this.observer = dependencies.createResizeObserver?.(this.resize)
      ?? new ResizeObserver(this.resize)
    this.observer.observe(host)
    this.resize()
    this.frameHandle = this.requestFrame(this.frame)
  }

  async loadModel(files: File[], root: File): Promise<ModelInfo> {
    this.assertMutationAvailable()
    this.assertActive()
    const generation = ++this.loadGeneration
    this.loadAbort?.abort()
    const abort = new AbortController()
    this.loadAbort = abort

    try {
      const loaded = await this.loader.load(files, root, abort.signal)
      if (this.disposed || generation !== this.loadGeneration) {
        disposeObjectTree(loaded.scene)
        throw new ModelLoadError('aborted', 'Model loading was superseded')
      }
      const info = this.installModel(loaded, root.name)
      if (this.disposalRequested) {
        this.performDispose()
        throw new ModelLoadError('aborted', 'Model loading was interrupted by viewer disposal')
      }
      return info
    } finally {
      if (generation === this.loadGeneration) this.loadAbort = undefined
      this.flushDeferredDisposal()
    }
  }

  fitModel(): void {
    if (this.modelRoot === undefined || this.disposed) return
    applyCameraFit(this.camera, this.controls, fitFor(this.modelRoot, this.camera, this.controls.target))
  }

  async compileShader(draft: ShaderDraft): Promise<CompileResult> {
    if (this.criticalMutation) return mutationRejectedCompileResult(this.compileGeneration)
    this.assertActive()
    const generation = ++this.compileGeneration
    this.runCriticalMutation(() => this.disposePendingMaterialRuntimes())
    if (this.disposalRequested) {
      this.performDispose()
      return { status: 'error', generation, diagnostics: [] }
    }
    let result: CompileResult
    try {
      result = await this.compiler.compile(
        draft,
        (material) => this.prepareRuntimeMaterial(material, generation),
      )
    } finally {
      this.flushDeferredDisposal()
    }
    if (this.disposed) return { status: 'error', generation, diagnostics: [] }
    if (generation !== this.compileGeneration) return result
    return result
  }

  updateParameter(definition: ShaderParameterDefinition, value: ShaderParameterValue): void {
    if (!this.disposed) this.compiler.updateParameter(definition, value)
  }

  async loadEnvironment(source: EnvironmentLoadSource): Promise<void> {
    const generation = ++this.environmentGeneration
    try {
      this.assertActive()
      await this.environment.load(source)
    } catch (error) {
      throw new EnvironmentLoadError(ENVIRONMENT_LOAD_ERROR_MESSAGE, error)
    }
    if (this.disposed || generation !== this.environmentGeneration) return
    this.refreshPbrEnvironmentMaps()
  }

  updateEnvironment(settings: EnvironmentDisplaySettings): void {
    if (!this.disposed) this.environment.update(settings)
  }

  async capturePortrait(): Promise<ShaderPortrait> {
    this.assertActive()
    const captured = await this.capture.capture()
    return { kind: 'captured', ...captured }
  }

  selectAnimation(name: string): void {
    if (this.disposed || this.animation === undefined) return
    this.animation.select(name)
    this.emitAnimationState()
  }

  setAnimationPlaying(playing: boolean): void {
    if (this.disposed || this.animation === undefined) return
    this.animation.setPlaying(playing)
    this.emitAnimationState()
  }

  dispose(): void {
    if (this.disposed || this.disposalRequested) return
    if (this.criticalMutation) {
      this.disposalRequested = true
      return
    }
    this.performDispose()
  }

  private performDispose(): void {
    if (this.disposed) return
    this.disposalRequested = false
    this.disposed = true
    this.loadGeneration += 1
    this.compileGeneration += 1
    this.environmentGeneration += 1
    const loadAbort = this.loadAbort
    this.loadAbort = undefined
    const frameHandle = this.frameHandle
    this.frameHandle = undefined
    runBestEffortCleanup([
      () => loadAbort?.abort(),
      () => { if (frameHandle !== undefined) this.cancelFrame(frameHandle) },
      () => this.observer.disconnect(),
      () => this.controls.dispose(),
      () => this.disposePendingMaterialRuntimes(),
      () => this.disposeModel(),
      () => this.compiler.dispose(),
      () => this.environment.dispose(),
      () => this.renderer.dispose(),
      () => this.renderer.domElement.remove(),
    ])
  }

  readonly resize = (): void => {
    if (this.disposed) return
    const width = Math.max(1, Math.floor(this.host.clientWidth))
    const height = Math.max(1, Math.floor(this.host.clientHeight))
    this.renderer.setSize(width, height, false)
    this.camera.aspect = width / height
    this.camera.updateProjectionMatrix()
  }

  private readonly frame: FrameRequestCallback = () => {
    if (this.disposed) return
    const delta = this.clock.getDelta()
    this.controls.update(delta)
    this.animation?.update(delta)
    this.updateFrameUniforms()
    this.renderer.render(this.scene, this.camera)
    if (!this.disposed) this.frameHandle = this.requestFrame(this.frame)
  }

  private updateFrameUniforms(): void {
    const uniforms = this.compiler.material?.uniforms
    if (uniforms === undefined) return
    if (uniforms.uTime !== undefined) uniforms.uTime.value = this.clock.elapsedTime
    this.renderer.getDrawingBufferSize(this.drawingBufferSize)
    const resolution = uniforms.uResolution?.value
    if (resolution instanceof Vector2) resolution.copy(this.drawingBufferSize)
    const cameraPosition = uniforms.uCameraPosition?.value
    if (cameraPosition instanceof Vector3) cameraPosition.copy(this.camera.position)
  }

  private prepareRuntimeMaterial(
    material: ShaderMaterial,
    compileGeneration: number,
  ): PreparedRuntimeMaterial | undefined {
    const current = this.materialRuntime
    const root = this.modelRoot
    if (current === undefined || root === undefined) return undefined
    if (this.disposed || compileGeneration !== this.compileGeneration) {
      throw new Error('Material runtime transaction is stale')
    }
    this.assertMutationAvailable()

    const profile = getMaterialInputProfile(material)
    if (profile === current.profile) {
      const prepared = current.override.prepare(material)
      return this.trackPendingMaterialRuntime({
        validate: (validateRender) => prepared.run(
          () => validateRender(() => this.renderer.render(this.scene, this.camera)),
        ),
        commit: () => prepared.commit(),
        dispose: () => prepared.dispose(),
      }, root, current, compileGeneration)
    }

    const replacement = this.createProfileMaterialRuntime(
      root,
      profile,
      this.modelMaterials,
    )
    let prepared: ReturnType<MaterialOverride['prepare']>
    try {
      prepared = replacement.override.prepare(material)
    } catch (error) {
      replacement.bindingOwner?.dispose()
      throw error
    }

    return this.trackPendingMaterialRuntime({
      validate: (validateRender) => prepared.run(
        () => validateRender(() => this.renderer.render(this.scene, this.camera)),
      ),
      commit: () => {
        prepared.commit()
        current.override.dispose({ restoreAssignments: false })
        this.materialRuntime = replacement
        runBestEffortCleanup([() => current.bindingOwner?.dispose()])
      },
      dispose: () => prepared.dispose(),
    }, root, current, compileGeneration, () => replacement.bindingOwner?.dispose())
  }

  private installModel(loaded: LoadedModel, name: string): ModelInfo {
    return this.runCriticalMutation(() => this.commitModel(loaded, name))
  }

  private commitModel(loaded: LoadedModel, name: string): ModelInfo {
    const prepared = (() => {
      let runtime: ProfileMaterialRuntime | undefined
      let animation: AnimationPort | undefined
      try {
        const profile = this.compiler.material === undefined
          ? 'none'
          : getMaterialInputProfile(this.compiler.material)
        const materials = snapshotModelMaterials(loaded.scene)
        runtime = this.createProfileMaterialRuntime(loaded.scene, profile)
        if (this.compiler.material !== undefined) {
          if (this.compiler.validateRuntime === undefined) {
            runtime.override.apply(this.compiler.material)
          } else {
            const diagnostics = this.compiler.validateRuntime(
              createRuntimePreparer(runtime.override, () => this.renderCandidateModel(loaded.scene)),
            )
            if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
              throw new ShaderRuntimeValidationError(diagnostics)
            }
          }
        }
        animation = this.createAnimation(loaded.scene, loaded.animations)
        const fit = fitFor(loaded.scene, this.camera, this.controls.target)
        return { runtime, animation, fit, materials }
      } catch (error) {
        runtime?.override.dispose()
        animation?.dispose()
        runtime?.bindingOwner?.dispose()
        disposeObjectTree(loaded.scene)
        throw error
      }
    })()
    const {
      runtime: nextRuntime,
      animation: nextAnimation,
      fit,
      materials: nextMaterials,
    } = prepared

    const previousRoot = this.modelRoot
    const previousRuntime = this.materialRuntime
    const previousAnimation = this.animation
    const cameraState = snapshotCamera(this.camera, this.controls)

    try {
      applyCameraFit(this.camera, this.controls, fit)
    } catch (error) {
      restoreCamera(this.camera, this.controls, cameraState)
      disposePreparedModel(loaded.scene, nextRuntime, nextAnimation)
      throw error
    }

    try {
      this.scene.add(loaded.scene)
      if (previousRoot !== undefined) this.scene.remove(previousRoot)
    } catch (error) {
      if (loaded.scene.parent === this.scene) this.scene.remove(loaded.scene)
      if (previousRoot !== undefined && previousRoot.parent !== this.scene) this.scene.add(previousRoot)
      restoreCamera(this.camera, this.controls, cameraState)
      disposePreparedModel(loaded.scene, nextRuntime, nextAnimation)
      throw error
    }

    this.disposePendingMaterialRuntimes()
    this.modelRoot = loaded.scene
    this.modelMaterials = nextMaterials
    this.materialRuntime = nextRuntime
    this.animation = nextAnimation

    if (previousRoot !== undefined) {
      runBestEffortCleanup([
        () => previousRuntime?.override.dispose(),
        () => previousAnimation?.dispose(),
        () => previousRuntime?.bindingOwner?.dispose(),
        () => disposeObjectTree(previousRoot),
      ])
    }

    const info: ModelInfo = {
      name,
      meshCount: countMaterialRenderables(loaded.scene),
      animationClips: nextAnimation.clips.map((clip) => ({ ...clip })),
    }
    notify(this.events.onModelInfo, info)
    this.emitAnimationState()
    return info
  }

  private emitAnimationState(): void {
    if (this.animation === undefined) return
    notify(this.events.onAnimationState, {
      clips: this.animation.clips.map((clip) => ({ ...clip })),
      selectedClipId: this.animation.selectedClipId,
      playing: this.animation.playing,
    })
  }

  private renderCandidateModel(root: Object3D): void {
    try {
      this.scene.add(root)
      this.renderer.render(this.scene, this.camera)
    } finally {
      if (root.parent === this.scene) this.scene.remove(root)
    }
  }

  private createProfileMaterialRuntime(
    root: Object3D,
    profile: MaterialInputProfile,
    originals?: ModelMaterialSnapshot,
  ): ProfileMaterialRuntime {
    let bindingOwner: MaterialBindingOwner | undefined
    try {
      bindingOwner = createProfileBindingOwner(profile, this.environment.binding, this.createVariantFactory)
      const createVariant = bindingOwner === undefined
        ? undefined
        : this.createVariantFactory === undefined
          ? bindingOwner.createVariant
          : registerInjectedMaterialVariants(bindingOwner.createVariant, this.injectedVariantIdentities)
      const createOverride = () => new MaterialOverride(root, createVariant)
      const override = originals === undefined
        ? createOverride()
        : withModelMaterials(originals, createOverride)
      return { profile, override, bindingOwner }
    } catch (error) {
      bindingOwner?.dispose()
      throw error
    }
  }

  private trackPendingMaterialRuntime(
    runtime: PreparedRuntimeMaterial,
    root: Object3D,
    materialRuntime: ProfileMaterialRuntime,
    compileGeneration: number,
    disposeOwner: () => void = () => undefined,
  ): PreparedRuntimeMaterial {
    let state: 'pending' | 'committing' | 'complete' = 'pending'
    let variantsDisposed = false
    let ownerDisposed = false
    const pending: PendingMaterialRuntime = {
      root,
      materialRuntime,
      compileGeneration,
      isInvalidatable: () => state === 'pending',
      disposeVariants: () => {
        if (state === 'complete' || variantsDisposed) return
        variantsDisposed = true
        runtime.dispose()
      },
      disposeOwner: () => {
        if (state === 'complete' || ownerDisposed) return
        ownerDisposed = true
        try {
          disposeOwner()
        } finally {
          if (variantsDisposed) this.pendingMaterialRuntimes.delete(pending)
        }
      },
    }
    this.pendingMaterialRuntimes.add(pending)
    const assertPending = () => {
      if (state !== 'pending' || variantsDisposed) {
        throw new Error('Material runtime transaction is complete')
      }
      if (
        this.disposed
        || this.compileGeneration !== compileGeneration
        || this.modelRoot !== root
        || this.materialRuntime !== materialRuntime
      ) {
        try {
          pending.disposeVariants()
        } finally {
          pending.disposeOwner()
        }
        throw new Error('Material runtime transaction is stale')
      }
    }

    return {
      validate: (validateRender) => {
        assertPending()
        return runtime.validate(validateRender)
      },
      commit: () => {
        assertPending()
        state = 'committing'
        let committed = false
        try {
          this.runCriticalMutation(() => {
            this.disposePendingMaterialRuntimes(pending)
            runtime.commit()
            committed = true
          })
        } finally {
          try {
            if (!committed) {
              try {
                pending.disposeVariants()
              } finally {
                pending.disposeOwner()
              }
            }
          } finally {
            state = 'complete'
            this.pendingMaterialRuntimes.delete(pending)
          }
        }
      },
      dispose: () => {
        try {
          pending.disposeVariants()
        } finally {
          pending.disposeOwner()
        }
      },
    }
  }

  private refreshPbrEnvironmentMaps(): void {
    const runtime = this.materialRuntime
    if (runtime?.profile !== 'gltf-pbr') return
    const nextMap = this.environment.binding.environmentMap.value
    for (const material of runtime.override.materials) {
      const environmentMaterial = material as EnvironmentShaderMaterial
      const previousMap = environmentMaterial.envMap ?? null
      environmentMaterial.envMap = nextMap
      if (environmentProgramChanged(previousMap, nextMap)) environmentMaterial.needsUpdate = true
    }
  }

  private disposePendingMaterialVariants(except?: PendingMaterialRuntime): void {
    let failed = false
    let failure: unknown
    for (const pending of [...this.pendingMaterialRuntimes]) {
      if (pending === except || !pending.isInvalidatable()) continue
      try {
        pending.disposeVariants()
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
    }
    if (failed) throw failure
  }

  private disposePendingMaterialOwners(except?: PendingMaterialRuntime): void {
    let failed = false
    let failure: unknown
    for (const pending of [...this.pendingMaterialRuntimes]) {
      if (pending === except || !pending.isInvalidatable()) continue
      try {
        pending.disposeOwner()
      } catch (error) {
        if (!failed) failure = error
        failed = true
      }
    }
    if (failed) throw failure
  }

  private disposePendingMaterialRuntimes(except?: PendingMaterialRuntime): void {
    runBestEffortCleanup([
      () => this.disposePendingMaterialVariants(except),
      () => this.disposePendingMaterialOwners(except),
    ])
  }

  private disposeModel(): void {
    const root = this.modelRoot
    const runtime = this.materialRuntime
    const animation = this.animation
    this.modelRoot = undefined
    this.modelMaterials = undefined
    this.materialRuntime = undefined
    this.animation = undefined
    if (root === undefined) return
    runBestEffortCleanup([
      () => this.scene.remove(root),
      () => runtime?.override.dispose(),
      () => animation?.dispose(),
      () => runtime?.bindingOwner?.dispose(),
      () => disposeObjectTree(root),
    ])
  }

  private assertActive(): void {
    if (this.disposed || this.disposalRequested) throw new Error('Viewer engine is disposed')
  }

  private assertMutationAvailable(): void {
    if (this.criticalMutation) throw new Error('Viewer mutation is in progress')
  }

  private runCriticalMutation<T>(operation: () => T): T {
    this.assertMutationAvailable()
    this.criticalMutation = true
    try {
      return operation()
    } finally {
      this.criticalMutation = false
    }
  }

  private flushDeferredDisposal(): void {
    if (this.disposalRequested && !this.criticalMutation) this.performDispose()
  }
}

function createViewerScene(): Scene {
  const scene = new Scene()
  scene.background = new Color(0x17191d)
  scene.add(new HemisphereLight(0xffffff, 0x30343d, 1.5))
  const key = new DirectionalLight(0xffffff, 2)
  key.position.set(3, 5, 4)
  scene.add(key)
  return scene
}

function createWebGl2Renderer(): ViewerRenderer {
  const canvas = document.createElement('canvas')
  const context = canvas.getContext('webgl2', { antialias: true, alpha: false })
  if (context === null) throw new ViewerInitializationError('WebGL2 is required for the shader viewer')
  return new WebGLRenderer({ canvas, context, antialias: true, alpha: false })
}

function fitFor(root: Object3D, camera: PerspectiveCamera, target: Vector3): CameraFit {
  root.updateWorldMatrix(true, true)
  let bounds = new Box3().setFromObject(root)
  if (bounds.isEmpty()) {
    const center = root.getWorldPosition(new Vector3())
    bounds = new Box3(center.clone().addScalar(-0.5), center.clone().addScalar(0.5))
  }
  const direction = camera.position.clone().sub(target)
  return calculateCameraFit(bounds, camera.fov, camera.aspect, direction, 0.2)
}

function applyCameraFit(camera: PerspectiveCamera, controls: ViewerControls, fit: CameraFit): void {
  camera.position.copy(fit.position)
  camera.near = fit.near
  camera.far = fit.far
  camera.updateProjectionMatrix()
  controls.target.copy(fit.target)
  controls.update(0)
  controls.saveState()
}

interface CameraState {
  position: Vector3
  quaternion: PerspectiveCamera['quaternion']
  target: Vector3
  near: number
  far: number
}

function snapshotCamera(camera: PerspectiveCamera, controls: ViewerControls): CameraState {
  return {
    position: camera.position.clone(),
    quaternion: camera.quaternion.clone(),
    target: controls.target.clone(),
    near: camera.near,
    far: camera.far,
  }
}

function restoreCamera(camera: PerspectiveCamera, controls: ViewerControls, state: CameraState): void {
  camera.position.copy(state.position)
  camera.quaternion.copy(state.quaternion)
  camera.near = state.near
  camera.far = state.far
  camera.updateProjectionMatrix()
  controls.target.copy(state.target)
}

function disposePreparedModel(
  root: Object3D,
  runtime: ProfileMaterialRuntime,
  animation: AnimationPort,
): void {
  runBestEffortCleanup([
    () => runtime.override.dispose(),
    () => animation.dispose(),
    () => runtime.bindingOwner?.dispose(),
    () => disposeObjectTree(root),
  ])
}

function runBestEffortCleanup(operations: readonly (() => void)[]): void {
  for (const operation of operations) {
    try {
      operation()
    } catch {
      // Cleanup callbacks cannot interrupt an ownership transition or terminal teardown.
    }
  }
}

function mutationRejectedCompileResult(generation: number): CompileResult {
  const message = 'Viewer mutation is in progress'
  return {
    status: 'error',
    generation,
    diagnostics: [{ severity: 'error', message, raw: message }],
  }
}

function notify<T>(callback: ((value: T) => void) | undefined, value: T): void {
  try {
    callback?.(value)
  } catch {
    // Notifications cannot participate in renderer/model ownership transactions.
  }
}

function createRuntimePreparer(override: MaterialOverride, render: () => void): RuntimeMaterialPreparer {
  return (material) => {
    const prepared = override.prepare(material)
    return {
      validate: (validateRender) => prepared.run(() => validateRender(render)),
      commit: () => prepared.commit(),
      dispose: () => prepared.dispose(),
    }
  }
}

function countMaterialRenderables(root: Object3D): number {
  let count = 0
  root.traverse((object) => {
    if (isMaterialRenderable(object)) count += 1
  })
  return count
}

function createProfileBindingOwner(
  profile: MaterialInputProfile,
  environment: EnvironmentBinding,
  createVariantFactory?: ViewerEngineDependencies['createVariantFactory'],
): MaterialBindingOwner | undefined {
  if (createVariantFactory !== undefined) {
    return createMaterialBindingOwner(createVariantFactory(profile, environment))
  }
  if (profile === 'gltf-surface') return createGltfSurfaceBindingOwner()
  if (profile === 'gltf-pbr') return createGltfPbrBindingOwner(environment)
  return undefined
}

function registerInjectedMaterialVariants(
  createVariant: MaterialVariantFactory,
  identities: WeakSet<ShaderMaterial>,
): MaterialVariantFactory {
  const guarded: MaterialVariantFactory = (original, template, context) => {
    const variant = createVariant(original, template, context)
    if (identities.has(variant)) {
      throw new Error('Material variant factory must return a fresh app-owned ShaderMaterial')
    }
    identities.add(variant)
    return variant
  }
  const getCacheKey = createVariant.getCacheKey
  if (getCacheKey !== undefined) {
    guarded.getCacheKey = (original, context) => getCacheKey(original, context)
  }
  return guarded
}

function snapshotModelMaterials(root: Object3D): ModelMaterialSnapshot {
  const materials: ModelMaterialSnapshot = new Map()
  root.traverse((object) => {
    if (isMaterialRenderable(object)) materials.set(object, object.material)
  })
  return materials
}

function withModelMaterials<T>(
  originals: ModelMaterialSnapshot,
  operation: () => T,
): T {
  const predecessors = new Map<ModelMaterialRenderable, MaterialAssignment>()
  for (const renderable of originals.keys()) predecessors.set(renderable, renderable.material)
  assignModelMaterials(originals)
  try {
    return operation()
  } finally {
    assignModelMaterials(predecessors)
  }
}

function assignModelMaterials(assignments: ModelMaterialSnapshot): void {
  const changed: Array<readonly [ModelMaterialRenderable, MaterialAssignment]> = []
  try {
    for (const [renderable, material] of assignments) {
      const previous = renderable.material
      renderable.material = material
      changed.push([renderable, previous])
    }
  } catch (error) {
    for (let index = changed.length - 1; index >= 0; index -= 1) {
      const [renderable, previous] = changed[index]
      renderable.material = previous
    }
    throw error
  }
}

function environmentProgramChanged(previous: Texture | null, next: Texture | null): boolean {
  if (previous === next) return false
  if (previous === null || next === null) return true
  if (previous.mapping !== next.mapping) return true
  if (next.mapping !== CubeUVReflectionMapping) return false
  return textureImageHeight(previous) !== textureImageHeight(next)
}

function textureImageHeight(texture: Texture): unknown {
  return (texture.image as { height?: unknown } | undefined)?.height
}
