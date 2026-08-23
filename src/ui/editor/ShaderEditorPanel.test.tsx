import { forwardRef, useImperativeHandle, useRef } from 'react'
import { cleanup, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { WorkspaceProvider } from '../../application/WorkspaceController'
import type { ShaderRepository } from '../../application/ShaderRepository'
import type { CompileResult, ViewerPort } from '../../application/ViewerPort'
import type { ShaderDefinition } from '../../domain/shader'
import {
  ShaderEditorPanel,
  type ShaderSourceEditorHandle,
  type ShaderSourceEditorProps,
} from './ShaderEditorPanel'

function localShader(): ShaderDefinition {
  return {
    id: 'local-one',
    name: 'Local shader',
    fragmentSource: 'void main() {\n  outColor = vec4(1.0);\n}',
    origin: 'local',
    parameters: [],
    parameterValues: {},
    createdAt: 1,
    updatedAt: 1,
    schemaVersion: 2,
    materialInputProfile: 'none',
  }
}

function builtinWithFloatAndColor(): ShaderDefinition {
  return {
    ...localShader(),
    id: 'builtin-controls',
    name: 'Built-in controls',
    origin: 'builtin',
    parameters: [
      { id: 'power', type: 'float', uniformName: 'uPower', label: 'Power', min: 0, max: 2, step: 0.1, defaultValue: 1 },
      { id: 'color', type: 'color', uniformName: 'uColor', label: 'Color', defaultValue: '#112233' },
    ],
    parameterValues: { power: 1, color: '#112233' },
  }
}

function repository(): ShaderRepository {
  return {
    list: vi.fn(async () => []),
    get: vi.fn(async () => undefined),
    save: vi.fn(async () => undefined),
    delete: vi.fn(async () => undefined),
  }
}

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((promiseResolve) => { resolve = promiseResolve })
  return { promise, resolve }
}

function viewer(result?: Promise<CompileResult>): ViewerPort {
  return {
    loadModel: vi.fn(async () => ({ name: 'model.glb', meshCount: 1, animationClips: [], textureSlots: [] })),
    replaceModelTexture: vi.fn(async () => []),
    restoreModelTexture: vi.fn(async () => []),
    fitModel: vi.fn(),
    resize: vi.fn(),
    compileShader: vi.fn(async () => result === undefined
      ? { status: 'valid' as const, generation: 1 }
      : result),
    updateParameter: vi.fn(),
    loadEnvironment: vi.fn(async () => undefined),
    updateEnvironment: vi.fn(),
    updateCamera: vi.fn(),
    capturePortrait: vi.fn(async () => ({
      kind: 'captured' as const,
      blob: new Blob(),
      mimeType: 'image/png' as const,
      width: 1,
      height: 1,
    })),
    selectAnimation: vi.fn(),
    setAnimationPlaying: vi.fn(),
    dispose: vi.fn(),
  }
}

const TestSourceEditor = forwardRef<ShaderSourceEditorHandle, ShaderSourceEditorProps>(
  function TestSourceEditor({ value, readOnly, onChange }, ref) {
    const textarea = useRef<HTMLTextAreaElement>(null)
    useImperativeHandle(ref, () => ({
      focusLine(line) {
        textarea.current?.focus()
        textarea.current?.setAttribute('data-focused-line', String(line))
      },
    }), [])
    return (
      <textarea
        ref={textarea}
        aria-label="Fragment shader source"
        readOnly={readOnly}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )
  },
)

