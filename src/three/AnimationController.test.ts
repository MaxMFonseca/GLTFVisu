import { AnimationClip, Group } from 'three'
import { describe, expect, it, vi } from 'vitest'
import { AnimationController, type AnimationActionPort, type AnimationMixerPort } from './AnimationController'

function action(): AnimationActionPort {
  return {
    paused: false,
    play: vi.fn(function (this: AnimationActionPort) { return this }),
    reset: vi.fn(function (this: AnimationActionPort) { return this }),
    stop: vi.fn(function (this: AnimationActionPort) { return this }),
  }
}

function mixerFor(clips: readonly AnimationClip[]) {
  const actions = new Map(clips.map((clip) => [clip, action()]))
  const mixer: AnimationMixerPort = {
    clipAction: vi.fn((clip) => actions.get(clip) as AnimationActionPort),
    stopAllAction: vi.fn(),
    uncacheAction: vi.fn(),
    uncacheClip: vi.fn(),
    uncacheRoot: vi.fn(),
    update: vi.fn(),
  }
  return { actions, mixer }
}

describe('AnimationController', () => {
  it('autoplays the first clip and switches clips without routing through React', () => {
    const clips = [new AnimationClip('Idle', 1), new AnimationClip('Walk', 2)]
    const { actions, mixer } = mixerFor(clips)
    const controller = new AnimationController(new Group(), clips, () => mixer)

    expect(controller.clips).toEqual([{ id: 'clip-0', label: 'Idle' }, { id: 'clip-1', label: 'Walk' }])
    expect(controller.selectedClipId).toBe('clip-0')
    expect(controller.playing).toBe(true)
    expect(actions.get(clips[0])?.reset).toHaveBeenCalledTimes(1)
    expect(actions.get(clips[0])?.play).toHaveBeenCalledTimes(1)

    controller.select('clip-1')
    controller.update(0.25)

    expect(actions.get(clips[0])?.stop).toHaveBeenCalledTimes(1)
    expect(actions.get(clips[1])?.reset).toHaveBeenCalledTimes(1)
    expect(actions.get(clips[1])?.play).toHaveBeenCalledTimes(1)
    expect(mixer.update).toHaveBeenCalledWith(0.25)
  })

  it('preserves paused state across selection and uncaches actions, clips, and root once', () => {
    const root = new Group()
    const clips = [new AnimationClip('Idle', 1), new AnimationClip('Walk', 2)]
    const { actions, mixer } = mixerFor(clips)
    const controller = new AnimationController(root, clips, () => mixer)

    controller.setPlaying(false)
    controller.select('clip-1')
    controller.update(1)

    expect(controller.playing).toBe(false)
    expect(actions.get(clips[1])?.paused).toBe(true)
    expect(mixer.update).not.toHaveBeenCalled()

    controller.dispose()
    controller.dispose()

    expect(mixer.stopAllAction).toHaveBeenCalledTimes(1)
    expect(mixer.uncacheAction).toHaveBeenCalledTimes(2)
    expect(mixer.uncacheClip).toHaveBeenCalledTimes(2)
    expect(mixer.uncacheRoot).toHaveBeenCalledWith(root)
    expect(mixer.uncacheRoot).toHaveBeenCalledTimes(1)
  })

  it('ignores unknown clip names without disrupting the selected action', () => {
    const clips = [new AnimationClip('Idle', 1)]
    const { actions, mixer } = mixerFor(clips)
    const controller = new AnimationController(new Group(), clips, () => mixer)

    controller.select('missing')

    expect(controller.selectedClipId).toBe('clip-0')
    expect(actions.get(clips[0])?.stop).not.toHaveBeenCalled()
  })

  it('assigns stable IDs and disambiguated labels to duplicate clip names', () => {
    const clips = [new AnimationClip('Idle', 1), new AnimationClip('Idle', 2)]
    const { actions, mixer } = mixerFor(clips)
    const controller = new AnimationController(new Group(), clips, () => mixer)

    expect(controller.clips).toEqual([
      { id: 'clip-0', label: 'Idle (1)' },
      { id: 'clip-1', label: 'Idle (2)' },
    ])
    controller.select('clip-1')

    expect(controller.selectedClipId).toBe('clip-1')
    expect(actions.get(clips[1])?.play).toHaveBeenCalledTimes(1)
  })
})
