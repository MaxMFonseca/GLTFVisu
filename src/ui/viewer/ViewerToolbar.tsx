import { useWorkspace } from '../../application/WorkspaceController'

export function ViewerToolbar() {
  const { state, commands } = useWorkspace()
  const hasModel = state.modelLoad.status === 'loaded'
  const hasAnimations = hasModel && state.animations.clipNames.length > 0
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
          value={state.animations.selectedClip ?? ''}
          onChange={(event) => commands.selectAnimation(event.currentTarget.value)}
        >
          {!hasAnimations && <option value="">No animations</option>}
          {state.animations.clipNames.map((clip) => <option key={clip} value={clip}>{clip}</option>)}
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
    </div>
  )
}
