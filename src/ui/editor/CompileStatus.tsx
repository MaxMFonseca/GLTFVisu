import type { WorkspaceCompileState } from '../../application/workspaceState'
import type { ShaderSourceEditorHandle } from './ShaderEditorPanel'
import type { RefObject } from 'react'

export interface CompileStatusProps {
  compile: WorkspaceCompileState
  editorRef: RefObject<ShaderSourceEditorHandle | null>
}

function statusDetails(status: WorkspaceCompileState['status']): { icon: string; text: string } {
  switch (status) {
    case 'valid': return { icon: '✓', text: 'Valid' }
    case 'error':
    case 'schema-invalid': return { icon: '!', text: 'Error' }
    case 'idle':
    case 'pending': return { icon: '…', text: 'Compiling' }
  }
}

export function CompileStatus({ compile, editorRef }: CompileStatusProps) {
  const details = statusDetails(compile.status)
  const liveRole = compile.status === 'error' || compile.status === 'schema-invalid' ? 'alert' : 'status'
  return (
    <section className={`compile-status compile-${compile.status}`} aria-label="Compile status" role={liveRole}>
      <p><span aria-hidden="true">{details.icon}</span> {details.text}</p>
      {compile.diagnostics.length > 0 && (
        <ul className="compile-diagnostics" aria-label="Compiler diagnostics">
          {compile.diagnostics.map((diagnostic, index) => {
            const line = diagnostic.editorLine ?? 1
            return (
              <li key={`${diagnostic.severity}-${line}-${index}`}>
                <button type="button" onClick={() => editorRef.current?.focusLine(line)}>
                  Line {line}: {diagnostic.message}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