function renderPanel(options: {
  builtins?: readonly ShaderDefinition[]
  repository?: ShaderRepository
  viewer?: ViewerPort
  idFactory?: () => string
} = {}) {
  const repo = options.repository ?? repository()
  const viewerPort = options.viewer ?? viewer()
  const builtins = options.builtins ?? [localShader()]
  return {
    repo,
    viewer: viewerPort,
    ...render(
      <WorkspaceProvider
        repository={repo}
        viewer={viewerPort}
        builtins={builtins}
        idFactory={options.idFactory}
      >
        <ShaderEditorPanel SourceEditor={TestSourceEditor} />
      </WorkspaceProvider>,
    ),
  }
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('ShaderEditorPanel', () => {
  it('shows only enabled runtime controls for a built-in shader', () => {
    renderPanel({ builtins: [builtinWithFloatAndColor()] })

    expect(screen.getByRole('heading', { name: 'Shader controls' })).toBeVisible()
    expect(screen.getByRole('slider', { name: /Power.*uPower/ })).toBeEnabled()
    expect(screen.getByLabelText(/Color.*uColor.*color picker/)).toBeEnabled()
    expect(screen.queryByLabelText('Shader name')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Compile' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Add parameter' })).not.toBeInTheDocument()
    expect(screen.queryByText('Shader contract')).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Fragment shader source' })).not.toBeInTheDocument()
  })

  it('shows the no-controls message for a parameterless built-in shader', () => {
    const builtin = { ...localShader(), id: 'builtin-empty', origin: 'builtin' as const }
    renderPanel({ builtins: [builtin] })

    expect(screen.getByText('This shader has no runtime controls.')).toBeVisible()
  })

  it('keeps the full editor, parameter builder, and runtime controls for a local shader', () => {
    renderPanel()

    expect(screen.getByRole('heading', { name: 'Shader editor' })).toBeVisible()
    expect(screen.getByRole('textbox', { name: 'Shader name' })).toBeEnabled()
    expect(screen.getByRole('textbox', { name: 'Fragment shader source' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Compile' })).toBeVisible()
    expect(screen.getByRole('button', { name: 'Add parameter' })).toBeVisible()
    expect(screen.getByText('Shader contract')).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Runtime controls' })).toBeVisible()
  })

  it('shows dirty state and saves a valid local draft only through explicit Save', async () => {
    const user = userEvent.setup()
    const repo = repository()
    renderPanel({ repository: repo })
    await waitFor(() => expect(screen.getByText('Valid')).toBeVisible())

    expect(screen.getByRole('button', { name: 'Save shader' })).toBeDisabled()
    await user.clear(screen.getByRole('textbox', { name: 'Shader name' }))
    expect(screen.getByRole('button', { name: 'Save shader' })).toBeDisabled()
    expect(screen.getByText('Unsaved changes')).toBeVisible()

    await user.type(screen.getByRole('textbox', { name: 'Shader name' }), 'Edited shader')
    await user.clear(screen.getByRole('textbox', { name: 'Fragment shader source' }))
    await user.type(screen.getByRole('textbox', { name: 'Fragment shader source' }), 'updated shader source')

    expect(repo.save).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save shader' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Compile' }))
    await waitFor(() => expect(screen.getByRole('button', { name: 'Save shader' })).toBeEnabled())
    await user.click(screen.getByRole('button', { name: 'Save shader' }))
    await waitFor(() => expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({
      name: 'Edited shader',
      fragmentSource: 'updated shader source',
    })))
    expect(screen.getByText('Saved')).toBeVisible()
  })

  it('disables Save until the dirty draft has compiled successfully', async () => {
    const user = userEvent.setup()
    const compile = deferred<CompileResult>()
    const repo = repository()
    renderPanel({ repository: repo, viewer: viewer(compile.promise) })

    await user.type(screen.getByRole('textbox', { name: 'Shader name' }), ' edited')
    expect(await screen.findByText('Compiling')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save shader' })).toBeDisabled()

    compile.resolve({
      status: 'error',
      generation: 1,
      diagnostics: [{ severity: 'error', message: 'Compile failed', raw: 'Compile failed' }],
    })

    expect(await screen.findByText('Error')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Save shader' })).toBeDisabled()
    expect(repo.save).not.toHaveBeenCalled()
  })

  it('renders textual compile states, diagnostics that focus a line, and canonical contract help', async () => {
    const user = userEvent.setup()
    const compile = deferred<CompileResult>()
    renderPanel({ viewer: viewer(compile.promise) })

    expect(await screen.findByRole('status', { name: 'Compile status' })).toHaveTextContent('Compiling')
    compile.resolve({
      status: 'error',
      generation: 1,
      diagnostics: [{
        severity: 'error',
        message: 'Unexpected identifier',
        editorLine: 2,
        raw: 'ERROR: 1:2: Unexpected identifier',
      }],
    })

    const compileAlert = await screen.findByRole('alert', { name: 'Compile status' })
    expect(compileAlert).toHaveTextContent('Error')
    expect(compileAlert).toHaveTextContent('Unexpected identifier')
    expect(screen.queryByRole('status', { name: 'Compile status' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Line 2: Unexpected identifier' }))
    expect(screen.getByRole('textbox', { name: 'Fragment shader source' })).toHaveFocus()
    expect(screen.getByRole('textbox', { name: 'Fragment shader source' })).toHaveAttribute('data-focused-line', '2')

    await user.click(screen.getByText('Shader contract'))
    expect(screen.getByText(/uniform float uTime;/)).toBeVisible()
    expect(screen.getByText(/out vec4 outColor;/)).toBeVisible()
    expect(screen.queryByLabelText(/vertex shader/i)).not.toBeInTheDocument()
  })
})
