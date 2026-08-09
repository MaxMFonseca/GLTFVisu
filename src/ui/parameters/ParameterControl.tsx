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

  useEffect(() => {
    if (definition.type === 'color' && typeof value === 'string') setColorText(value.toLowerCase())
  }, [definition.type, value])

  if (definition.type === 'float' || definition.type === 'integer') {
    const numericValue = typeof value === 'number' ? value : definition.defaultValue
    const update = (raw: string) => onChange(Number(raw))
    return (
      <div className="parameter-control" data-parameter-id={definition.id}>
        <p>{definition.label}</p>
        <div className="parameter-control-pair">
          <label>
            <span className="visually-hidden">{definition.label} slider</span>
            <input
              aria-label={`${definition.label} slider`}
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
            <span className="visually-hidden">{definition.label} value</span>
            <input
              aria-label={`${definition.label} value`}
              type="number"
              min={definition.min}
              max={definition.max}
              step={definition.step}
              readOnly={readOnly}
              value={numericValue}
              onChange={(event) => update(event.currentTarget.value)}
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
            <span className="visually-hidden">{definition.label} color picker</span>
            <input
              aria-label={`${definition.label} color picker`}
              type="color"
              disabled={readOnly}
              value={colorValue}
              onChange={(event) => onChange(event.currentTarget.value.toLowerCase())}
            />
          </label>
          <label>
            <span className="visually-hidden">{definition.label} hex value</span>
            <input
              aria-label={`${definition.label} hex value`}
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
