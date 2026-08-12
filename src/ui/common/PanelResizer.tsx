import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

const KEYBOARD_STEP = 16

export interface PanelResizerProps {
  side: 'left' | 'right'
  panelName: string
  panelId: string
  width: number
  minWidth: number
  maxWidth: number
  collapsed: boolean
  onWidthChange(width: number): void
  onCollapsedChange(collapsed: boolean): void
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}

export function PanelResizer({
  side,
  panelName,
  panelId,
  width,
  minWidth,
  maxWidth,
  collapsed,
  onWidthChange,
  onCollapsedChange,
}: PanelResizerProps) {
  const dragStart = useRef<{ x: number; width: number } | undefined>(undefined)

  function updateFromPointer(event: PointerEvent<HTMLDivElement>): void {
    const start = dragStart.current
    if (start === undefined || collapsed) return
    const delta = side === 'left' ? event.clientX - start.x : start.x - event.clientX
    onWidthChange(clamp(start.width + delta, minWidth, maxWidth))
  }

  function resizeWithKeyboard(event: KeyboardEvent<HTMLDivElement>): void {
    if (collapsed) return
    const growKey = side === 'left' ? 'ArrowRight' : 'ArrowLeft'
    const shrinkKey = side === 'left' ? 'ArrowLeft' : 'ArrowRight'
    let nextWidth: number | undefined
    if (event.key === growKey) nextWidth = width + KEYBOARD_STEP
    if (event.key === shrinkKey) nextWidth = width - KEYBOARD_STEP
    if (event.key === 'Home') nextWidth = minWidth
    if (event.key === 'End') nextWidth = maxWidth
    if (nextWidth === undefined) return
    event.preventDefault()
    onWidthChange(clamp(nextWidth, minWidth, maxWidth))
  }

  const collapseLabel = `${collapsed ? 'Expand' : 'Collapse'} ${panelName}`
  const collapseGlyph = side === 'left'
    ? collapsed ? '›' : '‹'
    : collapsed ? '‹' : '›'

  return (
    <div className={`panel-divider panel-divider-${side}`}>
      <div
        className="panel-resizer"
        role="separator"
        aria-label={`Resize ${panelName}`}
        aria-controls={panelId}
        aria-orientation="vertical"
        aria-valuemin={minWidth}
        aria-valuemax={maxWidth}
        aria-valuenow={width}
        aria-disabled={collapsed}
        tabIndex={collapsed ? -1 : 0}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={(event) => {
          if (collapsed) return
          dragStart.current = { x: event.clientX, width }
          event.currentTarget.setPointerCapture?.(event.pointerId)
        }}
        onPointerMove={updateFromPointer}
        onPointerUp={(event) => {
          dragStart.current = undefined
          event.currentTarget.releasePointerCapture?.(event.pointerId)
        }}
        onPointerCancel={() => { dragStart.current = undefined }}
      />
      <button
        type="button"
        className="panel-collapse-button"
        aria-label={collapseLabel}
        aria-controls={panelId}
        aria-expanded={!collapsed}
        title={collapseLabel}
        onClick={() => onCollapsedChange(!collapsed)}
      >
        {collapseGlyph}
      </button>
    </div>
  )
}
