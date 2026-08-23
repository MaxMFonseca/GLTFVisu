import { useWorkspace } from '../../application/WorkspaceController'
import { hasLoadedModel } from '../../application/workspaceState'
import { EnvironmentPopover } from './EnvironmentPopover'
import { CameraPopover } from './CameraPopover'

export function ViewerToolbar() {
  const { state, commands } = useWorkspace()
  const hasModel = hasLoadedModel(state.modelLoad)
  const hasAnimations = hasModel && state.animations.clips.length > 0
  const animationLabel = state.animations.playing ? 'Pause animation' : 'Play animation'

  return (
    <div className="viewer-toolbar" role="toolbar" aria-label="Viewer controls">
      <button type="button" disabled={!hasModel} title="Fit model in view" onClick={commands.fitModel}>
        Reset view
      </button>
      <label>
        <span>Animation clip</span>
        <select
          aria-label="Animation clip"
          disabled={!hasAnimations}
          value={state.animations.selectedClipId ?? ''}
          onChange={(event) => commands.selectAnimation(event.currentTarget.value)}
        >
          {!hasAnimations && <option value="">No animations</option>}
          {state.animations.clips.map((clip) => <option key={clip.id} value={clip.id}>{clip.label}</option>)}
        </select>
      </label>
      <button
        type="button"
        className="animation-toggle"
        aria-label={animationLabel}
        title={animationLabel}
        disabled={!hasAnimations}
        onClick={() => commands.setAnimationPlaying(!state.animations.playing)}
      >
        {state.animations.playing ? 'Pause' : 'Play'}
      </button>
      <EnvironmentPopover
        environment={state.environment}
        environmentCatalog={state.environmentCatalog}
        commands={commands}
      />
      <CameraPopover commands={commands} />
    </div>
  )
}
