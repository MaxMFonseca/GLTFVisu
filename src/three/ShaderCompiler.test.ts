import type { ShaderMaterial } from 'three'
import { describe, expect, it, vi } from 'vitest'
import type { ShaderParameterDefinition } from '../domain/parameters'
import type { ShaderDraft } from '../domain/shader'
import {
  ShaderCompiler,
  type CompileDiagnostic,
  type ShaderValidationRenderer,
} from './ShaderCompiler'

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

function draft(source: string): ShaderDraft {
  return {
    id: source,
    name: source,
    origin: 'local',
    fragmentSource: source,
    parameters: [gain],
    parameterValues: { gain: 1 },
    schemaVersion: 1,
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((complete) => { resolve = complete })
  return { promise, resolve }
}

const unusedRenderer: ShaderValidationRenderer = {
  debug: { checkShaderErrors: true, onShaderError: null },
  render: vi.fn(),
}

describe('ShaderCompiler', () => {
  it('rejects a stale generation immediately before commit', async () => {
    const validations = [deferred<CompileDiagnostic[]>(), deferred<CompileDiagnostic[]>()]
    const candidates: ShaderMaterial[] = []
    const compiler = new ShaderCompiler(unusedRenderer, {
      validate: (material) => {
        candidates.push(material)
        return validations[candidates.length - 1].promise
      },
    })
    const first = compiler.compile(draft('first'))
    const second = compiler.compile(draft('second'))
    expect(candidates).toHaveLength(2)
    const firstMaterial = candidates[0]
    const secondMaterial = candidates[1]
    const disposeStale = vi.spyOn(firstMaterial, 'dispose')

    validations[1].resolve([])
    await expect(second).resolves.toEqual({ status: 'valid', generation: 2 })
    validations[0].resolve([])
    await expect(first).resolves.toEqual({ status: 'error', generation: 1, diagnostics: [] })

    expect(compiler.material).toBe(secondMaterial)
    expect(disposeStale).toHaveBeenCalledTimes(1)
  })

  it('retains a working shader on failure and disposes it only after a later success', async () => {
    const syntaxError: CompileDiagnostic = {
      severity: 'error',
      message: 'syntax error',
      editorLine: 3,
      raw: 'ERROR: 1:3: syntax error',
    }
    const results = [[], [syntaxError], []] as CompileDiagnostic[][]
    const candidates: ShaderMaterial[] = []
    const compiler = new ShaderCompiler(unusedRenderer, {
      validate: async (material) => {
        candidates.push(material)
        return results[candidates.length - 1]
      },
    })

    await compiler.compile(draft('working'))
    const working = candidates[0]
    const disposeWorking = vi.spyOn(working, 'dispose')
    const failedPromise = compiler.compile(draft('broken'))
    const failed = candidates[1]
    const disposeFailed = vi.spyOn(failed, 'dispose')
    await expect(failedPromise).resolves.toEqual({ status: 'error', generation: 2, diagnostics: [syntaxError] })

    expect(compiler.material).toBe(working)
    expect(disposeWorking).not.toHaveBeenCalled()
    expect(failed).not.toBe(working)
    expect(disposeFailed).toHaveBeenCalledTimes(1)

    await expect(compiler.compile(draft('replacement'))).resolves.toEqual({ status: 'valid', generation: 3 })
    expect(compiler.material).toBe(candidates[2])
    expect(disposeWorking).toHaveBeenCalledTimes(1)
  })

  it('updates a live uniform without invoking validation again', async () => {
    const validate = vi.fn(async () => [])
    const compiler = new ShaderCompiler(unusedRenderer, { validate })
    await compiler.compile(draft('working'))
    const uniform = compiler.material?.uniforms.uGain

    compiler.updateParameter(gain, 1.75)

    expect(validate).toHaveBeenCalledTimes(1)
    expect(compiler.material?.uniforms.uGain).toBe(uniform)
    expect(uniform?.value).toBe(1.75)
  })

  it('captures renderer shader errors and maps user-source lines', async () => {
    const previousErrorHandler = vi.fn()
    const renderer: ShaderValidationRenderer = {
      debug: { checkShaderErrors: true, onShaderError: previousErrorHandler },
      render: vi.fn(() => {
        const fragment = {} as WebGLShader
        const gl = {
          getProgramInfoLog: () => 'link failed',
          getShaderInfoLog: (shader: WebGLShader) => shader === fragment ? 'ERROR: 1:7: syntax error' : '',
        } as unknown as WebGLRenderingContext
        renderer.debug.onShaderError?.(gl, {} as WebGLProgram, {} as WebGLShader, fragment)
      }),
    }
    const compiler = new ShaderCompiler(renderer)

    const result = await compiler.compile(draft('broken'))

    expect(result).toEqual({
      status: 'error',
      generation: 1,
      diagnostics: [{ severity: 'error', message: 'syntax error', editorLine: 7, raw: 'ERROR: 1:7: syntax error' }],
    })
    expect(renderer.debug.onShaderError).toBe(previousErrorHandler)
    expect(compiler.material).toBeUndefined()
  })
})
