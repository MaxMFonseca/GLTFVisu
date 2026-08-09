import { createDefaultValue, normalizeParameterValue, type ShaderParameterDefinition, type ShaderParameterValue } from '../../domain/parameters'
import { useWorkspace } from '../../application/WorkspaceController'
import { ParameterDefinitionRow } from './ParameterDefinitionRow'

export interface ParameterBuilderProps {
  idFactory?: () => string
}

function defaultId(): string {
  return crypto.randomUUID()
}

function nextUniformName(definitions: readonly ShaderParameterDefinition[]): string {
  const names = new Set(definitions.map((definition) => definition.uniformName))
  let number = definitions.length + 1
  while (names.has(`uParameter${number}`)) number += 1
  return `uParameter${number}`
}

function newParameter(id: string, definitions: readonly ShaderParameterDefinition[]): ShaderParameterDefinition {
  const number = definitions.length + 1
  return {
    id,
    type: 'float',
    uniformName: nextUniformName(definitions),
    label: `Parameter ${number}`,
    min: 0,
    max: 1,
    step: 0.01,
    defaultValue: 0.5,
  }
}

function numericDefinition(
  definition: ShaderParameterDefinition,
  type: 'float' | 'integer',
): ShaderParameterDefinition {
  const currentDefault = typeof definition.defaultValue === 'number' ? definition.defaultValue : 0
  if (type === 'float') {
    return {
      id: definition.id,
      uniformName: definition.uniformName,
      label: definition.label,
      type,
      min: definition.type === 'integer' ? definition.min : 0,
      max: definition.type === 'integer' ? definition.max : 1,
      step: definition.type === 'integer' ? definition.step : 0.01,
      defaultValue: currentDefault,
    }
  }
  const minimum = definition.type === 'float' || definition.type === 'integer' ? Math.round(definition.min) : 0
  const maximumCandidate = definition.type === 'float' || definition.type === 'integer' ? Math.round(definition.max) : 10
  const maximum = Math.max(minimum, maximumCandidate)
  return {
    id: definition.id,
    uniformName: definition.uniformName,
    label: definition.label,
    type,
    min: minimum,
    max: maximum,
    step: definition.type === 'float' || definition.type === 'integer'
      ? Math.max(1, Math.round(definition.step))
      : 1,
    defaultValue: Math.min(maximum, Math.max(minimum, Math.round(currentDefault))),
  }
}

function changeType(
  definition: ShaderParameterDefinition,
  type: ShaderParameterDefinition['type'],
): ShaderParameterDefinition {
  if (definition.type === type) return definition
  if (type === 'float' || type === 'integer') return numericDefinition(definition, type)
  if (type === 'color') {
    return {
      id: definition.id,
      uniformName: definition.uniformName,
      label: definition.label,
      type,
      defaultValue: definition.type === 'color' ? definition.defaultValue : '#ffffff',
    }
  }
  return {
    id: definition.id,
    uniformName: definition.uniformName,
    label: definition.label,
    type,
    defaultValue: definition.type === 'boolean' ? definition.defaultValue : false,
  }
}

function migratedValues(
  previous: ShaderParameterDefinition,
  next: ShaderParameterDefinition,
  values: Readonly<Record<string, ShaderParameterValue>>,
): Record<string, ShaderParameterValue> {
  const migrated = { ...values }
  const current = values[previous.id] ?? values[previous.uniformName] ?? createDefaultValue(previous)
  if (previous.uniformName !== next.uniformName) delete migrated[previous.uniformName]
  migrated[next.id] = normalizeParameterValue(next, current)
  return migrated
}

export function ParameterBuilder({ idFactory = defaultId }: ParameterBuilderProps) {
  const { state, commands } = useWorkspace()
  const definitions = state.draft.parameters
  const readOnly = state.draft.origin === 'builtin'

  function add(): void {
    const definition = newParameter(idFactory(), definitions)
    commands.editSchema(
      [...definitions, definition],
      { ...state.draft.parameterValues, [definition.id]: createDefaultValue(definition) },
    )
  }

  function update(index: number, definition: ShaderParameterDefinition): void {
    const previous = definitions[index]
    if (previous === undefined) return
    const next = definitions.map((candidate, candidateIndex) => candidateIndex === index ? definition : candidate)
    commands.editSchema(next, migratedValues(previous, definition, state.draft.parameterValues))
  }

  function remove(index: number): void {
    const removed = definitions[index]
    if (removed === undefined) return
    const values = { ...state.draft.parameterValues }
    delete values[removed.id]
    delete values[removed.uniformName]
    commands.editSchema(definitions.filter((_, candidateIndex) => candidateIndex !== index), values)
  }

  function move(index: number, direction: -1 | 1): void {
    const target = index + direction
    if (target < 0 || target >= definitions.length) return
    const reordered = [...definitions]
    const current = reordered[index]
    const counterpart = reordered[target]
    if (current === undefined || counterpart === undefined) return
    reordered[index] = counterpart
    reordered[target] = current
    commands.editSchema(reordered, state.draft.parameterValues)
  }

  return (
    <section className="parameter-builder" aria-labelledby="parameter-definitions-heading">
      <div className="parameter-section-heading">
        <h3 id="parameter-definitions-heading">Parameter definitions</h3>
        <button type="button" disabled={readOnly} onClick={add}>Add parameter</button>
      </div>
      {definitions.length === 0 && <p className="panel-message">No visual parameters defined.</p>}
      {definitions.map((definition, index) => (
        <ParameterDefinitionRow
          key={definition.id}
          definition={definition}
          index={index}
          total={definitions.length}
          errors={state.schemaErrors.filter((error) => error.parameterId === definition.id)}
          readOnly={readOnly}
          onChange={(next) => update(index, next)}
          onTypeChange={(type) => update(index, changeType(definition, type))}
          onRemove={() => remove(index)}
          onMove={(direction) => move(index, direction)}
        />
      ))}
    </section>
  )
}
