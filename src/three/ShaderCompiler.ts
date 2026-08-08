import {
  Mesh,
  OrthographicCamera,
  PlaneGeometry,
  Scene,
  type Camera,
  type Object3D,
  type ShaderMaterial,
  type WebGLRenderer,
} from 'three'
import type { ShaderParameterDefinition, ShaderParameterValue } from '../domain/parameters'
import type { ShaderDraft } from '../domain/shader'
import { getShaderLineMapping, createShaderMaterial } from './shaders/materialFactory'
import { parseShaderDiagnostics } from './shaders/diagnostics'
import { updateUniformValue } from './shaders/uniforms'

export interface CompileDiagnostic {
  severity: 'error' | 'warning'
  message: string
  editorLine?: number
  raw: string
}

export type CompileResult =
  | { status: 'valid'; generation: number }
  | { status: 'error'; generation: number; diagnostics: CompileDiagnostic[] }

type ShaderErrorHandler = NonNullable<WebGLRenderer['debug']['onShaderError']>

export interface ShaderValidationRenderer {
  debug: {
    checkShaderErrors: boolean
    onShaderError: ShaderErrorHandler | null
  }
  render(scene: Object3D, camera: Camera): void
}

export interface ShaderCompilerDependencies {
  createMaterial?: typeof createShaderMaterial
  validate?: (material: ShaderMaterial) => Promise<CompileDiagnostic[]>
}

/** Validates disposable candidates and atomically owns the latest valid shader template. */
export class ShaderCompiler {
  private generation = 0
  private disposed = false
  private activeMaterial?: ShaderMaterial
  private readonly createMaterial: typeof createShaderMaterial
  private readonly validate: (material: ShaderMaterial) => Promise<CompileDiagnostic[]>

  constructor(renderer: ShaderValidationRenderer, dependencies: ShaderCompilerDependencies = {}) {
    this.createMaterial = dependencies.createMaterial ?? createShaderMaterial
    this.validate = dependencies.validate ?? ((material) => validateMaterial(renderer, material))
  }

  get material(): ShaderMaterial | undefined {
    return this.activeMaterial
  }

  async compile(draft: ShaderDraft): Promise<CompileResult> {
    const generation = ++this.generation
    let candidate: ShaderMaterial
    try {
      candidate = this.createMaterial(draft.fragmentSource, draft.parameters, draft.parameterValues)
    } catch (error) {
      return errorResult(generation, error)
    }

    let diagnostics: CompileDiagnostic[]
    try {
      diagnostics = await this.validate(candidate)
    } catch (error) {
      diagnostics = [diagnosticFor(error)]
    }

    if (this.disposed || generation !== this.generation) {
      candidate.dispose()
      return { status: 'error', generation, diagnostics: [] }
    }
    if (diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      candidate.dispose()
      return { status: 'error', generation, diagnostics }
    }

    const predecessor = this.activeMaterial
    this.activeMaterial = candidate
    predecessor?.dispose()
    return { status: 'valid', generation }
  }

  updateParameter(definition: ShaderParameterDefinition, value: ShaderParameterValue): void {
    if (this.activeMaterial === undefined) return
    updateUniformValue(this.activeMaterial.uniforms, definition, value)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.activeMaterial?.dispose()
    this.activeMaterial = undefined
  }
}

async function validateMaterial(
  renderer: ShaderValidationRenderer,
  material: ShaderMaterial,
): Promise<CompileDiagnostic[]> {
  const geometry = new PlaneGeometry(2, 2)
  const scene = new Scene()
  const camera = new OrthographicCamera(-1, 1, 1, -1, 0, 1)
  const mesh = new Mesh(geometry, material)
  scene.add(mesh)
  const previousHandler = renderer.debug.onShaderError
  const previousChecking = renderer.debug.checkShaderErrors
  const diagnostics: CompileDiagnostic[] = []

  renderer.debug.checkShaderErrors = true
  renderer.debug.onShaderError = (gl, program, vertexShader, fragmentShader) => {
    const logs = [
      gl.getShaderInfoLog(fragmentShader) ?? '',
      gl.getShaderInfoLog(vertexShader) ?? '',
      gl.getProgramInfoLog(program as unknown as WebGLProgram) ?? '',
    ].filter((log) => log.trim().length > 0)
    const mapping = getShaderLineMapping(material)
    for (const log of logs) {
      const parsed = mapping === undefined ? [] : parseShaderDiagnostics(log, mapping)
      diagnostics.push(...parsed.map((item) => ({
        severity: item.severity,
        message: item.message,
        editorLine: item.editorLine,
        raw: item.rawLine,
      })))
    }
    if (!diagnostics.some((diagnostic) => diagnostic.severity === 'error')) {
      const raw = logs.join('\n') || 'Shader program failed to link'
      diagnostics.push({ severity: 'error', message: 'Shader program failed to link', raw })
    }
  }

  try {
    renderer.render(scene, camera)
  } finally {
    renderer.debug.onShaderError = previousHandler
    renderer.debug.checkShaderErrors = previousChecking
    scene.remove(mesh)
    geometry.dispose()
  }

  return diagnostics
}

function errorResult(generation: number, error: unknown): CompileResult {
  return { status: 'error', generation, diagnostics: [diagnosticFor(error)] }
}

function diagnosticFor(error: unknown): CompileDiagnostic {
  const message = error instanceof Error ? error.message : String(error)
  return { severity: 'error', message, raw: message }
}
