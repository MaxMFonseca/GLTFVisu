import type { ShaderParameterDefinition, ShaderParameterValue } from '../domain/parameters'
import type { ShaderDraft, ShaderPortrait } from '../domain/shader'

export interface CompileDiagnostic {
  severity: 'error' | 'warning'
  message: string
  editorLine?: number
  raw: string
}

export type CompileResult =
  | { status: 'valid'; generation: number }
  | { status: 'error'; generation: number; diagnostics: CompileDiagnostic[] }

export interface AnimationClipInfo {
  id: string
  label: string
}

export interface ModelInfo {
  name: string
  meshCount: number
  animationClips: readonly AnimationClipInfo[]
}

/** Application-facing boundary for the imperative viewer runtime. */
export interface ViewerPort {
  loadModel(files: File[], root: File): Promise<ModelInfo>
  fitModel(): void
  resize(): void
  compileShader(draft: ShaderDraft): Promise<CompileResult>
  updateParameter(definition: ShaderParameterDefinition, value: ShaderParameterValue): void
  capturePortrait(): Promise<ShaderPortrait>
  selectAnimation(name: string): void
  setAnimationPlaying(playing: boolean): void
  dispose(): void
}
