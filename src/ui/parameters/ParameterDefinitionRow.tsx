import { useId } from 'react'
import type { ShaderParameterDefinition } from '../../domain/parameters'
import type { ParameterDefinitionValidationError } from '../../domain/uniformValidation'

export interface ParameterDefinitionRowProps {
  definition: ShaderParameterDefinition
  index: number
  total: number
  errors: readonly ParameterDefinitionValidationError[]
  readOnly: boolean
  onChange(definition: ShaderParameterDefinition): void
  onRemove(): void
  onMove(direction: -1 | 1): void
  onTypeChange(type: ShaderParameterDefinition['type']): void
}

const FIELD_NAMES: Record<ParameterDefinitionValidationError['field'], string> = {
  label: 'Label',
  uniformName: 'Uniform',
  min: 'Minimum',
  max: 'Maximum',
  step: 'Step',
  defaultValue: 'Default',
}

function numericValue(value: number): number | '' {
  return Number.isFinite(value) ? value : ''
}

function readNumber(value: string): number {
  return value.trim() === '' ? Number.NaN : Number(value)
}

export function ParameterDefinitionRow({
  definition,
  index,
  total,
  errors,
  readOnly,
  onChange,
  onRemove,
  onMove,
  onTypeChange,
}: ParameterDefinitionRowProps) {
  const errorId = useId()
  const number = index + 1
  const errorsFor = (field: ParameterDefinitionValidationError['field']) => errors.filter((error) => error.field === field)
  const fieldState = (field: ParameterDefinitionValidationError['field']) => {
    const fieldErrors = errorsFor(field)
    return {
      'aria-invalid': fieldErrors.length > 0,
      'aria-describedby': fieldErrors.length > 0 ? errorId : undefined,
    } as const
  }

  return (
    <fieldset
      className="parameter-definition-row"
      data-parameter-id={definition.id}
      data-testid={`parameter-${definition.id}`}
    >
      <legend>Parameter {number}</legend>
      <div className="parameter-row-actions">
        <button type="button" aria-label={`Move parameter ${number} up`} disabled={readOnly || index === 0} onClick={() => onMove(-1)}>↑</button>
        <button type="button" aria-label={`Move parameter ${number} down`} disabled={readOnly || index === total - 1} onClick={() => onMove(1)}>↓</button>
        <button type="button" aria-label={`Remove parameter ${number}`} disabled={readOnly} onClick={onRemove}>Remove</button>
      </div>
      <label>
        <span>Label</span>
        <input
          {...fieldState('label')}
          aria-label={`Parameter ${number} label`}
          readOnly={readOnly}
          value={definition.label}
          onChange={(event) => onChange({ ...definition, label: event.currentTarget.value })}
        />
      </label>
      <label>
        <span>Uniform</span>
        <input
          {...fieldState('uniformName')}
          aria-label={`Parameter ${number} uniform`}
          readOnly={readOnly}
          spellCheck={false}
          value={definition.uniformName}
          onChange={(event) => onChange({ ...definition, uniformName: event.currentTarget.value })}
        />
      </label>
      <label>
        <span>Type</span>
        <select
          aria-label={`Parameter ${number} type`}
          disabled={readOnly}
          value={definition.type}
          onChange={(event) => onTypeChange(event.currentTarget.value as ShaderParameterDefinition['type'])}
        >
          <option value="float">Float</option>
          <option value="integer">Integer</option>
          <option value="color">Color</option>
          <option value="boolean">Boolean</option>
        </select>
      </label>

      {(definition.type === 'float' || definition.type === 'integer') && (
        <div className="numeric-definition-grid">
          <label>
            <span>Minimum</span>
            <input
              {...fieldState('min')}
              aria-label={`Parameter ${number} minimum`}
              type="number"
              readOnly={readOnly}
              value={numericValue(definition.min)}
              onChange={(event) => onChange({ ...definition, min: readNumber(event.currentTarget.value) })}
            />
          </label>
          <label>
            <span>Maximum</span>
            <input
              {...fieldState('max')}
              aria-label={`Parameter ${number} maximum`}
              type="number"
              readOnly={readOnly}
              value={numericValue(definition.max)}
              onChange={(event) => onChange({ ...definition, max: readNumber(event.currentTarget.value) })}
            />
          </label>
          <label>
            <span>Step</span>
            <input
              {...fieldState('step')}
              aria-label={`Parameter ${number} step`}
              type="number"
              readOnly={readOnly}
              value={numericValue(definition.step)}
              onChange={(event) => onChange({ ...definition, step: readNumber(event.currentTarget.value) })}
            />
          </label>
          <label>
            <span>Default</span>
            <input
              {...fieldState('defaultValue')}
              aria-label={`Parameter ${number} default`}
              type="number"
              readOnly={readOnly}
              value={numericValue(definition.defaultValue)}
              onChange={(event) => onChange({ ...definition, defaultValue: readNumber(event.currentTarget.value) })}
            />
          </label>
        </div>
      )}

      {definition.type === 'color' && (
        <label>
          <span>Default color</span>
          <input
            {...fieldState('defaultValue')}
            aria-label={`Parameter ${number} default color`}
            type="color"
            disabled={readOnly}
            value={definition.defaultValue}
            onChange={(event) => onChange({ ...definition, defaultValue: event.currentTarget.value.toLowerCase() })}
          />
        </label>
      )}

      {definition.type === 'boolean' && (
        <label className="checkbox-field">
          <input
            aria-label={`Parameter ${number} default`}
            type="checkbox"
            disabled={readOnly}
            checked={definition.defaultValue}
            onChange={(event) => onChange({ ...definition, defaultValue: event.currentTarget.checked })}
          />
          <span>Enabled by default</span>
        </label>
      )}

      {errors.length > 0 && (
        <ul id={errorId} className="parameter-errors">
          {errors.map((error, errorIndex) => (
            <li key={`${error.field}-${error.code}-${errorIndex}`}>{FIELD_NAMES[error.field]}: {error.message}</li>
          ))}
        </ul>
      )}
    </fieldset>
  )
}
