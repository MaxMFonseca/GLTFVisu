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
import type { CompileDiagnostic, CompileResult } from '../application/ViewerPort'
import { getShaderLineMapping, createShaderMaterial } from './shaders/materialFactory'
import { parseShaderDiagnostics } from './shaders/diagnostics'
import { updateUniformValue } from './shaders/uniforms'

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

export type ShaderRenderValidator = (render: () => void) => CompileDiagnostic[]

export interface PreparedRuntimeMaterial {
  validate(validateRender: ShaderRenderValidator): CompileDiagnostic[]
  commit(): void
  dispose(): void
}

export type RuntimeMaterialPreparer = (material: ShaderMaterial) => PreparedRuntimeMaterial | undefined

/** Validates disposable candidates and atomically owns the latest valid shader template. */
export class ShaderCompiler {
  private generation = 0
  private disposed = false
  private activeMaterial?: ShaderMaterial
  private readonly pendingMaterials = new Set<ShaderMaterial>()
  private draftId?: string
  private readonly draftParameterValues = new Map<string, {
    definition: ShaderParameterDefinition
    value: ShaderParameterValue
  }>()
  private readonly renderer: ShaderValidationRenderer
  private readonly createMaterial: typeof createShaderMaterial
  private readonly validate: (material: ShaderMaterial) => Promise<CompileDiagnostic[]>

  constructor(renderer: ShaderValidationRenderer, dependencies: ShaderCompilerDependencies = {}) {
    this.renderer = renderer
    this.createMaterial = dependencies.createMaterial ?? createShaderMaterial
    this.validate = dependencies.validate ?? ((material) => validateMaterial(renderer, material))
  }

  get material(): ShaderMaterial | undefined {
    return this.activeMaterial
  }

  validateRuntime(prepareRuntime: RuntimeMaterialPreparer): CompileDiagnostic[] {
    if (this.disposed) throw new Error('Shader compiler is disposed')
    const material = this.activeMaterial
    if (material === undefined) return []
    const runtime = prepareRuntime(material)
    if (runtime === undefined) return []
    let committed = false
    try {
      const diagnostics = runtime.validate(
        (render) => captureShaderDiagnostics(this.renderer, material, render),
      )
      if (hasErrors(diagnostics)) return diagnostics
      runtime.commit()
      committed = true
      return diagnostics
    } finally {
      if (!committed) runtime.dispose()
    }
  }

  async compile(draft: ShaderDraft, prepareRuntime?: RuntimeMaterialPreparer): Promise<CompileResult> {
    const generation = ++this.generation
    if (draft.id !== this.draftId) {
      this.draftId = draft.id
      this.draftParameterValues.clear()
    }
    let candidate: ShaderMaterial
    try {
      candidate = this.createMaterial(draft.fragmentSource, draft.parameters, draft.parameterValues)
      for (const { definition, value } of this.draftParameterValues.values()) {
        if (candidate.uniforms[definition.uniformName] !== undefined) {
          updateUniformValue(candidate.uniforms, definition, value)
        }
      }
    } catch (error) {
      return errorResult(generation, error)
    }

    this.pendingMaterials.add(candidate)
    let runtime: PreparedRuntimeMaterial | undefined
    let committed = false
    try {
      let diagnostics: CompileDiagnostic[]
      try {
        diagnostics = await this.validate(candidate)
      } catch (error) {
        diagnostics = [diagnosticFor(error)]
      }

      if (this.disposed || generation !== this.generation) {
        return { status: 'error', generation, diagnostics: [] }
      }
      if (hasErrors(diagnostics)) return { status: 'error', generation, diagnostics }

      try {
        runtime = prepareRuntime?.(candidate)
        if (runtime !== undefined) {
          diagnostics = runtime.validate((render) => captureShaderDiagnostics(this.renderer, candidate, render))
        }
      } catch (error) {
        diagnostics = [diagnosticFor(error)]
      }

      if (this.disposed || generation !== this.generation) {
        return { status: 'error', generation, diagnostics: [] }
      }
      if (hasErrors(diagnostics)) return { status: 'error', generation, diagnostics }

      runtime?.commit()
      const predecessor = this.activeMaterial
      this.activeMaterial = candidate
      committed = true
      predecessor?.dispose()
      return { status: 'valid', generation }
    } catch (error) {
      return errorResult(generation, error)
    } finally {
      this.pendingMaterials.delete(candidate)
      if (!committed) {
        runtime?.dispose()
        candidate.dispose()
      }
    }
  }

  updateParameter(definition: ShaderParameterDefinition, value: ShaderParameterValue): void {
    this.draftParameterValues.set(definition.uniformName, { definition, value })
    if (this.activeMaterial?.uniforms[definition.uniformName] !== undefined) {
      updateUniformValue(this.activeMaterial.uniforms, definition, value)
    }
    for (const material of this.pendingMaterials) {
      if (material.uniforms[definition.uniformName] === undefined) continue
      updateUniformValue(material.uniforms, definition, value)
    }
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.generation += 1
    this.activeMaterial?.dispose()
    this.activeMaterial = undefined
    this.draftId = undefined
    this.draftParameterValues.clear()
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
  try {
    return captureShaderDiagnostics(renderer, material, () => renderer.render(scene, camera))
  } finally {
    scene.remove(mesh)
    geometry.dispose()
  }
}

function captureShaderDiagnostics(
  renderer: ShaderValidationRenderer,
  material: ShaderMaterial,
  render: () => void,
): CompileDiagnostic[] {
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
    render()
  } finally {
    renderer.debug.onShaderError = previousHandler
    renderer.debug.checkShaderErrors = previousChecking
  }

  return diagnostics
}

function hasErrors(diagnostics: readonly CompileDiagnostic[]): boolean {
  return diagnostics.some((diagnostic) => diagnostic.severity === 'error')
}

function errorResult(generation: number, error: unknown): CompileResult {
  return { status: 'error', generation, diagnostics: [diagnosticFor(error)] }
}

function diagnosticFor(error: unknown): CompileDiagnostic {
  const message = error instanceof Error ? error.message : String(error)
  return { severity: 'error', message, raw: message }
}
