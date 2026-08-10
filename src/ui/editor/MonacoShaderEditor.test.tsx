import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import type { EditorProps, Monaco } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { CompileDiagnostic } from '../../application/ViewerPort'
import { SHADER_DIAGNOSTIC_OWNER } from '../../editor/monacoDiagnostics'
import { MonacoShaderEditor } from './MonacoShaderEditor'
import type { ShaderSourceEditorProps } from './ShaderEditorPanel'

const editorHarness = vi.hoisted(() => ({
  props: undefined as EditorProps | undefined,
  mount: undefined as ((instance: unknown, monaco: unknown) => void) | undefined,
  configureLoader: vi.fn(),
  createWorker: vi.fn(() => ({ kind: 'editor-worker' })),
  localMonaco: { editor: { create: vi.fn() } },
}))

vi.mock('@monaco-editor/react', async () => {
  const React = await import('react')
  function TestMonacoEditor(props: EditorProps) {
    const initialOnMount = React.useRef(props.onMount)
    editorHarness.props = props
    editorHarness.mount = (instance, monaco) => initialOnMount.current?.(
      instance as editor.IStandaloneCodeEditor,
      monaco as Monaco,
    )
    return React.createElement(React.Fragment, null, props.loading)
  }
  return { default: TestMonacoEditor, loader: { config: editorHarness.configureLoader } }
})

vi.mock('monaco-editor/esm/vs/editor/editor.api.js', () => editorHarness.localMonaco)

vi.mock('monaco-editor/esm/vs/editor/editor.worker?worker', () => ({
  default: editorHarness.createWorker,
}))

function editorProps(
  shaderId: string,
  value: string,
  diagnostics: readonly CompileDiagnostic[] = [],
  onChange = vi.fn(),
): ShaderSourceEditorProps {
  return {
    shaderId,
    value,
    readOnly: false,
    diagnostics,
    onChange,
  } as ShaderSourceEditorProps
}

afterEach(() => {
  cleanup()
  editorHarness.props = undefined
  editorHarness.mount = undefined
  vi.clearAllMocks()
})

describe('MonacoShaderEditor', () => {
  it('configures Monaco from the local package with a bundled editor worker', async () => {
    render(<MonacoShaderEditor {...editorProps('shader-a', 'initial source')} />)

    await waitFor(() => expect(editorHarness.configureLoader).toHaveBeenCalledWith({
      monaco: editorHarness.localMonaco,
    }))

    expect(self.MonacoEnvironment?.getWorker?.('workerMain.js', 'glsl')).toEqual({ kind: 'editor-worker' })
    expect(editorHarness.createWorker).toHaveBeenCalledOnce()
  })

  it('keeps an editable controlled textarea while Monaco initialization remains pending', async () => {
    const onChange = vi.fn()
    render(<MonacoShaderEditor {...editorProps('shader-a', 'initial source', [], onChange)} />)

    await waitFor(() => expect(editorHarness.props).toBeDefined())
    const loadingEditor = screen.getByRole('textbox', { name: 'Fragment shader source' })
    expect(loadingEditor).toHaveValue('initial source')
    fireEvent.change(loadingEditor, { target: { value: 'edited while loading' } })

    expect(onChange).toHaveBeenCalledWith('edited while loading')
    expect(editorHarness.props?.loading).not.toBe('Loading...')
    expect(editorHarness.props?.options).toMatchObject({ ariaLabel: 'Fragment shader source' })
  })

  it('assigns distinct model paths so shader selections cannot share an undo stack', async () => {
    const { rerender } = render(<MonacoShaderEditor {...editorProps('shader one', 'first')} />)
    await waitFor(() => expect(editorHarness.props?.path).toBeDefined())
    const firstPath = editorHarness.props?.path

    rerender(<MonacoShaderEditor {...editorProps('shader/two', 'second')} />)
    await waitFor(() => expect(editorHarness.props?.path).not.toBe(firstPath))

    expect(firstPath).toBe('inmemory://shader/shader%20one.frag')
    expect(editorHarness.props?.path).toBe('inmemory://shader/shader%2Ftwo.frag')
    expect(editorHarness.props?.saveViewState).toBe(true)
  })

  it('applies the latest diagnostics at mount and after later diagnostic changes', async () => {
    const latest: CompileDiagnostic = {
      severity: 'error',
      message: 'Latest compile error',
      editorLine: 2,
      raw: 'latest',
    }
    const later: CompileDiagnostic = {
      severity: 'warning',
      message: 'Later warning',
      editorLine: 1,
      raw: 'later',
    }
    const { rerender } = render(<MonacoShaderEditor {...editorProps('shader-a', 'line one\nline two')} />)
    await waitFor(() => expect(editorHarness.mount).toBeDefined())
    rerender(<MonacoShaderEditor {...editorProps('shader-a', 'line one\nline two', [latest])} />)

    const model = {
      getLineCount: () => 2,
      getLineMaxColumn: (line: number) => line === 2 ? 9 : 5,
    } as editor.ITextModel
    const instance = { getModel: () => model } as editor.IStandaloneCodeEditor
    const setModelMarkers = vi.fn()
    const monaco = {
      editor: { setModelMarkers },
      MarkerSeverity: { Error: 8, Warning: 4 },
    } as unknown as Monaco

    act(() => editorHarness.mount?.(instance, monaco))
    expect(setModelMarkers).toHaveBeenLastCalledWith(model, SHADER_DIAGNOSTIC_OWNER, [
      expect.objectContaining({ message: 'Latest compile error', startLineNumber: 2 }),
    ])

    rerender(<MonacoShaderEditor {...editorProps('shader-a', 'line one\nline two', [later])} />)
    expect(setModelMarkers).toHaveBeenLastCalledWith(model, SHADER_DIAGNOSTIC_OWNER, [
      expect.objectContaining({ message: 'Later warning', startLineNumber: 1 }),
    ])
  })
})
