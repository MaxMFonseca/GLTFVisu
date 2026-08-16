import { useRef, type ComponentType, type RefAttributes } from 'react'
import type { CompileDiagnostic } from '../../application/ViewerPort'
import { hasDirtyFields } from '../../application/workspaceState'
import { useWorkspace } from '../../application/WorkspaceController'
import { hasLoadedModel } from '../../application/workspaceState'
import { CompileStatus } from './CompileStatus'
import { MonacoShaderEditor } from './MonacoShaderEditor'
import { ShaderContractHelp } from './ShaderContractHelp'
import { ParameterBuilder } from '../parameters/ParameterBuilder'
import { ParameterControls } from '../parameters/ParameterControls'

export interface ShaderSourceEditorHandle {
  focusLine(line: number): void
}

export interface ShaderSourceEditorProps {
  shaderId: string
  value: string
  readOnly: boolean
  diagnostics: readonly CompileDiagnostic[]
  onChange(value: string): void
}

export type ShaderSourceEditor = ComponentType<
  ShaderSourceEditorProps & RefAttributes<ShaderSourceEditorHandle>
>

export interface ShaderEditorPanelProps {
  SourceEditor?: ShaderSourceEditor
}

export function ShaderEditorPanel({ SourceEditor = MonacoShaderEditor }: ShaderEditorPanelProps) {
  const { state, commands } = useWorkspace()
  const editorRef = useRef<ShaderSourceEditorHandle>(null)

  if (state.draft.origin === 'builtin') {
    return (
      <section className="shader-editor-panel builtin-controls-panel" aria-labelledby="shader-controls-heading">
        <header className="editor-heading">
          <div>
            <p className="panel-kicker">Built-in shader</p>
            <h2 id="shader-controls-heading">Shader controls</h2>
          </div>
        </header>
        <ParameterControls />
      </section>
    )
  }

  const dirty = hasDirtyFields(state.dirty)
  const invalid = state.draft.name.trim().length === 0 || state.schemaErrors.length > 0
  const saving = state.persistence === 'saving'
  const canSave = dirty && !invalid && !saving && state.compile.status === 'valid'
  const canCapture = hasLoadedModel(state.modelLoad) && state.compile.status === 'valid'

  return (
    <section className="shader-editor-panel" aria-labelledby="editor-heading">
      <header className="editor-heading">
        <div>
          <p className="panel-kicker">Workspace</p>
          <h2 id="editor-heading">Shader editor</h2>
        </div>
        <span className="dirty-state">{dirty ? 'Unsaved changes' : 'Saved'}</span>
      </header>

      <label className="editor-field">
        <span>Shader name</span>
        <input
          type="text"
          aria-invalid={state.draft.name.trim().length === 0}
          value={state.draft.name}
          onChange={(event) => commands.editName(event.currentTarget.value)}
        />
      </label>

      <div className="editor-actions" aria-label="Shader editor actions">
        <button type="button" aria-label="Save shader" disabled={!canSave} onClick={() => void commands.save()}>
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button type="button" aria-label="Duplicate shader" onClick={() => void commands.duplicateShader()}>Duplicate</button>
        <button type="button" disabled={invalid || state.compile.status === 'pending'} onClick={() => void commands.compile()}>Compile</button>
        <button
          type="button"
          aria-label="Capture portrait"
          disabled={!canCapture}
          title={canCapture ? 'Capture portrait from viewer' : 'Requires a loaded model and valid local shader'}
          onClick={() => void commands.capturePortrait()}
        >
          Capture Portrait
        </button>
      </div>

      <div className="shader-source-editor">
        <SourceEditor
          ref={editorRef}
          shaderId={state.selectedId}
          value={state.draft.fragmentSource}
          readOnly={false}
          diagnostics={state.compile.diagnostics}
          onChange={commands.editSource}
        />
      </div>
      <CompileStatus compile={state.compile} editorRef={editorRef} />
      <ShaderContractHelp />
      <ParameterBuilder />
      <ParameterControls />
    </section>
  )
}
