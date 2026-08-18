import type { Matrix3, Texture } from 'three'

/** Shared uniform containers. Resource ownership remains with EnvironmentService. */
export interface EnvironmentBinding {
  environmentMap: { value: Texture | null }
  environmentRotation: { value: Matrix3 }
  environmentIntensity: { value: number }
}
