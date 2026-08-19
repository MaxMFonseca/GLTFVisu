import type { ShaderParameterDefinition, ShaderParameterValue } from '../domain/parameters'
import type { EnvironmentDisplaySettings } from '../domain/environment'

export interface WorkspaceCommands {
  selectShader(id: string): void
  createShader(): Promise<void>
  duplicateShader(id?: string): Promise<void>
  editName(name: string): void
  editSource(source: string): void
  editSchema(
    parameters: ShaderParameterDefinition[],
    parameterValues: Record<string, ShaderParameterValue>,
  ): void
  updateValue(parameterId: string, value: ShaderParameterValue): void
  save(): Promise<void>
  deleteShader(id?: string): Promise<void>
  importShader(packageJson: string): Promise<void>
  exportShader(id?: string): Promise<void>
  capturePortrait(): Promise<void>
  loadModel(files: File[], root: File): Promise<void>
  replaceModelTexture(slotId: string, file: File): Promise<void>
  restoreModelTexture(slotId: string): Promise<void>
  selectBundledEnvironment(id: string, url: string): Promise<void>
  loadLocalEnvironment(file: File): Promise<void>
  loadRemoteEnvironment(url: string): Promise<void>
  setBackgroundMode(mode: EnvironmentDisplaySettings['backgroundMode']): void
  setEnvironmentClearColor(color: string): void
  setEnvironmentRotation(rotation: number): void
  setEnvironmentIntensity(intensity: number): void
  setEnvironmentBlur(blur: number): void
  fitModel(): void
  resizeViewer(): void
  selectAnimation(name: string): void
  setAnimationPlaying(playing: boolean): void
  compile(): Promise<void>
  clearNotices(): void
}
