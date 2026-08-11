import { AnimationMixer, type AnimationClip, type Object3D } from 'three'

export interface AnimationActionPort {
  paused: boolean
  play(): AnimationActionPort
  reset(): AnimationActionPort
  stop(): AnimationActionPort
}

export interface AnimationMixerPort {
  clipAction(clip: AnimationClip): AnimationActionPort
  stopAllAction(): void
  uncacheAction(clip: AnimationClip, root?: Object3D): void
  uncacheClip(clip: AnimationClip): void
  uncacheRoot(root: Object3D): void
  update(deltaSeconds: number): void
}

export type AnimationMixerFactory = (root: Object3D) => AnimationMixerPort

export interface AnimationClipOption {
  id: string
  label: string
}

/** Owns a model's mixer, selected action, and all corresponding cache entries. */
export class AnimationController {
  readonly clips: readonly AnimationClipOption[]
  private readonly clipsById = new Map<string, AnimationClip>()
  private readonly mixer: AnimationMixerPort
  private currentAction?: AnimationActionPort
  private disposed = false
  selectedClipId?: string
  playing = false

  constructor(
    private readonly root: Object3D,
    private readonly sourceClips: readonly AnimationClip[],
    createMixer: AnimationMixerFactory = (object) => new AnimationMixer(object),
  ) {
    this.mixer = createMixer(root)
    const nameCounts = new Map<string, number>()
    for (const clip of sourceClips) nameCounts.set(clip.name, (nameCounts.get(clip.name) ?? 0) + 1)
    const occurrences = new Map<string, number>()
    this.clips = sourceClips.map((clip, index) => {
      const occurrence = (occurrences.get(clip.name) ?? 0) + 1
      occurrences.set(clip.name, occurrence)
      const id = `clip-${index}`
      this.clipsById.set(id, clip)
      const baseLabel = clip.name.trim() || `Animation ${index + 1}`
      return {
        id,
        label: (nameCounts.get(clip.name) ?? 0) > 1 ? `${baseLabel} (${occurrence})` : baseLabel,
      }
    })
    const first = sourceClips[0]
    if (first !== undefined) {
      this.playing = true
      this.activate(first)
    }
  }

  select(id: string): void {
    if (this.disposed || id === this.selectedClipId) return
    const clip = this.clipsById.get(id)
    if (clip === undefined) return
    this.currentAction?.stop()
    this.activate(clip)
  }

  setPlaying(playing: boolean): void {
    if (this.disposed || this.playing === playing) return
    this.playing = playing
    if (this.currentAction === undefined) return
    this.currentAction.paused = !playing
    if (playing) this.currentAction.play()
  }

  update(deltaSeconds: number): void {
    if (!this.disposed && this.playing) this.mixer.update(deltaSeconds)
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    this.mixer.stopAllAction()
    for (const clip of this.sourceClips) {
      this.mixer.uncacheAction(clip, this.root)
      this.mixer.uncacheClip(clip)
    }
    this.mixer.uncacheRoot(this.root)
    this.clipsById.clear()
    this.currentAction = undefined
    this.selectedClipId = undefined
    this.playing = false
  }

  private activate(clip: AnimationClip): void {
    const action = this.mixer.clipAction(clip).reset().play()
    action.paused = !this.playing
    this.currentAction = action
    this.selectedClipId = this.clips.find((option) => this.clipsById.get(option.id) === clip)?.id
  }
}
