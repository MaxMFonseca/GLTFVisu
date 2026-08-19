import { useState, type ChangeEvent } from 'react'
import type { ModelTextureSlotInfo } from '../../three/modelTextures/ModelTextureRegistry'

const TEXTURE_ACCEPT = 'image/png,image/jpeg,image/webp'

export interface ModelTextureEditorProps {
  slots: readonly ModelTextureSlotInfo[]
  onReplace(slotId: string, file: File): Promise<void>
  onRestore(slotId: string): Promise<void>
}

interface MaterialTextureGroup {
  materialId: string
  materialLabel: string
  slots: ModelTextureSlotInfo[]
}

function groupByMaterial(slots: readonly ModelTextureSlotInfo[]): MaterialTextureGroup[] {
  const groups: MaterialTextureGroup[] = []
  const byId = new Map<string, MaterialTextureGroup>()
  for (const slot of slots) {
    let group = byId.get(slot.materialId)
    if (group === undefined) {
      group = { materialId: slot.materialId, materialLabel: slot.materialLabel, slots: [] }
      byId.set(slot.materialId, group)
      groups.push(group)
    }
    group.slots.push(slot)
  }
  return groups
}

function actionLabel(slot: ModelTextureSlotInfo): string {
  return `${slot.materialLabel} ${slot.label.toLowerCase()}`
}

export function ModelTextureEditor({ slots, onReplace, onRestore }: ModelTextureEditorProps) {
  const [pendingSlots, setPendingSlots] = useState<ReadonlySet<string>>(() => new Set())

  if (slots.length === 0) return null

  function markPending(slotId: string, pending: boolean): void {
    setPendingSlots((current) => {
      const next = new Set(current)
      if (pending) next.add(slotId)
      else next.delete(slotId)
      return next
    })
  }

  async function replace(slotId: string, file: File, input: HTMLInputElement): Promise<void> {
    markPending(slotId, true)
    try {
      await onReplace(slotId, file)
    } catch {
      // The workspace command reports failures; this boundary keeps event promises handled.
    } finally {
      input.value = ''
      markPending(slotId, false)
    }
  }

  async function restore(slotId: string): Promise<void> {
    markPending(slotId, true)
    try {
      await onRestore(slotId)
    } catch {
      // The workspace command reports failures; this boundary keeps event promises handled.
    } finally {
      markPending(slotId, false)
    }
  }

  function chooseReplacement(slotId: string, event: ChangeEvent<HTMLInputElement>): void {
    const input = event.currentTarget
    const file = input.files?.[0]
    if (file === undefined) {
      input.value = ''
      return
    }
    void replace(slotId, file, input)
  }

  return (
    <section className="model-texture-editor" aria-labelledby="model-textures-heading">
      <h3 id="model-textures-heading">Model textures</h3>
      {groupByMaterial(slots).map((group) => (
        <details className="model-texture-group" aria-label={group.materialLabel} key={group.materialId} open>
          <summary>{group.materialLabel}</summary>
          <ul className="model-texture-list">
            {group.slots.map((slot) => {
              const pending = pendingSlots.has(slot.id)
              const label = actionLabel(slot)
              return (
                <li className="model-texture-row" aria-busy={pending} key={slot.id}>
                  <img src={slot.previewUrl} alt={`${slot.materialLabel} ${slot.label} texture preview`} />
                  <div className="model-texture-details">
                    <span className="model-texture-channel">{slot.label}</span>
                    <span className="model-texture-status">{slot.replaced ? 'Replacement' : 'Original'}</span>
                  </div>
                  <div className="model-texture-actions">
                    <label className="button-label" data-disabled={pending}>
                      Replace {label}
                      <input
                        className="visually-hidden"
                        type="file"
                        accept={TEXTURE_ACCEPT}
                        aria-label={`Replace ${label}`}
                        disabled={pending}
                        onChange={(event) => chooseReplacement(slot.id, event)}
                      />
                    </label>
                    <button
                      type="button"
                      disabled={pending || !slot.replaced}
                      onClick={() => { void restore(slot.id) }}
                    >
                      Restore {label}
                    </button>
                  </div>
                </li>
              )
            })}
          </ul>
        </details>
      ))}
    </section>
  )
}
