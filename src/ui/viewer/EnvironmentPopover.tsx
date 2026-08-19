import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import type { WorkspaceCommands } from '../../application/commands'
import type { EnvironmentDefinition, WorkspaceEnvironmentState } from '../../domain/environment'

type EnvironmentCommands = Pick<WorkspaceCommands,
  'selectBundledEnvironment' | 'loadLocalEnvironment' | 'loadRemoteEnvironment'
  | 'setBackgroundMode' | 'setEnvironmentClearColor' | 'setEnvironmentRotation' | 'setEnvironmentIntensity'
>

export interface EnvironmentPopoverProps {
  environment: WorkspaceEnvironmentState
  environmentCatalog: readonly EnvironmentDefinition[]
  commands: EnvironmentCommands
}

function numberFrom(event: ChangeEvent<HTMLInputElement>): number | undefined {
  const value = event.currentTarget.valueAsNumber
  return Number.isFinite(value) ? value : undefined
}

export function EnvironmentPopover({ environment, environmentCatalog, commands }: EnvironmentPopoverProps) {
  const [open, setOpen] = useState(false)
  const [remoteUrl, setRemoteUrl] = useState('')
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()
  const loading = environment.status === 'loading'
  const activeBundledId = environment.activeSource?.kind === 'bundled' ? environment.activeSource.id : ''

  const close = (returnFocus = false): void => {
    setOpen(false)
    if (returnFocus) queueMicrotask(() => triggerRef.current?.focus())
  }

  useEffect(() => {
    if (!open) return
    const onPointerDown = (event: PointerEvent): void => {
      if (event.target instanceof Node && !rootRef.current?.contains(event.target)) close()
    }
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      close(true)
    }
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [open])

  function loadBundled(id: string): void {
    const definition = environmentCatalog.find((candidate) => candidate.id === id)
    if (definition !== undefined) void commands.selectBundledEnvironment(definition.id, definition.hdrUrl)
  }

  function loadLocal(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.currentTarget.files?.[0]
    event.currentTarget.value = ''
    if (file !== undefined) void commands.loadLocalEnvironment(file)
  }

  function loadRemote(): void {
    void commands.loadRemoteEnvironment(remoteUrl)
  }

  function setRotation(event: ChangeEvent<HTMLInputElement>): void {
    const value = numberFrom(event)
    if (value !== undefined) commands.setEnvironmentRotation(value)
  }

  function setIntensity(event: ChangeEvent<HTMLInputElement>): void {
    const value = numberFrom(event)
    if (value !== undefined) commands.setEnvironmentIntensity(value)
  }

  return (
    <div className="environment-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        {...(open ? { 'aria-controls': popoverId } : {})}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Environment
      </button>
      {open && (
        <div id={popoverId} className="environment-popover" role="region" aria-label="Environment settings">
          <fieldset className="environment-popover-section">
            <legend>Background</legend>
            <label><input type="radio" name="environment-background" checked={environment.settings.backgroundMode === 'skybox'} onChange={() => commands.setBackgroundMode('skybox')} /> Skybox</label>
            <label><input type="radio" name="environment-background" checked={environment.settings.backgroundMode === 'clear-color'} onChange={() => commands.setBackgroundMode('clear-color')} /> Clear color</label>
            <label className="environment-color-control">Clear color picker
              <input type="color" value={environment.settings.clearColor} onChange={(event) => commands.setEnvironmentClearColor(event.currentTarget.value)} />
            </label>
          </fieldset>

          <label className="environment-popover-section">Bundled environment
            <select aria-label="Bundled environment" value={activeBundledId} disabled={environmentCatalog.length === 0} onChange={(event) => loadBundled(event.currentTarget.value)}>
              <option value="">{environmentCatalog.length === 0 ? 'No bundled environments available' : 'Choose an environment'}</option>
              {environmentCatalog.map((definition) => <option key={definition.id} value={definition.id}>{definition.name}</option>)}
            </select>
          </label>

          <label className="environment-popover-section">Local HDR file
            <input type="file" accept=".hdr" onChange={loadLocal} />
          </label>

          <div className="environment-popover-section">
            <label htmlFor={`${popoverId}-url`}>HDR URL</label>
            <div className="environment-url-control">
              <input id={`${popoverId}-url`} type="url" value={remoteUrl} onChange={(event) => setRemoteUrl(event.currentTarget.value)} placeholder="https://example.com/environment.hdr" />
              <button type="button" onClick={loadRemote}>Load HDR URL</button>
            </div>
            <p className="environment-help">Remote HDR must be a direct HTTPS URL and allow CORS.</p>
          </div>

          <label className="environment-popover-section environment-number-control">Environment rotation
            <input aria-label="Environment rotation" type="range" min="0" max="360" step="1" value={environment.settings.rotation} onChange={setRotation} />
            <input aria-label="Environment rotation value" type="number" min="0" max="360" step="1" value={environment.settings.rotation} onChange={setRotation} />
          </label>

          <label className="environment-popover-section environment-number-control">Environment intensity
            <input aria-label="Environment intensity" type="range" min="0" max="4" step="0.1" value={environment.settings.intensity} onChange={setIntensity} />
            <input aria-label="Environment intensity value" type="number" min="0" max="4" step="0.1" value={environment.settings.intensity} onChange={setIntensity} />
          </label>

          {loading && <p className="environment-loading" role="status">Loading {environment.pendingLabel ?? 'environment'}…</p>}
          {environment.status === 'error' && <p className="environment-error" role="alert">{environment.error}</p>}
        </div>
      )}
    </div>
  )
}
