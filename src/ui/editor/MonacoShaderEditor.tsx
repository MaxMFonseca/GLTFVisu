import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  type ComponentType,
} from 'react'
import type { Monaco, EditorProps, OnMount } from '@monaco-editor/react'
import type { editor } from 'monaco-editor'
import EditorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import { registerGlslLanguage } from '../../editor/glslLanguage'
import { applyMonacoDiagnostics } from '../../editor/monacoDiagnostics'
import type { ShaderSourceEditorHandle, ShaderSourceEditorProps } from './ShaderEditorPanel'

type MonacoEditorComponent = ComponentType<EditorProps>

async function loadMonacoEditor(): Promise<MonacoEditorComponent> {
  self.MonacoEnvironment = {
    getWorker: () => new EditorWorker(),
  }
  const [reactMonaco, monaco] = await Promise.all([
    import('@monaco-editor/react'),
    import('monaco-editor/esm/vs/editor/editor.api.js'),
  ])
  reactMonaco.loader.config({ monaco })
  return reactMonaco.default
}

function shaderModelPath(shaderId: string): string {
  return `inmemory://shader/${encodeURIComponent(shaderId)}.frag`
}

export const MonacoShaderEditor = forwardRef<ShaderSourceEditorHandle, ShaderSourceEditorProps>(
  function MonacoShaderEditor({ shaderId, value, readOnly, diagnostics, onChange }, ref) {
    const [Editor, setEditor] = useState<MonacoEditorComponent>()
    const [loadFailed, setLoadFailed] = useState(false)
    const fallback = useRef<HTMLTextAreaElement>(null)
    const editorInstance = useRef<editor.IStandaloneCodeEditor | undefined>(undefined)
    const monacoInstance = useRef<Monaco | undefined>(undefined)
    const latestDiagnostics = useRef(diagnostics)
    latestDiagnostics.current = diagnostics

    useEffect(() => {
      let active = true
      void loadMonacoEditor().then(
        (component) => { if (active) setEditor(() => component) },
        () => { if (active) setLoadFailed(true) },
      )
      return () => { active = false }
    }, [])

    useEffect(() => {
      const model = editorInstance.current?.getModel()
      if (model !== null && model !== undefined && monacoInstance.current !== undefined) {
        applyMonacoDiagnostics(monacoInstance.current, model, diagnostics)
      }
    }, [diagnostics])

    useImperativeHandle(ref, () => ({
      focusLine(line) {
        const instance = editorInstance.current
        if (instance === undefined) {
          fallback.current?.focus()
          return
        }
        const safeLine = Math.max(1, line)
        instance.revealLineInCenter(safeLine)
        instance.setPosition({ lineNumber: safeLine, column: 1 })
        instance.focus()
      },
    }), [])

    const mount: OnMount = (instance, monaco) => {
      editorInstance.current = instance
      monacoInstance.current = monaco
      const model = instance.getModel()
      if (model !== null) applyMonacoDiagnostics(monaco, model, latestDiagnostics.current)
    }

    const loadingEditor = (
      <textarea
        ref={fallback}
        className="shader-editor-fallback"
        aria-label="Fragment shader source"
        aria-busy={!loadFailed}
        readOnly={readOnly}
        spellCheck={false}
        value={value}
        onChange={(event) => onChange(event.currentTarget.value)}
      />
    )

    if (Editor === undefined || loadFailed) return loadingEditor

    return (
      <Editor
        height="18rem"
        aria-label="Fragment shader source"
        beforeMount={registerGlslLanguage}
        defaultLanguage="glsl"
        loading={loadingEditor}
        onMount={mount}
        onChange={(nextValue) => onChange(nextValue ?? '')}
        options={{
          ariaLabel: 'Fragment shader source',
          automaticLayout: true,
          find: { addExtraSpaceOnTop: false },
          lineNumbers: 'on',
          minimap: { enabled: false },
          readOnly,
          scrollBeyondLastLine: false,
          wordWrap: 'on',
        }}
        path={shaderModelPath(shaderId)}
        saveViewState
        theme="vs-dark"
        value={value}
      />
    )
  },
)
