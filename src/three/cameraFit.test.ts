import { Box3, PerspectiveCamera, Vector3 } from 'three'
import { describe, expect, it } from 'vitest'
import { calculateCameraFit } from './cameraFit'

function corners(bounds: Box3): Vector3[] {
  const { min, max } = bounds
  return [
    new Vector3(min.x, min.y, min.z),
    new Vector3(min.x, min.y, max.z),
    new Vector3(min.x, max.y, min.z),
    new Vector3(min.x, max.y, max.z),
    new Vector3(max.x, min.y, min.z),
    new Vector3(max.x, min.y, max.z),
    new Vector3(max.x, max.y, min.z),
    new Vector3(max.x, max.y, max.z),
  ]
}

function expectAllCornersInView(bounds: Box3, fovDegrees: number, aspect: number, direction: Vector3): void {
  const fit = calculateCameraFit(bounds, fovDegrees, aspect, direction, 0.15)
  const camera = new PerspectiveCamera(fovDegrees, aspect, fit.near, fit.far)
  camera.position.copy(fit.position)
  camera.lookAt(fit.target)
  camera.updateMatrixWorld()
  camera.updateProjectionMatrix()

  for (const corner of corners(bounds)) {
    const projected = corner.project(camera)
    expect(projected.x).toBeGreaterThanOrEqual(-1)
    expect(projected.x).toBeLessThanOrEqual(1)
    expect(projected.y).toBeGreaterThanOrEqual(-1)
    expect(projected.y).toBeLessThanOrEqual(1)
    expect(projected.z).toBeGreaterThanOrEqual(-1)
    expect(projected.z).toBeLessThanOrEqual(1)
  }
}

describe('calculateCameraFit', () => {
  it('centers and frames every corner of tall and wide bounds across aspect ratios', () => {
    const tallBounds = new Box3(new Vector3(-1, -12, -2), new Vector3(1, 12, 2))
    const wideBounds = new Box3(new Vector3(-16, -1, -3), new Vector3(16, 1, 3))

    expectAllCornersInView(tallBounds, 45, 0.5, new Vector3(0, 0, 1))
    expectAllCornersInView(wideBounds, 45, 3, new Vector3(1, 1, 1))
  })

  it('returns the bounds center and finite ordered clipping planes for zero and extreme extents', () => {
    const zeroBounds = new Box3(new Vector3(4, -2, 7), new Vector3(4, -2, 7))
    const zeroFit = calculateCameraFit(zeroBounds, 50, 1, new Vector3())
    expect(zeroFit.target).toEqual(new Vector3(4, -2, 7))
    expect(Number.isFinite(zeroFit.near)).toBe(true)
    expect(Number.isFinite(zeroFit.far)).toBe(true)
    expect(zeroFit.near).toBeGreaterThan(0)
    expect(zeroFit.far).toBeGreaterThan(zeroFit.near)

    const hugeBounds = new Box3(new Vector3(-1e150, -2e150, -3e150), new Vector3(1e150, 2e150, 3e150))
    const hugeFit = calculateCameraFit(hugeBounds, 35, 0.25, new Vector3(0, 1, 1), 0.2)
    expect(hugeFit.position.toArray().every(Number.isFinite)).toBe(true)
    expect(Number.isFinite(hugeFit.near)).toBe(true)
    expect(Number.isFinite(hugeFit.far)).toBe(true)
    expect(hugeFit.near).toBeGreaterThan(0)
    expect(hugeFit.far).toBeGreaterThan(hugeFit.near)
  })

  it('keeps radial box extremes strictly inside the clipping planes', () => {
    const bounds = new Box3(new Vector3(0, 0, -8), new Vector3(0, 0, 8))
    const fit = calculateCameraFit(bounds, 60, 1, new Vector3(0, 0, 1))

    expect(fit.position.distanceTo(new Vector3(0, 0, 8))).toBeGreaterThan(fit.near)
    expect(fit.position.distanceTo(new Vector3(0, 0, -8))).toBeLessThan(fit.far)
  })
})
