import { BufferGeometry, Material, Object3D, Skeleton, Texture } from 'three'

export interface OwnedResources {
  geometries: Set<BufferGeometry>
  materials: Set<Material>
  textures: Set<Texture>
  skeletons: Set<Skeleton>
}

type ResourceExclusions = ReadonlySet<unknown>

/** Collects disposable resources referenced by a model object tree exactly once. */
export function collectOwnedResources(root: Object3D, exclusions: ResourceExclusions = new Set()): OwnedResources {
  const resources: OwnedResources = {
    geometries: new Set(),
    materials: new Set(),
    textures: new Set(),
    skeletons: new Set(),
  }

  root.traverse((object) => {
    const renderable = object as Object3D & {
      geometry?: BufferGeometry
      material?: Material | Material[]
      skeleton?: Skeleton
    }
    if (renderable.geometry && !exclusions.has(renderable.geometry)) resources.geometries.add(renderable.geometry)
    if (renderable.skeleton && !exclusions.has(renderable.skeleton)) resources.skeletons.add(renderable.skeleton)
    for (const material of asMaterials(renderable.material)) {
      if (exclusions.has(material)) continue
      resources.materials.add(material)
      collectTextures(material, resources.textures, exclusions)
    }
  })

  return resources
}

/** Disposes model-owned GPU resources while preserving explicitly excluded app resources. */
export function disposeObjectTree(root: Object3D, exclusions: ResourceExclusions = new Set()): void {
  const resources = collectOwnedResources(root, exclusions)
  for (const geometry of resources.geometries) geometry.dispose()
  for (const material of resources.materials) material.dispose()
  for (const texture of resources.textures) texture.dispose()
  for (const skeleton of resources.skeletons) skeleton.dispose()
}

function asMaterials(material: Material | Material[] | undefined): Material[] {
  if (!material) return []
  return Array.isArray(material) ? material : [material]
}

function collectTextures(material: Material, textures: Set<Texture>, exclusions: ResourceExclusions): void {
  const visited = new Set<object>()
  const visit = (value: unknown): void => {
    if (value instanceof Texture) {
      if (!exclusions.has(value)) textures.add(value)
      return
    }
    if (!value || typeof value !== 'object' || visited.has(value)) return
    visited.add(value)
    for (const nestedValue of Object.values(value)) visit(nestedValue)
  }

  for (const value of Object.values(material)) visit(value)
}
