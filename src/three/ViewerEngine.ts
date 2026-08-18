import {
  Box3,
  Clock,
  Color,
  DirectionalLight,
  HemisphereLight,
  PerspectiveCamera,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  type AnimationClip,
  type Object3D,
  type ShaderMaterial,
} from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import type { AnimationClipInfo, CompileDiagnostic, CompileResult, ModelInfo, ViewerPort } from '../application/ViewerPort'
import type { ShaderParameterDefinition, ShaderParameterValue } from '../domain/parameters'
import type { ShaderDraft, ShaderPortrait } from '../domain/shader'
import { EnvironmentLoadError, type EnvironmentDisplaySettings, type EnvironmentLoadSource } from '../domain/environment'
import { AnimationController } from './AnimationController'
import { calculateCameraFit, type CameraFit } from './cameraFit'
import { CaptureService, type CapturedImage } from './CaptureService'
import { disposeObjectTree } from './disposeObject'
import { GltfAssetLoader, ModelLoadError } from './GltfAssetLoader'
import { isMaterialRenderable, MaterialOverride } from './MaterialOverride'
import {
  ShaderCompiler,
  type PreparedRuntimeMaterial,
  type RuntimeMaterialPreparer,
  type ShaderValidationRenderer,
} from './ShaderCompiler'

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

/** Imperative owner of the complete Three viewer lifecycle. */
export class ViewerEngine implements ViewerPort {
  private readonly scene = createViewerScene()
  private readonly camera = new PerspectiveCamera(45, 1, 0.01, 1000)
  private readonly renderer: ViewerRenderer
  private readonly controls: ViewerControls
  private readonly loader: ModelLoaderPort
  private readonly compiler: CompilerPort
  private readonly capture: CapturePort
  private readonly clock: ClockPort
  private readonly observer: ResizeObserverPort
  private readonly requestFrame: (callback: FrameRequestCallback) => number
  private readonly cancelFrame: (handle: number) => void
  private readonly createAnimation: (root: Object3D, clips: readonly AnimationClip[]) => AnimationPort
  private readonly drawingBufferSize = new Vector2()
  private frameHandle?: number
  private loadAbort?: AbortController
  private loadGeneration = 0
  private compileGeneration = 0
  private modelRoot?: Object3D
  private materialOverride?: MaterialOverride
  private animation?: AnimationPort
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
      return this.installModel(loaded, root.name)
    } finally {
      if (generation === this.loadGeneration) this.loadAbort = undefined
    }
  }

  fitModel(): void {
    if (this.modelRoot === undefined || this.disposed) return
    applyCameraFit(this.camera, this.controls, fitFor(this.modelRoot, this.camera, this.controls.target))
  }

  async compileShader(draft: ShaderDraft): Promise<CompileResult> {
    this.assertActive()
    const generation = ++this.compileGeneration
    const result = await this.compiler.compile(draft, this.prepareRuntimeMaterial)
    if (this.disposed || generation !== this.compileGeneration) return result
    return result
  }

  updateParameter(definition: ShaderParameterDefinition, value: ShaderParameterValue): void {
    if (!this.disposed) this.compiler.updateParameter(definition, value)
  }

  async loadEnvironment(source: EnvironmentLoadSource): Promise<void> {
    this.assertActive()
    void source
    throw new EnvironmentLoadError()
  }

  updateEnvironment(settings: EnvironmentDisplaySettings): void {
    void settings
    // Environment resources are installed by the dedicated service in the next task.
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
    if (this.disposed) return
    this.disposed = true
    this.loadGeneration += 1
    this.compileGeneration += 1
    this.loadAbort?.abort()
    this.loadAbort = undefined
    if (this.frameHandle !== undefined) {
      this.cancelFrame(this.frameHandle)
      this.frameHandle = undefined
    }
    this.observer.disconnect()
    this.controls.dispose()
    this.disposeModel()
    this.compiler.dispose()
    this.renderer.dispose()
    this.renderer.domElement.remove()
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

  private readonly prepareRuntimeMaterial: RuntimeMaterialPreparer = (material) => {
    const override = this.materialOverride
    if (override === undefined) return undefined
    const prepared = override.prepare(material)
    const runtime: PreparedRuntimeMaterial = {
      validate: (validateRender) => prepared.run(
        () => validateRender(() => this.renderer.render(this.scene, this.camera)),
      ),
      commit: () => prepared.commit(),
      dispose: () => prepared.dispose(),
    }
    return runtime
  }

  private installModel(loaded: LoadedModel, name: string): ModelInfo {
    const nextOverride = new MaterialOverride(loaded.scene)
    let nextAnimation: AnimationPort | undefined
    let fit: CameraFit
    try {
      if (this.compiler.material !== undefined) {
        if (this.compiler.validateRuntime === undefined) {
          nextOverride.apply(this.compiler.material)
        } else {
          const diagnostics = this.compiler.validateRuntime(
            createRuntimePreparer(nextOverride, () => this.renderCandidateModel(loaded.scene)),
          )
          if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
            throw new ShaderRuntimeValidationError(diagnostics)
          }
        }
      }
      nextAnimation = this.createAnimation(loaded.scene, loaded.animations)
      fit = fitFor(loaded.scene, this.camera, this.controls.target)
    } catch (error) {
      nextAnimation?.dispose()
      nextOverride.dispose()
      disposeObjectTree(loaded.scene)
      throw error
    }

    const previousRoot = this.modelRoot
    const previousOverride = this.materialOverride
    const previousAnimation = this.animation
    const cameraState = snapshotCamera(this.camera, this.controls)

    try {
      applyCameraFit(this.camera, this.controls, fit)
    } catch (error) {
      restoreCamera(this.camera, this.controls, cameraState)
      disposePreparedModel(loaded.scene, nextOverride, nextAnimation)
      throw error
    }

    try {
      this.scene.add(loaded.scene)
      if (previousRoot !== undefined) this.scene.remove(previousRoot)
    } catch (error) {
      if (loaded.scene.parent === this.scene) this.scene.remove(loaded.scene)
      if (previousRoot !== undefined && previousRoot.parent !== this.scene) this.scene.add(previousRoot)
      restoreCamera(this.camera, this.controls, cameraState)
      disposePreparedModel(loaded.scene, nextOverride, nextAnimation)
      throw error
    }

    this.modelRoot = loaded.scene
    this.materialOverride = nextOverride
    this.animation = nextAnimation

    if (previousRoot !== undefined) {
      previousAnimation?.dispose()
      previousOverride?.dispose()
      disposeObjectTree(previousRoot)
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

  private disposeModel(): void {
    const root = this.modelRoot
    const override = this.materialOverride
    const animation = this.animation
    this.modelRoot = undefined
    this.materialOverride = undefined
    this.animation = undefined
    if (root === undefined) return
    this.scene.remove(root)
    animation?.dispose()
    override?.dispose()
    disposeObjectTree(root)
  }

  private assertActive(): void {
    if (this.disposed) throw new Error('Viewer engine is disposed')
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
  override: MaterialOverride,
  animation: AnimationPort,
): void {
  animation.dispose()
  override.dispose()
  disposeObjectTree(root)
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
