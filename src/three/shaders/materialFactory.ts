import { GLSL3, ShaderMaterial } from 'three'
import type { MaterialInputProfile } from '../../domain/materialInput'
import type { ShaderParameterDefinition, ShaderParameterValue } from '../../domain/parameters'
import type { ShaderLineMapping } from './contract'
import { buildFragmentShader } from './contract'
import { createUniforms } from './uniforms'
import { VERTEX_SHADER } from './vertexShader'

const shaderLineMappings = new WeakMap<ShaderMaterial, ShaderLineMapping>()
const materialInputProfiles = new WeakMap<ShaderMaterial, MaterialInputProfile>()

export function getShaderLineMapping(material: ShaderMaterial): ShaderLineMapping | undefined {
  return shaderLineMappings.get(material)
}

export function setMaterialInputProfile(
  material: ShaderMaterial,
  profile: MaterialInputProfile,
): void {
  materialInputProfiles.set(material, profile)
}

export function getMaterialInputProfile(material: ShaderMaterial): MaterialInputProfile {
  return materialInputProfiles.get(material) ?? 'none'
}

export function createShaderMaterial(
  fragmentSource: string,
  definitions: readonly ShaderParameterDefinition[],
  values: Readonly<Record<string, ShaderParameterValue | undefined>> = {},
  profile: MaterialInputProfile = 'none',
): ShaderMaterial {
  const fragmentShader = buildFragmentShader(fragmentSource, definitions, profile)
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: fragmentShader.source,
    uniforms: createUniforms(definitions, values),
  })
  shaderLineMappings.set(material, fragmentShader.lineMapping)
  setMaterialInputProfile(material, profile)

  return material
}
