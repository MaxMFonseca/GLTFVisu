import { GLSL3, ShaderMaterial } from 'three'
import type { ShaderParameterDefinition, ShaderParameterValue } from '../../domain/parameters'
import type { ShaderLineMapping } from './contract'
import { buildFragmentShader } from './contract'
import { createUniforms } from './uniforms'
import { VERTEX_SHADER } from './vertexShader'

const shaderLineMappings = new WeakMap<ShaderMaterial, ShaderLineMapping>()

export function getShaderLineMapping(material: ShaderMaterial): ShaderLineMapping | undefined {
  return shaderLineMappings.get(material)
}

export function createShaderMaterial(
  fragmentSource: string,
  definitions: readonly ShaderParameterDefinition[],
  values: Readonly<Record<string, ShaderParameterValue | undefined>> = {},
): ShaderMaterial {
  const fragmentShader = buildFragmentShader(fragmentSource, definitions)
  const material = new ShaderMaterial({
    glslVersion: GLSL3,
    vertexShader: VERTEX_SHADER,
    fragmentShader: fragmentShader.source,
    uniforms: createUniforms(definitions, values),
  })
  shaderLineMappings.set(material, fragmentShader.lineMapping)

  return material
}
