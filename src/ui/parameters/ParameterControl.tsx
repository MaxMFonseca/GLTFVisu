import { useEffect, useState } from 'react'
import type { ShaderParameterDefinition, ShaderParameterValue } from '../../domain/parameters'

export interface ParameterControlProps {
  definition: ShaderParameterDefinition
  value: ShaderParameterValue
  readOnly: boolean
  onChange(value: ShaderParameterValue): void
}

export function ParameterControl({ definition, value, readOnly, onChange }: ParameterControlProps) {
  const [colorText, setColorText] = useState(typeof value === 'string' ? value.toLowerCase() : '#000000')
  const [numberText, setNumberText] = useState(typeof value === 'number' ? String(value) : '')
  const [numberEditing, setNumberEditing] = useState(false)
  const accessibleName = `${definition.label} (${definition.uniformName})`

  useEffect(() => {
    if (definition.type === 'color' && typeof value === 'string') setColorText(value.toLowerCase())
    if ((definition.type === 'float' || definition.type === 'integer') && typeof value === 'number' && !numberEditing) {
      setNumberText(String(value))
    }
  }, [definition.type, numberEditing, value])

  if (definition.type === 'float' || definition.type === 'integer') {
    const numericValue = typeof value === 'number' ? value : definition.defaultValue
    const update = (raw: string) => onChange(Number(raw))
    return (
      <div className="parameter-control" data-parameter-id={definition.id}>
        <p>{definition.label}</p>
        <div className="parameter-control-pair">
          <label>
            <span className="visually-hidden">{accessibleName} slider</span>
            <input
              aria-label={`${accessibleName} slider`}
              type="range"
              min={definition.min}
              max={definition.max}
              step={definition.step}
              disabled={readOnly}
              value={numericValue}
              onChange={(event) => update(event.currentTarget.value)}
            />
          </label>
          <label>
            <span className="visually-hidden">{accessibleName} value</span>
            <input
              aria-label={`${accessibleName} value`}
              type="number"
              min={definition.min}
              max={definition.max}
              step={definition.step}
              readOnly={readOnly}
              value={numberEditing ? numberText : numericValue}
              onFocus={() => {
                setNumberText(String(numericValue))
                setNumberEditing(true)
              }}
              onBlur={() => {
                setNumberEditing(false)
                setNumberText(String(numericValue))
              }}
              onChange={(event) => {
                const raw = event.currentTarget.value
                setNumberText(raw)
                if (raw !== '' && Number.isFinite(Number(raw))) update(raw)
              }}
            />
          </label>
        </div>
      </div>
    )
  }

  if (definition.type === 'color') {
    const colorValue = typeof value === 'string' ? value.toLowerCase() : definition.defaultValue
    return (
      <div className="parameter-control" data-parameter-id={definition.id}>
        <p>{definition.label}</p>
        <div className="parameter-control-pair">
          <label>
            <span className="visually-hidden">{accessibleName} color picker</span>
            <input
              aria-label={`${accessibleName} color picker`}
              type="color"
              disabled={readOnly}
              value={colorValue}
              onChange={(event) => onChange(event.currentTarget.value.toLowerCase())}
            />
          </label>
          <label>
            <span className="visually-hidden">{accessibleName} hex value</span>
            <input
              aria-label={`${accessibleName} hex value`}
              type="text"
              readOnly={readOnly}
              value={colorText}
              onChange={(event) => {
                const next = event.currentTarget.value.toLowerCase()
                setColorText(next)
                if (/^#[0-9a-f]{6}$/.test(next)) onChange(next)
              }}
            />
          </label>
        </div>
      </div>
    )
  }

  return (
    <div className="parameter-control checkbox-control" data-parameter-id={definition.id}>
      <label>
        <input
          aria-label={accessibleName}
          type="checkbox"
          disabled={readOnly}
          checked={typeof value === 'boolean' ? value : definition.defaultValue}
          onChange={(event) => onChange(event.currentTarget.checked)}
        />
        <span>{definition.label}</span>
      </label>
    </div>
  )
}
