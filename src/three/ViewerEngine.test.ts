import {
  AnimationClip,
  BufferAttribute,
  BoxGeometry,
  CubeUVReflectionMapping,
  DoubleSide,
  BufferGeometry,
  Group,
  Line,
  LineBasicMaterial,
  Mesh,
  MeshBasicMaterial,
  MeshStandardMaterial,
  Matrix3,
  Points,
  PointsMaterial,
  PerspectiveCamera,
  ShaderMaterial,
  Texture,
  Vector2,
  Vector3,
  type Object3D,
} from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { ShaderParameterDefinition } from '../domain/parameters'
import type { MaterialInputProfile } from '../domain/materialInput'
import type { ShaderDraft } from '../domain/shader'
import type { CompileDiagnostic, ViewerPort } from '../application/ViewerPort'
import {
  DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS,
  ENVIRONMENT_LOAD_ERROR_MESSAGE,
  EnvironmentLoadError,
  type EnvironmentDisplaySettings,
} from '../domain/environment'
import type { EnvironmentShaderMaterial } from './materialBindings/GltfPbrBinding'
import type { EnvironmentBinding, MaterialVariantFactory } from './materialBindings/types'
import { ShaderCompiler, type PreparedRuntimeMaterial } from './ShaderCompiler'
import {
  ViewerEngine,
  type AnimationPort,
  type CompilerPort,
  type EnvironmentPort,
  type ModelLoaderPort,
  type ViewerControls,
  type ViewerEngineDependencies,
  type ViewerRenderer,
} from './ViewerEngine'
import { setMaterialInputProfile } from './shaders/materialFactory'

const gain: ShaderParameterDefinition = {
  id: 'gain',
  type: 'float',
  uniformName: 'uGain',
  label: 'Gain',
  min: 0,
  max: 2,
  step: 0.1,
  defaultValue: 1,
}

function shader(
  source = 'void main() { outColor = vec4(uGain); }',
  materialInputProfile: MaterialInputProfile = 'none',
): ShaderDraft {
  return {
    id: source,
    name: source,
    origin: 'local',
    fragmentSource: source,
    parameters: [gain],
    parameterValues: { gain: 1 },
    schemaVersion: 2,
    materialInputProfile,
  }
}

function modelFile(name: string): File {
  return new File(['model'], name, { type: 'model/gltf-binary' })
}

interface Harness {
  host: HTMLDivElement
  renderer: ViewerRenderer
  controls: ViewerControls
  environment: EnvironmentPort
  dependencies: ViewerEngineDependencies
  resize: () => void
  frames: Map<number, FrameRequestCallback>
  requestFrame: ReturnType<typeof vi.fn>
  cancelFrame: ReturnType<typeof vi.fn>
  disconnect: ReturnType<typeof vi.fn>
}

function createHarness(
  overrides: Partial<ViewerEngineDependencies> = {},
  host = document.createElement('div'),
): Harness {
  let width = 800
  let height = 400
  Object.defineProperty(host, 'clientWidth', { configurable: true, get: () => width })
  Object.defineProperty(host, 'clientHeight', { configurable: true, get: () => height })
  Object.defineProperty(host, 'setTestSize', {
    configurable: true,
    value: (nextWidth: number, nextHeight: number) => { width = nextWidth; height = nextHeight },
  })
  const canvas = document.createElement('canvas')
  const renderer: ViewerRenderer = {
    debug: { checkShaderErrors: true, onShaderError: null },
    domElement: canvas,
    dispose: vi.fn(),
    getDrawingBufferSize: vi.fn((target: Vector2) => target.set(canvas.width, canvas.height)),
    render: vi.fn(),
    setPixelRatio: vi.fn(),
    setSize: vi.fn((nextWidth: number, nextHeight: number) => {
      canvas.width = nextWidth
      canvas.height = nextHeight
    }),
  }
  const controls: ViewerControls = {
    target: new Vector3(),
    dispose: vi.fn(),
    saveState: vi.fn(),
    update: vi.fn(),
  }
  const environment: EnvironmentPort = {
    binding: {
      environmentMap: { value: null },
      environmentRotation: { value: new Matrix3() },
      environmentIntensity: { value: 1 },
    },
    load: vi.fn(async () => undefined),
    update: vi.fn(),
    dispose: vi.fn(),
  }
  const frames = new Map<number, FrameRequestCallback>()
  let nextFrame = 1
  const requestFrame = vi.fn((callback: FrameRequestCallback) => {
    const id = nextFrame++
    frames.set(id, (time) => {
      frames.delete(id)
      callback(time)
    })
    return id
  })
  const cancelFrame = vi.fn((id: number) => { frames.delete(id) })
  const disconnect = vi.fn()
  let resize: () => void = () => undefined
  const dependencies: ViewerEngineDependencies = {
    createRenderer: () => renderer,
    createControls: () => controls,
    createEnvironment: () => environment,
    createResizeObserver: (callback) => {
      resize = () => callback([], {} as ResizeObserver)
      return { observe: vi.fn(), disconnect }
    },
    requestAnimationFrame: requestFrame,
    cancelAnimationFrame: cancelFrame,
    clock: { elapsedTime: 2, getDelta: () => 0.25 },
    devicePixelRatio: 1,
    ...overrides,
  }
  return {
    host,
    renderer,
    controls,
    environment,
    dependencies,
    get resize() { return resize },
    frames,
    requestFrame,
    cancelFrame,
    disconnect,
  }
}

