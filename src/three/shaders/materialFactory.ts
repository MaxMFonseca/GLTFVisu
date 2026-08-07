import { GLSL3, ShaderMaterial } from 'three'
import type { ShaderParameterDefinition, ShaderParameterValue } from '../../domain/parameters'
import { buildFragmentShader } from './contract'
import { createUniforms } from './uniforms'
import { VERTEX_SHADER } from './vertexShader'

export interface CreatedShaderMaterial {
  material: ShaderMaterial
  lineMapping: ReturnType<typeof buildFragmentShader>['lineMapping']
}

export function createShaderMaterial(
  fragmentSource: string,
  definitions: readonly ShaderParameterDefinition[],
  values: Readonly<Record<string, ShaderParameterValue | undefined>> = {},
): CreatedShaderMaterial {
  const fragmentShader = buildFragmentShader(fragmentSource, definitions)

  return {
    material: new ShaderMaterial({
      glslVersion: GLSL3,
      vertexShader: VERTEX_SHADER,
      fragmentShader: fragmentShader.source,
      uniforms: createUniforms(definitions, values),
    }),
    lineMapping: fragmentShader.lineMapping,
  }
}
