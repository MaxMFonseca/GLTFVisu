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

/** Owns a model's mixer, selected action, and all corresponding cache entries. */
export class AnimationController {
  readonly clipNames: readonly string[]
  private readonly clipsByName = new Map<string, AnimationClip>()
  private readonly mixer: AnimationMixerPort
  private currentAction?: AnimationActionPort
  private disposed = false
  selectedClip?: string
  playing = false

  constructor(
    private readonly root: Object3D,
    private readonly clips: readonly AnimationClip[],
    createMixer: AnimationMixerFactory = (object) => new AnimationMixer(object),
  ) {
    this.mixer = createMixer(root)
    this.clipNames = clips.map((clip) => clip.name)
    for (const clip of clips) {
      if (!this.clipsByName.has(clip.name)) this.clipsByName.set(clip.name, clip)
    }
    const first = clips[0]
    if (first !== undefined) {
      this.playing = true
      this.activate(first)
    }
  }

  select(name: string): void {
    if (this.disposed || name === this.selectedClip) return
    const clip = this.clipsByName.get(name)
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
    for (const clip of this.clips) {
      this.mixer.uncacheAction(clip, this.root)
      this.mixer.uncacheClip(clip)
    }
    this.mixer.uncacheRoot(this.root)
    this.clipsByName.clear()
    this.currentAction = undefined
    this.selectedClip = undefined
    this.playing = false
  }

  private activate(clip: AnimationClip): void {
    const action = this.mixer.clipAction(clip).reset().play()
    action.paused = !this.playing
    this.currentAction = action
    this.selectedClip = clip.name
  }
}
