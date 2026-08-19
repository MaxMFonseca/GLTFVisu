import type { ShaderParameterDefinition, ShaderParameterValue } from '../domain/parameters'
import type { ShaderDraft, ShaderPortrait } from '../domain/shader'
import type { EnvironmentDisplaySettings, EnvironmentLoadSource } from '../domain/environment'
import type { CameraSettings } from '../domain/camera'
import type { ModelTextureSlotInfo } from '../three/modelTextures/ModelTextureRegistry'

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
  textureSlots: readonly ModelTextureSlotInfo[]
}

/** Application-facing boundary for the imperative viewer runtime. */
export interface ViewerPort {
  /**
   * Installs the requested model. Starting a newer request must supersede any
   * older in-flight request and prevent that older model from being installed.
   */
  loadModel(files: File[], root: File): Promise<ModelInfo>
  replaceModelTexture(slotId: string, file: File): Promise<readonly ModelTextureSlotInfo[]>
  restoreModelTexture(slotId: string): Promise<readonly ModelTextureSlotInfo[]>
  fitModel(): void
  resize(): void
  compileShader(draft: ShaderDraft): Promise<CompileResult>
  updateParameter(definition: ShaderParameterDefinition, value: ShaderParameterValue): void
  loadEnvironment(source: EnvironmentLoadSource): Promise<void>
  updateEnvironment(settings: EnvironmentDisplaySettings): void
  updateCamera(settings: CameraSettings): void
  capturePortrait(): Promise<ShaderPortrait>
  selectAnimation(name: string): void
  setAnimationPlaying(playing: boolean): void
  dispose(): void
}
