import type { editor } from 'monaco-editor'
import type { Monaco } from '@monaco-editor/react'
import type { CompileDiagnostic } from '../application/ViewerPort'

export const SHADER_DIAGNOSTIC_OWNER = 'shader-compiler'

/** Replaces compiler markers for the one editable fragment model. */
export function applyMonacoDiagnostics(
  monaco: Pick<Monaco, 'editor' | 'MarkerSeverity'>,
  model: editor.ITextModel,
  diagnostics: readonly CompileDiagnostic[],
): void {
  monaco.editor.setModelMarkers(model, SHADER_DIAGNOSTIC_OWNER, diagnostics.map((diagnostic) => {
    const line = Math.max(1, Math.min(diagnostic.editorLine ?? 1, model.getLineCount()))
    return {
      severity: diagnostic.severity === 'warning'
        ? monaco.MarkerSeverity.Warning
        : monaco.MarkerSeverity.Error,
      message: diagnostic.message,
      startLineNumber: line,
      startColumn: 1,
      endLineNumber: line,
      endColumn: model.getLineMaxColumn(line),
    }
  }))
}
