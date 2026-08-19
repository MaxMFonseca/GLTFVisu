import fresnelPortrait from '../assets/portraits/fresnel.svg'
import normalPortrait from '../assets/portraits/normal.svg'
import proceduralMatcapPortrait from '../assets/portraits/procedural-matcap.svg'
import rimLightPortrait from '../assets/portraits/rim-light.svg'
import toonPortrait from '../assets/portraits/toon.svg'
import uvGridPortrait from '../assets/portraits/uv-grid.svg'
import type { ShaderDefinition } from './shader'
import { validateParameterDefinitions } from './uniformValidation'

function freezeBuiltin(shader: ShaderDefinition): ShaderDefinition {
  if (validateParameterDefinitions(shader.parameters).length > 0) {
    throw new Error(`Invalid built-in shader: ${shader.name}`)
  }
  if (shader.portrait !== undefined) Object.freeze(shader.portrait)
  for (const parameter of shader.parameters) Object.freeze(parameter)
  Object.freeze(shader.parameters)
  Object.freeze(shader.parameterValues)
  return Object.freeze(shader)
}

const builtins: ShaderDefinition[] = [
  {
    id: 'builtin-normal', name: 'Normal', origin: 'builtin', portrait: { kind: 'bundled', url: normalPortrait },
    fragmentSource: `void main() {
  outColor = vec4(normalize(vWorldNormal) * 0.5 + 0.5, 1.0);
}`,
    materialInputProfile: 'none', parameters: [], parameterValues: {}, schemaVersion: 2,
  },
  {
    id: 'builtin-uv-grid', name: 'UV Grid', origin: 'builtin', portrait: { kind: 'bundled', url: uvGridPortrait },
    fragmentSource: `void main() {
  vec2 grid = abs(fract(vUv * 10.0 - 0.5) - 0.5) / fwidth(vUv * 10.0);
  float line = 1.0 - min(min(grid.x, grid.y), 1.0);
  outColor = vec4(mix(vec3(0.05), vec3(0.9), line), 1.0);
}`,
    materialInputProfile: 'none', parameters: [], parameterValues: {}, schemaVersion: 2,
  },
  {
    id: 'builtin-fresnel', name: 'Fresnel', origin: 'builtin', portrait: { kind: 'bundled', url: fresnelPortrait },
    fragmentSource: `void main() {
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  float rim = pow(1.0 - max(dot(normalize(vWorldNormal), viewDirection), 0.0), uPower);
  outColor = vec4(uColor * rim, 1.0);
}`,
    parameters: [
      { id: 'power', type: 'float', uniformName: 'uPower', label: 'Power', min: 0.1, max: 8, step: 0.1, defaultValue: 3 },
      { id: 'color', type: 'color', uniformName: 'uColor', label: 'Color', defaultValue: '#80caff' },
    ], materialInputProfile: 'none', parameterValues: { power: 3, color: '#80caff' }, schemaVersion: 2,
  },
  {
    id: 'builtin-toon', name: 'Toon', origin: 'builtin', portrait: { kind: 'bundled', url: toonPortrait },
    fragmentSource: `void main() {
  vec4 albedo = sampleGltfBaseColor();
  if (uGltfAlphaCutoff > 0.0 && albedo.a < uGltfAlphaCutoff) discard;
  float bands = float(max(uBands, 1));
  float light = max(dot(normalize(vWorldNormal), normalize(vec3(0.4, 0.8, 0.6))), 0.0);
  float stepped = floor(light * bands) / bands;
  outColor = vec4(albedo.rgb * mix(uShadowColor, uLightColor, stepped), albedo.a);
}`,
    parameters: [
      { id: 'bands', type: 'integer', uniformName: 'uBands', label: 'Bands', min: 1, max: 8, step: 1, defaultValue: 3 },
      { id: 'shadow-color', type: 'color', uniformName: 'uShadowColor', label: 'Shadow tint', defaultValue: '#18223b' },
      { id: 'light-color', type: 'color', uniformName: 'uLightColor', label: 'Light tint', defaultValue: '#f7c75f' },
    ], materialInputProfile: 'gltf-surface', parameterValues: { bands: 3, 'shadow-color': '#18223b', 'light-color': '#f7c75f' }, schemaVersion: 2,
  },
  {
    id: 'builtin-procedural-matcap', name: 'Procedural Matcap', origin: 'builtin', portrait: { kind: 'bundled', url: proceduralMatcapPortrait },
    fragmentSource: `void main() {
  vec3 normal = normalize(vWorldNormal);
  float highlight = pow(max(normal.z, 0.0), 5.0);
  vec3 base = mix(vec3(0.05, 0.08, 0.15), vec3(0.35, 0.8, 0.9), normal.y * 0.5 + 0.5);
  outColor = vec4(base + highlight, 1.0);
}`,
    materialInputProfile: 'none', parameters: [], parameterValues: {}, schemaVersion: 2,
  },
  {
    id: 'builtin-rim-light', name: 'Rim Light', origin: 'builtin', portrait: { kind: 'bundled', url: rimLightPortrait },
    fragmentSource: `void main() {
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  float facing = 1.0 - max(dot(normalize(vWorldNormal), viewDirection), 0.0);
  float rim = pow(facing, uRimPower) * uRimIntensity;
  outColor = vec4(uRimColor * rim, 1.0);
}`,
    parameters: [
      { id: 'rim-power', type: 'float', uniformName: 'uRimPower', label: 'Rim power', min: 0.1, max: 8, step: 0.1, defaultValue: 2 },
      { id: 'rim-intensity', type: 'float', uniformName: 'uRimIntensity', label: 'Rim intensity', min: 0, max: 4, step: 0.1, defaultValue: 1.5 },
      { id: 'rim-color', type: 'color', uniformName: 'uRimColor', label: 'Rim color', defaultValue: '#8a5cff' },
    ], materialInputProfile: 'none', parameterValues: { 'rim-power': 2, 'rim-intensity': 1.5, 'rim-color': '#8a5cff' }, schemaVersion: 2,
  },
]

export const BUILTIN_SHADERS: readonly ShaderDefinition[] = Object.freeze(builtins.map(freezeBuiltin))
