import { useEffect, useId, useRef, useState, type ChangeEvent, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useWorkspace } from '../../application/WorkspaceController'
import type { ShaderDefinition } from '../../domain/shader'
import { ShaderCard, type PortraitUrlPort } from './ShaderCard'

export interface ShaderLibraryProps {
  portraitUrls?: PortraitUrlPort
}

interface DeleteTarget {
  id: string
  name: string
}

function selectedDraftInList(
  shaders: readonly ShaderDefinition[],
  selectedId: string,
  draft: ShaderDefinition,
): readonly ShaderDefinition[] {
  if (draft.origin !== 'local') return shaders
  return shaders.map((shader) => shader.id === selectedId ? draft : shader)
}

function readFileText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text()
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onerror = () => reject(reader.error ?? new Error('File reading failed'))
    reader.onload = () => typeof reader.result === 'string'
      ? resolve(reader.result)
      : reject(new Error('File reading returned no text'))
    reader.readAsText(file)
  })
}

export function ShaderLibrary({ portraitUrls }: ShaderLibraryProps) {
  const { state, commands } = useWorkspace()
  const [deleteConfirmation, setDeleteConfirmation] = useState<DeleteTarget>()
  const [importError, setImportError] = useState<string>()
  const importInput = useRef<HTMLInputElement>(null)
  const libraryRoot = useRef<HTMLElement>(null)
  const cancelDeleteButton = useRef<HTMLButtonElement>(null)
  const confirmDeleteButton = useRef<HTMLButtonElement>(null)
  const previousFocus = useRef<HTMLElement | undefined>(undefined)
  const deleteHeadingId = useId()
  const deleteDescriptionId = useId()
  const selectedIsLocal = state.draft.origin === 'local'
  const canCapture = selectedIsLocal
    && state.modelLoad.status === 'loaded'
    && state.compile.status === 'valid'
  const locals = selectedDraftInList(state.locals, state.selectedId, state.draft)

  useEffect(() => {
    if (deleteConfirmation === undefined) return
    const root = libraryRoot.current
    const background = root?.closest<HTMLElement>('.workspace-shell') ?? root
    const previousAriaHidden = background?.getAttribute('aria-hidden') ?? null
    const previouslyInert = background?.inert ?? false
    const hadInertAttribute = background?.hasAttribute('inert') ?? false
    if (background !== undefined && background !== null) {
      background.inert = true
      background.setAttribute('inert', '')
      background.setAttribute('aria-hidden', 'true')
    }
    cancelDeleteButton.current?.focus()
    return () => {
      if (background !== undefined && background !== null) {
        background.inert = previouslyInert
        if (!hadInertAttribute) background.removeAttribute('inert')
        if (previousAriaHidden === null) background.removeAttribute('aria-hidden')
        else background.setAttribute('aria-hidden', previousAriaHidden)
      }
      if (previousFocus.current?.isConnected) previousFocus.current.focus()
      previousFocus.current = undefined
    }
  }, [deleteConfirmation])

  function beginDelete(): void {
    if (!selectedIsLocal) return
    previousFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : undefined
    setDeleteConfirmation({ id: state.draft.id, name: state.draft.name })
  }

  function handleDeleteDialogKeyDown(event: KeyboardEvent<HTMLDivElement>): void {
    if (event.key === 'Escape') {
      event.preventDefault()
      setDeleteConfirmation(undefined)
      return
    }
    if (event.key !== 'Tab') return
    const cancel = cancelDeleteButton.current
    const confirm = confirmDeleteButton.current
    if (cancel === null || confirm === null) return
    if (event.shiftKey && document.activeElement === cancel) {
      event.preventDefault()
      confirm.focus()
    } else if (!event.shiftKey && document.activeElement === confirm) {
      event.preventDefault()
      cancel.focus()
    }
  }

  async function importFile(event: ChangeEvent<HTMLInputElement>): Promise<void> {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file === undefined) return
    try {
      setImportError(undefined)
      await commands.importShader(await readFileText(file))
    } catch {
      setImportError('The selected shader file could not be read.')
    }
  }

  return (
    <section ref={libraryRoot} className="shader-library" aria-label="Shader library">
      <div className="panel-heading">
        <div>
          <p className="panel-kicker">Library</p>
          <h1>Shaders</h1>
        </div>
        <button type="button" className="icon-button" title="Create shader" aria-label="Create shader" onClick={() => void commands.createShader()}>＋</button>
      </div>

      <div className="library-actions" aria-label="Shader actions">
        <button type="button" onClick={() => void commands.duplicateShader()}>Duplicate shader</button>
        <button type="button" onClick={() => importInput.current?.click()}>Import shader</button>
        <input ref={importInput} className="visually-hidden" type="file" accept="application/json,.json" aria-label="Import shader file" onChange={(event) => void importFile(event)} />
        <button type="button" onClick={() => void commands.exportShader()}>Export shader</button>
        <button
          type="button"
          disabled={!canCapture}
          title={canCapture ? 'Capture portrait from viewer' : 'Requires a loaded model and valid local shader'}
          onClick={() => void commands.capturePortrait()}
        >
          Capture portrait
        </button>
        <button type="button" disabled={!selectedIsLocal} onClick={beginDelete}>Delete shader</button>
      </div>

      {importError !== undefined && <p className="panel-message panel-error" role="alert">{importError}</p>}

      <section className="shader-group" aria-labelledby="built-in-shaders-heading">
        <h2 id="built-in-shaders-heading">Built-in</h2>
        <ul className="shader-card-grid">
          {state.builtins.map((shader) => (
            <ShaderCard
              key={shader.id}
              shader={shader}
              selected={shader.id === state.selectedId}
              onSelect={commands.selectShader}
              urls={portraitUrls}
            />
          ))}
        </ul>
      </section>

      <section className="shader-group" aria-labelledby="local-shaders-heading">
        <h2 id="local-shaders-heading">Local</h2>
        {state.hydration === 'loading' && <p className="panel-message" role="status">Loading local shaders…</p>}
        {state.hydration === 'error' && <p className="panel-message panel-error">Local shaders could not be loaded.</p>}
        {state.hydration !== 'loading' && locals.length === 0 && (
          <p className="panel-message">Create a shader or duplicate a built-in to start a local version.</p>
        )}
        {locals.length > 0 && (
          <ul className="shader-card-grid">
            {locals.map((shader) => (
              <ShaderCard
                key={shader.id}
                shader={shader}
                selected={shader.id === state.selectedId}
                onSelect={commands.selectShader}
                urls={portraitUrls}
              />
            ))}
          </ul>
        )}
      </section>
      {deleteConfirmation !== undefined && createPortal(
        <div
          className="delete-confirmation"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby={deleteHeadingId}
          aria-describedby={deleteDescriptionId}
          onKeyDown={handleDeleteDialogKeyDown}
        >
          <h2 id={deleteHeadingId}>Delete {deleteConfirmation.name}?</h2>
          <p id={deleteDescriptionId}>This removes the local shader.</p>
          <div>
            <button ref={cancelDeleteButton} type="button" onClick={() => setDeleteConfirmation(undefined)}>Cancel</button>
            <button
              ref={confirmDeleteButton}
              type="button"
              className="danger-button"
              aria-label="Confirm delete"
              onClick={() => {
                const targetId = deleteConfirmation.id
                setDeleteConfirmation(undefined)
                void commands.deleteShader(targetId)
              }}
            >
              Delete
            </button>
          </div>
        </div>,
        document.body,
      )}
    </section>
  )
}
