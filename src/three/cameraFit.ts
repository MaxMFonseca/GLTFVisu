import { Box3, Vector3 } from 'three'

export interface CameraFit {
  position: Vector3
  target: Vector3
  near: number
  far: number
}

const MIN_FOV_RADIANS = Math.PI / 180_000
const MAX_FOV_RADIANS = Math.PI - MIN_FOV_RADIANS
const MAX_FINITE = Number.MAX_VALUE / 4

/**
 * Calculates a perspective-camera placement that encloses a box without
 * changing a camera instance. The bounding sphere makes the result safe for
 * every camera direction, including a diagonal view of a deep box.
 */
export function calculateCameraFit(
  bounds: Box3,
  fovDegrees: number,
  aspect: number,
  direction: Vector3,
  padding = 0,
): CameraFit {
  const target = centerOf(bounds)
  const halfExtents = halfExtentsOf(bounds)
  const coordinateScale = Math.max(Math.abs(target.x), Math.abs(target.y), Math.abs(target.z), 1)
  const minimumRadius = Math.max(1e-6, coordinateScale * Number.EPSILON * 16)
  const radius = Math.max(scaledHypot(halfExtents.x, halfExtents.y, halfExtents.z), minimumRadius)
  const verticalHalfFov = clampFov(fovDegrees) / 2
  const horizontalHalfFov = Math.atan(Math.tan(verticalHalfFov) * clampAspect(aspect))
  const limitingHalfFov = Math.min(verticalHalfFov, horizontalHalfFov)
  const paddingRadius = cappedProduct(radius, Math.max(0, finiteOr(padding, 0)))
  const distance = cappedAdd(cappedProduct(radius, 1 / Math.sin(limitingHalfFov)), paddingRadius)
  const coverageRadius = cappedAdd(radius, paddingRadius)
  const position = addScaledSafely(target, normalizedDirection(direction), distance)
  const actualDistance = scaledHypot(position.x - target.x, position.y - target.y, position.z - target.z)
  const clearance = clipClearance(actualDistance, coverageRadius, minimumRadius, target, position)
  const near = Math.max(minimumRadius * 1e-3, actualDistance - coverageRadius - clearance)
  const unclampedFar = cappedAdd(cappedAdd(actualDistance, coverageRadius), clearance)
  const far = unclampedFar > near ? unclampedFar : cappedAdd(near, minimumRadius)

  return {
    position,
    target,
    near: Math.min(near, MAX_FINITE / 2),
    far: Math.min(far, MAX_FINITE),
  }
}

function centerOf(bounds: Box3): Vector3 {
  return new Vector3(
    bounds.min.x / 2 + bounds.max.x / 2,
    bounds.min.y / 2 + bounds.max.y / 2,
    bounds.min.z / 2 + bounds.max.z / 2,
  )
}

function halfExtentsOf(bounds: Box3): Vector3 {
  return new Vector3(
    Math.abs(bounds.max.x / 2 - bounds.min.x / 2),
    Math.abs(bounds.max.y / 2 - bounds.min.y / 2),
    Math.abs(bounds.max.z / 2 - bounds.min.z / 2),
  )
}

function normalizedDirection(direction: Vector3): Vector3 {
  const greatestComponent = Math.max(Math.abs(direction.x), Math.abs(direction.y), Math.abs(direction.z))
  if (!Number.isFinite(greatestComponent) || greatestComponent === 0) return new Vector3(0, 0, 1)

  const x = direction.x / greatestComponent
  const y = direction.y / greatestComponent
  const z = direction.z / greatestComponent
  const length = Math.hypot(x, y, z)
  return new Vector3(x / length, y / length, z / length)
}

function clampFov(fovDegrees: number): number {
  const radians = finiteOr(fovDegrees, 50) * Math.PI / 180
  return Math.min(MAX_FOV_RADIANS, Math.max(MIN_FOV_RADIANS, radians))
}

function clampAspect(aspect: number): number {
  return Math.max(1e-6, finiteOr(aspect, 1))
}

function scaledHypot(x: number, y: number, z: number): number {
  const greatestComponent = Math.max(Math.abs(x), Math.abs(y), Math.abs(z))
  if (!Number.isFinite(greatestComponent)) return MAX_FINITE
  if (greatestComponent === 0) return 0
  return Math.min(MAX_FINITE, greatestComponent * Math.hypot(x / greatestComponent, y / greatestComponent, z / greatestComponent))
}

function cappedProduct(left: number, right: number): number {
  if (left === 0 || right === 0) return 0
  if (!Number.isFinite(left) || !Number.isFinite(right) || Math.abs(left) > MAX_FINITE / Math.abs(right)) return MAX_FINITE
  return Math.min(MAX_FINITE, left * right)
}

function cappedAdd(left: number, right: number): number {
  if (!Number.isFinite(left) || !Number.isFinite(right) || left > MAX_FINITE - right) return MAX_FINITE
  return Math.min(MAX_FINITE, left + right)
}

function addScaledSafely(base: Vector3, direction: Vector3, distance: number): Vector3 {
  return new Vector3(
    cappedSignedAdd(base.x, direction.x * distance),
    cappedSignedAdd(base.y, direction.y * distance),
    cappedSignedAdd(base.z, direction.z * distance),
  )
}

function cappedSignedAdd(left: number, right: number): number {
  const sum = left + right
  if (Number.isFinite(sum)) return sum
  return Math.sign(left || right) * MAX_FINITE
}

function clipClearance(distance: number, coverageRadius: number, minimumRadius: number, target: Vector3, position: Vector3): number {
  const scale = Math.max(
    distance,
    coverageRadius,
    minimumRadius,
    Math.abs(target.x),
    Math.abs(target.y),
    Math.abs(target.z),
    Math.abs(position.x),
    Math.abs(position.y),
    Math.abs(position.z),
    1,
  )
  return Math.max(minimumRadius * 1e-3, scale * Number.EPSILON * 64)
}

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback
}
