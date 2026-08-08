import type { ShaderParameterDefinition, ShaderParameterValue } from '../domain/parameters'

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
  fitModel(): void
  selectAnimation(name: string): void
  setAnimationPlaying(playing: boolean): void
  compile(): Promise<void>
  clearNotices(): void
}
