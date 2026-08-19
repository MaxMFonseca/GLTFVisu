export type CameraProjection = 'perspective' | 'orthographic'

export interface CameraSettings {
  projection: CameraProjection
  near: number
  far: number
  fov: number
  zoom: number
}

export const DEFAULT_CAMERA_SETTINGS: Readonly<CameraSettings> = Object.freeze({
  projection: 'perspective',
  near: 0.01,
  far: 1000,
  fov: 45,
  zoom: 1,
})

const MIN_NEAR = 0.0001
const MAX_FAR = 1_000_000_000
const MIN_CLIP_SPAN = 0.0001

export function normalizeCameraSettings(settings: CameraSettings): CameraSettings {
  const near = clamp(finiteOr(settings.near, DEFAULT_CAMERA_SETTINGS.near), MIN_NEAR, MAX_FAR - MIN_CLIP_SPAN)
  const far = clamp(
    Math.max(finiteOr(settings.far, DEFAULT_CAMERA_SETTINGS.far), near + MIN_CLIP_SPAN),
    near + MIN_CLIP_SPAN,
    MAX_FAR,
  )
  return {
    projection: settings.projection === 'orthographic' ? 'orthographic' : 'perspective',
    near,
    far,
    fov: clamp(finiteOr(settings.fov, DEFAULT_CAMERA_SETTINGS.fov), 1, 179),
    zoom: clamp(finiteOr(settings.zoom, DEFAULT_CAMERA_SETTINGS.zoom), 0.01, 100),
  }
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(maximum, Math.max(minimum, value))
}
