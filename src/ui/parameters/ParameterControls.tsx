import { useWorkspace } from '../../application/WorkspaceController'
import { createDefaultValue } from '../../domain/parameters'
import { ParameterControl } from './ParameterControl'

export function ParameterControls() {
  const { state, commands } = useWorkspace()

  return (
    <section className="parameter-controls" aria-labelledby="runtime-parameters-heading">
      <h3 id="runtime-parameters-heading">Runtime controls</h3>
      {state.draft.parameters.length === 0 && <p className="panel-message">This shader has no runtime controls.</p>}
      {state.draft.parameters.map((definition) => (
        <ParameterControl
          key={definition.id}
          definition={definition}
          value={state.draft.parameterValues[definition.id] ?? createDefaultValue(definition)}
          readOnly={false}
          onChange={(value) => commands.updateValue(definition.id, value)}
        />
      ))}
    </section>
  )
}