function environmentTexture(width: number, height: number): Texture {
  const texture = new Texture({ width, height })
  texture.mapping = CubeUVReflectionMapping
  return texture
}

function createProfileVariantFactory(
  binding: EnvironmentBinding,
  onCreate?: (original: MeshBasicMaterial | MeshStandardMaterial) => void,
): MaterialVariantFactory {
  return (original, template) => {
    onCreate?.(original as MeshBasicMaterial | MeshStandardMaterial)
    const variant = template.clone() as EnvironmentShaderMaterial
    variant.uniforms = {
      ...template.uniforms,
      uEnvironmentMap: binding.environmentMap,
      uEnvironmentRotation: binding.environmentRotation,
      uEnvironmentIntensity: binding.environmentIntensity,
    }
    variant.envMap = binding.environmentMap.value
    return variant
  }
}

function deferred<T>(): {
  promise: Promise<T>
  resolve(value: T): void
  reject(error: unknown): void
} {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

describe('ViewerEngine', () => {
  it('delegates environment loading and display updates to its environment owner', async () => {
    const harness = createHarness()
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const source = { kind: 'bundled', id: 'studio', url: 'studio.hdr' } as const
    const settings: EnvironmentDisplaySettings = {
      ...DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS,
      backgroundMode: 'clear-color',
      clearColor: '#336699',
      rotation: 45,
      intensity: 1.5,
    }

    await engine.loadEnvironment(source)
    engine.updateEnvironment(settings)

    expect(harness.environment.load).toHaveBeenCalledOnce()
    expect(harness.environment.load).toHaveBeenCalledWith(source)
    expect(harness.environment.update).toHaveBeenCalledWith(settings)
    vi.mocked(harness.environment.load).mockRejectedValueOnce(new Error('decoder detail'))
    await expect(engine.loadEnvironment({ kind: 'remote', url: 'https://example.com/fail.hdr' })).rejects.toMatchObject({
      name: 'EnvironmentLoadError',
      message: ENVIRONMENT_LOAD_ERROR_MESSAGE,
      cause: expect.objectContaining({ message: 'decoder detail' }),
    })
    engine.dispose()
  })

  it('maps disposed-environment loads to the typed boundary error with their lifecycle cause', async () => {
    const harness = createHarness()
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    engine.dispose()

    const rejection = await engine.loadEnvironment({ kind: 'remote', url: 'https://example.com/studio.hdr' }).catch((error: unknown) => error)

    expect(rejection).toBeInstanceOf(EnvironmentLoadError)
    expect(rejection).toMatchObject({
      message: ENVIRONMENT_LOAD_ERROR_MESSAGE,
      cause: expect.objectContaining({ message: 'Viewer engine is disposed' }),
    })
  })

  it('keeps one RAF pending, resizes imperatively, and tears down idempotently across remounts', () => {
    const first = createHarness()
    const engine: ViewerPort = new ViewerEngine(first.host, {}, first.dependencies)

    expect(first.host.lastElementChild).toBe(first.renderer.domElement)
    expect(first.renderer.setSize).toHaveBeenCalledWith(800, 400, false)
    expect(first.requestFrame).toHaveBeenCalledTimes(1)

    ;(first.host as HTMLDivElement & { setTestSize(width: number, height: number): void }).setTestSize(320, 200)
    first.resize()
    expect(first.renderer.setSize).toHaveBeenLastCalledWith(320, 200, false)

    first.frames.get(1)?.(16)
    expect(first.requestFrame).toHaveBeenCalledTimes(2)
    expect(first.frames.size).toBe(1)
    const renderedCamera = vi.mocked(first.renderer.render).mock.calls[0][1] as PerspectiveCamera
    expect(renderedCamera.aspect).toBe(1.6)

    engine.dispose()
    engine.dispose()

    expect(first.cancelFrame).toHaveBeenCalledTimes(1)
    expect(first.disconnect).toHaveBeenCalledTimes(1)
    expect(first.controls.dispose).toHaveBeenCalledTimes(1)
    expect(first.renderer.dispose).toHaveBeenCalledTimes(1)
    expect(first.host.childElementCount).toBe(0)

    const second = createHarness({}, first.host)
    const remounted = new ViewerEngine(second.host, {}, second.dependencies)
    expect(second.host.childElementCount).toBe(1)
    remounted.dispose()
    expect(second.host.childElementCount).toBe(0)
  })

  it('keeps the current model through a failed load and disposes it only after a later install succeeds', async () => {
    const firstRoot = new Group()
    const firstGeometry = new BoxGeometry()
    const firstMaterial = new MeshBasicMaterial()
    firstRoot.add(new Mesh(firstGeometry, firstMaterial))
    const secondRoot = new Group()
    secondRoot.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    const disposeGeometry = vi.spyOn(firstGeometry, 'dispose')
    const disposeMaterial = vi.spyOn(firstMaterial, 'dispose')
    const loader: ModelLoaderPort = {
      load: vi.fn()
        .mockResolvedValueOnce({ scene: firstRoot, animations: [new AnimationClip('Idle', 1)] })
        .mockRejectedValueOnce(new Error('malformed'))
        .mockResolvedValueOnce({ scene: secondRoot, animations: [] }),
    }
    const harness = createHarness({ loader })
    const onModelInfo = vi.fn()
    const onAnimationState = vi.fn()
    const engine = new ViewerEngine(harness.host, { onModelInfo, onAnimationState }, harness.dependencies)
    const firstFile = modelFile('first.glb')

    await expect(engine.loadModel([firstFile], firstFile)).resolves.toEqual({
      name: 'first.glb',
      meshCount: 1,
      animationClips: [{ id: 'clip-0', label: 'Idle' }],
    })
    engine.setAnimationPlaying(false)
    expect(onAnimationState).toHaveBeenLastCalledWith({
      clips: [{ id: 'clip-0', label: 'Idle' }], selectedClipId: 'clip-0', playing: false,
    })
    const failedFile = modelFile('bad.glb')
    await expect(engine.loadModel([failedFile], failedFile)).rejects.toThrow('malformed')
    expect(disposeGeometry).not.toHaveBeenCalled()
    expect(disposeMaterial).not.toHaveBeenCalled()

    const secondFile = modelFile('second.glb')
    await engine.loadModel([secondFile], secondFile)
    expect(disposeGeometry).toHaveBeenCalledTimes(1)
    expect(disposeMaterial).toHaveBeenCalledTimes(1)
    expect(onModelInfo).toHaveBeenLastCalledWith({ name: 'second.glb', meshCount: 1, animationClips: [] })
    expect(onAnimationState).toHaveBeenCalledWith({
      clips: [{ id: 'clip-0', label: 'Idle' }], selectedClipId: 'clip-0', playing: true,
    })

    engine.dispose()
  })

  it('reports every shader-compatible GLTF renderable', async () => {
    const root = new Group().add(
      new Mesh(new BoxGeometry(), new MeshBasicMaterial()),
      new Line(new BufferGeometry(), new LineBasicMaterial()),
      new Points(new BufferGeometry(), new PointsMaterial()),
    )
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    const harness = createHarness({ loader })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const file = modelFile('renderables.glb')

    await expect(engine.loadModel([file], file)).resolves.toMatchObject({ meshCount: 3 })
    engine.dispose()
  })

  it('rolls back camera, scene, and ownership when camera controls throw during model commit', async () => {
    const firstRoot = new Group()
    const firstGeometry = new BoxGeometry()
    const firstMaterial = new MeshBasicMaterial()
    firstRoot.add(new Mesh(firstGeometry, firstMaterial))
    const secondRoot = new Group()
    const secondGeometry = new BoxGeometry()
    const secondMaterial = new MeshBasicMaterial()
    secondRoot.add(new Mesh(secondGeometry, secondMaterial))
    const disposeFirstGeometry = vi.spyOn(firstGeometry, 'dispose')
    const disposeFirstMaterial = vi.spyOn(firstMaterial, 'dispose')
    const disposeSecondGeometry = vi.spyOn(secondGeometry, 'dispose')
    const disposeSecondMaterial = vi.spyOn(secondMaterial, 'dispose')
    const loader: ModelLoaderPort = {
      load: vi.fn()
        .mockResolvedValueOnce({ scene: firstRoot, animations: [] })
        .mockResolvedValueOnce({ scene: secondRoot, animations: [] }),
    }
    const harness = createHarness({ loader })
    const onModelInfo = vi.fn()
    const engine = new ViewerEngine(harness.host, { onModelInfo }, harness.dependencies)
    const firstFile = modelFile('first.glb')
    await engine.loadModel([firstFile], firstFile)
    harness.frames.get(1)?.(16)
    const [viewerScene, camera] = vi.mocked(harness.renderer.render).mock.calls.at(-1) as [Object3D, PerspectiveCamera]
    const cameraPosition = camera.position.clone()
    const cameraNear = camera.near
    const cameraFar = camera.far
    const controlsTarget = harness.controls.target.clone()
    vi.mocked(harness.controls.saveState).mockImplementationOnce(() => { throw new Error('controls commit failed') })

    const secondFile = modelFile('second.glb')
    await expect(engine.loadModel([secondFile], secondFile)).rejects.toThrow('controls commit failed')

    expect(firstRoot.parent).toBe(viewerScene)
    expect(secondRoot.parent).toBeNull()
    expect(disposeFirstGeometry).not.toHaveBeenCalled()
    expect(disposeFirstMaterial).not.toHaveBeenCalled()
    expect(disposeSecondGeometry).toHaveBeenCalledTimes(1)
    expect(disposeSecondMaterial).toHaveBeenCalledTimes(1)
    expect(camera.position).toEqual(cameraPosition)
    expect(camera.near).toBe(cameraNear)
    expect(camera.far).toBe(cameraFar)
    expect(harness.controls.target).toEqual(controlsTarget)
    expect(onModelInfo).toHaveBeenCalledTimes(1)

    engine.dispose()
  })

  it('isolates notification callback failures after a successful model commit', async () => {
    const root = new Group()
    root.add(new Mesh(new BoxGeometry(), new MeshBasicMaterial()))
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    const harness = createHarness({ loader })
    const onModelInfo = vi.fn(() => { throw new Error('model notification failed') })
    const onAnimationState = vi.fn(() => { throw new Error('animation notification failed') })
    const engine = new ViewerEngine(harness.host, { onModelInfo, onAnimationState }, harness.dependencies)
    const file = modelFile('notified.glb')

    await expect(engine.loadModel([file], file)).resolves.toEqual({
      name: 'notified.glb',
      meshCount: 1,
      animationClips: [],
    })
    expect(onModelInfo).toHaveBeenCalledTimes(1)
    expect(onAnimationState).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  it('keeps the current model when its shader fails a variant introduced by the replacement', async () => {
    const firstRoot = new Group()
    const firstMesh = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    firstRoot.add(firstMesh)
    const secondRoot = new Group()
    const secondGeometry = new BoxGeometry()
    const secondMaterial = new MeshBasicMaterial({ side: DoubleSide })
    secondRoot.add(new Mesh(secondGeometry, secondMaterial))
    const disposeSecondGeometry = vi.spyOn(secondGeometry, 'dispose')
    const disposeSecondMaterial = vi.spyOn(secondMaterial, 'dispose')
    const loader: ModelLoaderPort = {
      load: vi.fn()
        .mockResolvedValueOnce({ scene: firstRoot, animations: [] })
        .mockResolvedValueOnce({ scene: secondRoot, animations: [] }),
    }
    const harness = createHarness({
      loader,
      createCompiler: (renderer) => new ShaderCompiler(renderer, { validate: async () => [] }),
    })
    let rejectDoubleSided = false
    harness.renderer.render = vi.fn((scene: Object3D) => {
      let hasDoubleSidedShader = false
      scene.traverse((object) => {
        if (object instanceof Mesh && object.material instanceof ShaderMaterial) {
          hasDoubleSidedShader ||= object.material.side === DoubleSide
        }
      })
      if (!rejectDoubleSided || !hasDoubleSidedShader) return
      const fragment = {} as WebGLShader
      const gl = {
        getProgramInfoLog: () => 'link failed',
        getShaderInfoLog: (shader: WebGLShader) => shader === fragment ? 'ERROR: 1:2: model variant failed' : '',
      } as unknown as WebGLRenderingContext
      harness.renderer.debug.onShaderError?.(gl, {} as never, {} as WebGLShader, fragment)
    })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const firstFile = modelFile('front.glb')
    await engine.loadModel([firstFile], firstFile)
    await engine.compileShader(shader())
    const working = firstMesh.material
    const disposeWorking = vi.spyOn(working, 'dispose')
    rejectDoubleSided = true

    const secondFile = modelFile('double.glb')
    await expect(engine.loadModel([secondFile], secondFile)).rejects.toThrow('model variant failed')

    expect(firstRoot.parent).not.toBeNull()
    expect(firstMesh.material).toBe(working)
    expect(disposeWorking).not.toHaveBeenCalled()
    expect(secondRoot.parent).toBeNull()
    expect(disposeSecondGeometry).toHaveBeenCalledTimes(1)
    expect(disposeSecondMaterial).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  it('installs only valid compiled materials and mutates shared uniforms on the frame loop', async () => {
    const root = new Group()
    const original = new MeshBasicMaterial()
    const mesh = new Mesh(new BoxGeometry(), original)
    root.add(mesh)
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    const validationError: CompileDiagnostic = { severity: 'error', message: 'broken', raw: 'broken' }
    const validate = vi.fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce([validationError])
    const harness = createHarness({
      loader,
      createCompiler: (renderer) => new ShaderCompiler(renderer, { validate }),
    })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const file = modelFile('model.glb')
    await engine.loadModel([file], file)

    await expect(engine.compileShader(shader())).resolves.toEqual({ status: 'valid', generation: 1 })
    const working = mesh.material as unknown as ShaderMaterial
    expect(working).toBeInstanceOf(ShaderMaterial)
    expect(working).not.toBe(original)

    engine.updateParameter(gain, 1.75)
    harness.frames.get(1)?.(16)
    expect(validate).toHaveBeenCalledTimes(1)
    expect(working.uniforms.uGain.value).toBe(1.75)
    expect(working.uniforms.uTime.value).toBe(2)
    expect(working.uniforms.uResolution.value).toEqual(new Vector2(800, 400))
    expect(working.uniforms.uCameraPosition.value).toEqual(expect.any(Vector3))

    await expect(engine.compileShader(shader('broken'))).resolves.toEqual({
      status: 'error',
      generation: 2,
      diagnostics: [validationError],
    })
    expect(mesh.material).toBe(working)
    expect(validate).toHaveBeenCalledTimes(2)

    engine.dispose()
    expect(mesh.material).toBe(original)
  })

  it('derives the surface profile from the compiled template and binds every original material', async () => {
    const first = new MeshBasicMaterial()
    const second = new MeshBasicMaterial()
    const root = new Group().add(
      new Mesh(new BoxGeometry(), first),
      new Mesh(new BoxGeometry(), second),
    )
    const createdFor: MeshBasicMaterial[] = []
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    const createVariantFactory = vi.fn((_profile: MaterialInputProfile, binding: EnvironmentBinding) => (
      createProfileVariantFactory(
        binding,
        (original) => createdFor.push(original as MeshBasicMaterial),
      )
    ))
    const harness = createHarness({
      loader,
      createCompiler: (renderer) => new ShaderCompiler(renderer, { validate: async () => [] }),
      createVariantFactory,
    })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const file = modelFile('surface.glb')

    await engine.loadModel([file], file)
    await expect(engine.compileShader(shader('surface shader', 'gltf-surface'))).resolves.toMatchObject({ status: 'valid' })

    expect(createVariantFactory).toHaveBeenCalledWith('gltf-surface', harness.environment.binding)
    expect(new Set(createdFor)).toEqual(new Set([first, second]))
    engine.dispose()
  })

  it('keeps none-profile compatibility sharing while preserving profile context cache splits', async () => {
    const shared = new MeshStandardMaterial()
    const uv1Geometry = new BoxGeometry()
    uv1Geometry.setAttribute('uv1', new BufferAttribute(
      (uv1Geometry.getAttribute('uv') as BufferAttribute).array,
      2,
    ))
    const map = new Texture()
    map.channel = 1
    shared.map = map
    const firstUv1 = new Mesh(uv1Geometry, shared)
    const secondUv1 = new Mesh(uv1Geometry.clone(), shared)
    const uv0 = new Mesh(new BoxGeometry(), shared)
    const compatibleA = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    const compatibleB = new Mesh(new BoxGeometry(), new MeshBasicMaterial())
    const root = new Group().add(firstUv1, secondUv1, uv0, compatibleA, compatibleB)
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    const harness = createHarness({
      loader,
      createCompiler: (renderer) => new ShaderCompiler(renderer, { validate: async () => [] }),
    })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const file = modelFile('contexts.glb')
    await engine.loadModel([file], file)

    await engine.compileShader(shader('none shader'))
    expect(compatibleA.material).toBe(compatibleB.material)

    await engine.compileShader(shader('pbr shader', 'gltf-pbr'))
    expect(firstUv1.material).toBe(secondUv1.material)
    expect(firstUv1.material).not.toBe(uv0.material)
    expect(firstUv1.material).not.toBe(shared)
    expect(uv0.material).not.toBe(shared)
    engine.dispose()
  })

  it('rejects a profile factory alias to an active variant without disposing the working shader', async () => {
    const original = new MeshStandardMaterial()
    const mesh = new Mesh(new BoxGeometry(), original)
    const root = new Group().add(mesh)
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    let aliased: ShaderMaterial | undefined
    const harness = createHarness({
      loader,
      createCompiler: (renderer) => new ShaderCompiler(renderer, { validate: async () => [] }),
      createVariantFactory: (_profile, binding) => (source, template) => {
        aliased ??= createProfileVariantFactory(binding)(source, template)
        return aliased
      },
    })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const file = modelFile('aliased-profile.glb')
    await engine.loadModel([file], file)
    await engine.compileShader(shader('surface alias source', 'gltf-surface'))
    const working = mesh.material as unknown as ShaderMaterial
    const disposeWorking = vi.spyOn(working, 'dispose')

    const result = await engine.compileShader(shader('pbr alias source', 'gltf-pbr'))

    expect(result).toMatchObject({
      status: 'error',
      diagnostics: [expect.objectContaining({ message: expect.stringContaining('fresh app-owned') })],
    })
    expect(mesh.material).toBe(working)
    expect(disposeWorking).not.toHaveBeenCalled()
    engine.dispose()
  })

  it('rebinds every active PBR envMap without recompiling and invalidates only changed cubeUV programs', async () => {
    const firstMap = environmentTexture(768, 256)
    const sameProgramMap = environmentTexture(768, 256)
    const resizedMap = environmentTexture(1536, 512)
    const binding: EnvironmentBinding = {
      environmentMap: { value: firstMap },
      environmentRotation: { value: new Matrix3() },
      environmentIntensity: { value: 1 },
    }
    const loads = [sameProgramMap, resizedMap]
    const environment: EnvironmentPort = {
      binding,
      load: vi.fn(async () => {
        binding.environmentMap.value = loads.shift() ?? null
      }),
      update: vi.fn(),
      dispose: vi.fn(),
    }
    const root = new Group().add(
      new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
      new Mesh(new BoxGeometry(), new MeshStandardMaterial()),
    )
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    let compiler!: ShaderCompiler
    const createVariantFactory = vi.fn((_profile: MaterialInputProfile, sharedBinding: EnvironmentBinding) => {
      expect(sharedBinding).toBe(binding)
      return createProfileVariantFactory(sharedBinding)
    })
    const harness = createHarness({
      loader,
      createEnvironment: () => environment,
      createVariantFactory,
      createCompiler: (renderer) => {
        compiler = new ShaderCompiler(renderer, { validate: async () => [] })
        return compiler
      },
    })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const file = modelFile('pbr.glb')
    await engine.loadModel([file], file)
    const compile = vi.spyOn(compiler, 'compile')
    await engine.compileShader(shader('local PBR copy', 'gltf-pbr'))
    const variants = root.children.map((child) => (child as Mesh).material as EnvironmentShaderMaterial)
    const versions = variants.map((variant) => variant.version)

    await engine.loadEnvironment({ kind: 'bundled', id: 'same', url: 'same.hdr' })
    expect(variants.map((variant) => variant.envMap)).toEqual([sameProgramMap, sameProgramMap])
    expect(variants.map((variant) => variant.version)).toEqual(versions)
    expect(compile).toHaveBeenCalledTimes(1)

    await engine.loadEnvironment({ kind: 'bundled', id: 'large', url: 'large.hdr' })
    expect(variants.map((variant) => variant.envMap)).toEqual([resizedMap, resizedMap])
    expect(variants.map((variant) => variant.version)).toEqual(versions.map((version) => version + 1))
    expect(compile).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  it('prepares the active profile on a replacement model before disposing the predecessor', async () => {
    const firstRoot = new Group()
    const firstOriginal = new MeshBasicMaterial()
    const firstMesh = new Mesh(new BoxGeometry(), firstOriginal)
    firstRoot.add(firstMesh)
    const secondRoot = new Group()
    const secondOriginal = new MeshBasicMaterial()
    const secondMesh = new Mesh(new BoxGeometry(), secondOriginal)
    secondRoot.add(secondMesh)
    const loader: ModelLoaderPort = {
      load: vi.fn()
        .mockResolvedValueOnce({ scene: firstRoot, animations: [] })
        .mockResolvedValueOnce({ scene: secondRoot, animations: [] }),
    }
    const disposalOrder: string[] = []
    const createAnimation = (root: Object3D): AnimationPort => ({
      clips: [],
      playing: false,
      select: vi.fn(),
      setPlaying: vi.fn(),
      update: vi.fn(),
      dispose: vi.fn(() => {
        if (root === firstRoot) disposalOrder.push('animation')
      }),
    })
    let firstVariant: ShaderMaterial | undefined
    const createdFor: MeshBasicMaterial[] = []
    const harness = createHarness({
      loader,
      createAnimation,
      createCompiler: (renderer) => new ShaderCompiler(renderer, { validate: async () => [] }),
      createVariantFactory: (_profile, binding) => (original, template) => {
        createdFor.push(original as MeshBasicMaterial)
        const variant = createProfileVariantFactory(binding)(original, template)
        if (original === firstOriginal) firstVariant = variant
        return variant
      },
    })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const firstFile = modelFile('first.glb')
    await engine.loadModel([firstFile], firstFile)
    await engine.compileShader(shader('toon copy', 'gltf-surface'))
    const disposeFirstVariant = vi.spyOn(firstVariant as ShaderMaterial, 'dispose').mockImplementation(() => {
      disposalOrder.push('variant')
      expect(secondRoot.parent).not.toBeNull()
      expect(secondMesh.material).toBeInstanceOf(ShaderMaterial)
    })

    const secondFile = modelFile('second.glb')
    await engine.loadModel([secondFile], secondFile)

    expect(createdFor).toContain(secondOriginal)
    expect(disposeFirstVariant).toHaveBeenCalledOnce()
    expect(disposalOrder).toEqual(['variant', 'animation'])
    expect(firstRoot.parent).toBeNull()
    engine.dispose()
  })

  it('prevents a pending environment load from installing after disposal and tears environment down before renderer', async () => {
    const firstMap = environmentTexture(768, 256)
    const lateMap = environmentTexture(1536, 512)
    const pending = deferred<void>()
    const order: string[] = []
    const binding: EnvironmentBinding = {
      environmentMap: { value: firstMap },
      environmentRotation: { value: new Matrix3() },
      environmentIntensity: { value: 1 },
    }
    const environment: EnvironmentPort = {
      binding,
      load: vi.fn(() => pending.promise),
      update: vi.fn(),
      dispose: vi.fn(() => { order.push('environment') }),
    }
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
    const root = new Group().add(mesh)
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    const harness = createHarness({
      loader,
      createEnvironment: () => environment,
      createCompiler: (renderer) => new ShaderCompiler(renderer, { validate: async () => [] }),
    })
    vi.mocked(harness.renderer.dispose).mockImplementation(() => { order.push('renderer') })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const file = modelFile('pending-environment.glb')
    await engine.loadModel([file], file)
    await engine.compileShader(shader('pbr pending', 'gltf-pbr'))
    const variant = mesh.material as unknown as EnvironmentShaderMaterial
    const normalFallback = variant.uniforms.uGltfNormalMap.value as Texture
    variant.addEventListener('dispose', () => { order.push('variant') })
    normalFallback.addEventListener('dispose', () => { order.push('binding') })
    const disposeVariant = vi.spyOn(variant, 'dispose')

    const loading = engine.loadEnvironment({ kind: 'bundled', id: 'late', url: 'late.hdr' })
    engine.dispose()
    binding.environmentMap.value = lateMap
    pending.resolve(undefined)
    await loading

    expect(variant.envMap).toBe(firstMap)
    expect(disposeVariant).toHaveBeenCalledOnce()
    expect(order).toEqual(['variant', 'binding', 'environment', 'renderer'])
  })

  it('disposes pending profile variants before their borrowed environment can be torn down', async () => {
    const compileResult = deferred<CompileDiagnostic[]>()
    const order: string[] = []
    let prepared: PreparedRuntimeMaterial | undefined
    let pendingVariant: ShaderMaterial | undefined
    const compiler: CompilerPort = {
      material: undefined,
      compile: vi.fn((draft, prepareRuntime) => {
        const template = new ShaderMaterial()
        setMaterialInputProfile(template, draft.materialInputProfile)
        prepared = prepareRuntime?.(template)
        return compileResult.promise.then((diagnostics) => ({
          status: 'error' as const,
          generation: 1,
          diagnostics,
        }))
      }),
      updateParameter: vi.fn(),
      dispose: vi.fn(),
    }
    const environment: EnvironmentPort = {
      binding: {
        environmentMap: { value: null },
        environmentRotation: { value: new Matrix3() },
        environmentIntensity: { value: 1 },
      },
      load: vi.fn(async () => undefined),
      update: vi.fn(),
      dispose: vi.fn(() => { order.push('environment') }),
    }
    const mesh = new Mesh(new BoxGeometry(), new MeshStandardMaterial())
    const root = new Group().add(mesh)
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    const harness = createHarness({
      loader,
      createCompiler: () => compiler,
      createEnvironment: () => environment,
      createVariantFactory: (_profile, binding) => (original, template) => {
        pendingVariant = createProfileVariantFactory(binding)(original, template)
        pendingVariant.addEventListener('dispose', () => { order.push('pending-variant') })
        return pendingVariant
      },
    })
    vi.mocked(harness.renderer.dispose).mockImplementation(() => { order.push('renderer') })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const file = modelFile('pending-profile.glb')
    await engine.loadModel([file], file)

    const compiling = engine.compileShader(shader('pending profile', 'gltf-pbr'))
    expect(pendingVariant).toBeInstanceOf(ShaderMaterial)
    engine.dispose()

    expect(() => prepared?.commit()).toThrow('Material runtime transaction is complete')
    expect(order).toEqual(['pending-variant', 'environment', 'renderer'])
    compileResult.resolve([])
    await compiling
  })

  it('keeps the working override when an installed material variant fails GPU validation', async () => {
    const root = new Group()
    const original = new MeshBasicMaterial({ side: DoubleSide })
    const mesh = new Mesh(new BoxGeometry(), original)
    root.add(mesh)
    const loader: ModelLoaderPort = { load: vi.fn(async () => ({ scene: root, animations: [] })) }
    const harness = createHarness({
      loader,
      createCompiler: (renderer) => new ShaderCompiler(renderer, { validate: async () => [] }),
    })
    let failedVariant: ShaderMaterial | undefined
    let disposeFailedVariant: ReturnType<typeof vi.spyOn> | undefined
    harness.renderer.render = vi.fn((scene: Object3D) => {
      scene.traverse((object) => {
        if (!(object instanceof Mesh) || !(object.material instanceof ShaderMaterial)) return
        if (!object.material.fragmentShader.includes('variantFailure')) return
        failedVariant = object.material
        disposeFailedVariant ??= vi.spyOn(object.material, 'dispose')
      })
      if (failedVariant === undefined) return
      const fragment = {} as WebGLShader
      const gl = {
        getProgramInfoLog: () => 'link failed',
        getShaderInfoLog: (shader: WebGLShader) => shader === fragment ? 'ERROR: 1:2: variant failed' : '',
      } as unknown as WebGLRenderingContext
      harness.renderer.debug.onShaderError?.(gl, {} as never, {} as WebGLShader, fragment)
    })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)
    const file = modelFile('double-sided.glb')
    await engine.loadModel([file], file)
    await engine.compileShader(shader())
    const working = mesh.material as unknown as ShaderMaterial
    const disposeWorking = vi.spyOn(working, 'dispose')

    const result = await engine.compileShader(shader('void main() { variantFailure; }'))

    expect(result.status).toBe('error')
    expect(mesh.material).toBe(working)
    expect(disposeWorking).not.toHaveBeenCalled()
    expect(failedVariant?.side).toBe(DoubleSide)
    expect(disposeFailedVariant).toHaveBeenCalledTimes(1)
    engine.dispose()
  })

  it('wraps a canvas capture as a domain portrait without changing render state', async () => {
    const blob = new Blob(['portrait'], { type: 'image/webp' })
    const capture = vi.fn(async () => ({ mimeType: 'image/webp' as const, blob, width: 256, height: 128 }))
    const harness = createHarness({ createCapture: () => ({ capture }) })
    const engine = new ViewerEngine(harness.host, {}, harness.dependencies)

    await expect(engine.capturePortrait()).resolves.toEqual({
      kind: 'captured',
      mimeType: 'image/webp',
      blob,
      width: 256,
      height: 128,
    })
    expect(capture).toHaveBeenCalledTimes(1)
    engine.dispose()
  })
})
