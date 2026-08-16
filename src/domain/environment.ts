export type EnvironmentLoadSource =
  | { kind: 'bundled'; id: string; url: string }
  | { kind: 'local'; file: File }
  | { kind: 'remote'; url: string }

export interface EnvironmentDisplaySettings {
  backgroundMode: 'skybox' | 'clear-color'
  clearColor: string
  rotation: number
  intensity: number
}

export interface WorkspaceEnvironmentState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  activeSource?: EnvironmentLoadSource
  pendingLabel?: string
  error?: string
  settings: EnvironmentDisplaySettings
}

export interface EnvironmentDefinition {
  id: string
  name: string
  hdrUrl: string
  license: 'CC0-1.0'
  sourceUrl: string
  author: string
}

export const DEFAULT_ENVIRONMENT_DISPLAY_SETTINGS: EnvironmentDisplaySettings = {
  backgroundMode: 'skybox',
  clearColor: '#17191d',
  rotation: 0,
  intensity: 1,
}

export const ENVIRONMENT_LOAD_ERROR_MESSAGE = 'Unable to load environment'

/** Error exposed by the viewer boundary without leaking decoder or network details to the UI. */
export class EnvironmentLoadError extends Error {
  readonly cause: unknown

  constructor(message = ENVIRONMENT_LOAD_ERROR_MESSAGE, cause?: unknown) {
    super(message)
    this.name = 'EnvironmentLoadError'
    this.cause = cause
  }
}

export type EnvironmentValidationResult =
  | { valid: true }
  | { valid: false; message: string }

export function validateRemoteEnvironmentUrl(value: string): EnvironmentValidationResult {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return { valid: false, message: 'Environment URL is invalid' }
  }
  if (url.protocol !== 'https:') return { valid: false, message: 'Environment URL must use HTTPS' }
  if (url.username.length > 0 || url.password.length > 0) {
    return { valid: false, message: 'Environment URL must not include credentials' }
  }
  return { valid: true }
}

export function normalizeEnvironmentClearColor(value: string): string | undefined {
  const normalized = value.trim().toLowerCase()
  return /^#[0-9a-f]{6}$/.test(normalized) ? normalized : undefined
}

export function normalizeEnvironmentRotation(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return ((value % 360) + 360) % 360
}

export function normalizeEnvironmentIntensity(value: number): number | undefined {
  if (!Number.isFinite(value)) return undefined
  return Math.min(4, Math.max(0, value))
}
