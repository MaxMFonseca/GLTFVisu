import { useEffect, useId, useRef, useState, type ChangeEvent } from 'react'
import type { WorkspaceCommands } from '../../application/commands'
import {
  DEFAULT_CAMERA_SETTINGS,
  normalizeCameraSettings,
  type CameraSettings,
} from '../../domain/camera'

type CameraCommands = Pick<WorkspaceCommands, 'updateCamera'>

export interface CameraPopoverProps {
  commands: CameraCommands
}

export function CameraPopover({ commands }: CameraPopoverProps) {
  const [open, setOpen] = useState(false)
  const [settings, setSettings] = useState<CameraSettings>({ ...DEFAULT_CAMERA_SETTINGS })
  const rootRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)
  const popoverId = useId()

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

  function update(patch: Partial<CameraSettings>): void {
    const next = normalizeCameraSettings({ ...settings, ...patch })
    setSettings(next)
    commands.updateCamera(next)
  }

  function updateNumber(key: 'near' | 'far' | 'fov' | 'zoom', event: ChangeEvent<HTMLInputElement>): void {
    const value = event.currentTarget.valueAsNumber
    if (Number.isFinite(value)) update({ [key]: value })
  }

  return (
    <div className="camera-control" ref={rootRef}>
      <button
        ref={triggerRef}
        type="button"
        {...(open ? { 'aria-controls': popoverId } : {})}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        Camera
      </button>
      {open && (
        <div id={popoverId} className="camera-popover" role="region" aria-label="Camera settings">
          <fieldset className="camera-popover-section">
            <legend>Projection</legend>
            <label><input type="radio" name="camera-projection" checked={settings.projection === 'perspective'} onChange={() => update({ projection: 'perspective' })} /> Perspective</label>
            <label><input type="radio" name="camera-projection" checked={settings.projection === 'orthographic'} onChange={() => update({ projection: 'orthographic' })} /> Orthographic</label>
          </fieldset>

          {settings.projection === 'perspective' && (
            <CameraNumberControl label="Field of view" valueLabel="Field of view value" value={settings.fov} min={1} max={179} step={1} onChange={(event) => updateNumber('fov', event)} />
          )}
          {settings.projection === 'orthographic' && (
            <CameraNumberControl label="Orthographic zoom" valueLabel="Orthographic zoom value" value={settings.zoom} min={0.01} max={100} step={0.01} onChange={(event) => updateNumber('zoom', event)} />
          )}
          <CameraNumberControl label="Near clipping plane" valueLabel="Near clipping plane value" value={settings.near} min={0.0001} max={settings.far - 0.0001} step={0.01} onChange={(event) => updateNumber('near', event)} />
          <CameraNumberControl label="Far clipping plane" valueLabel="Far clipping plane value" value={settings.far} min={settings.near + 0.0001} max={1_000_000_000} step={1} onChange={(event) => updateNumber('far', event)} />
        </div>
      )}
    </div>
  )
}

interface CameraNumberControlProps {
  label: string
  valueLabel: string
  value: number
  min: number
  max: number
  step: number
  onChange(event: ChangeEvent<HTMLInputElement>): void
}

function CameraNumberControl({ label, valueLabel, value, min, max, step, onChange }: CameraNumberControlProps) {
  return (
    <label className="camera-popover-section camera-number-control">{label}
      <input aria-label={label} type="range" min={min} max={max} step={step} value={value} onChange={onChange} />
      <input aria-label={valueLabel} type="number" min={min} max={max} step={step} value={value} onChange={onChange} />
    </label>
  )
}
