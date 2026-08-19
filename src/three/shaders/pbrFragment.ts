/** Editable GLTF metallic/roughness PBR body used by built-in and duplicated shaders. */
export const PBR_FRAGMENT_SOURCE = /* glsl */ `const float GLTF_PBR_PI = 3.141592653589793;

vec2 pbrTextureUv(int channel, mat3 uvTransform) {
  vec2 sourceUv = channel == 1 ? vGltfUv1 : vUv;
  return (uvTransform * vec3(sourceUv, 1.0)).xy;
}

float distributionGGX(float normalDotHalf, float roughness) {
  float alpha = roughness * roughness;
  float alphaSquared = alpha * alpha;
  float denominator = normalDotHalf * normalDotHalf * (alphaSquared - 1.0) + 1.0;
  return alphaSquared / max(GLTF_PBR_PI * denominator * denominator, 1e-7);
}

float visibilitySmithGGXCorrelated(float normalDotView, float normalDotLight, float roughness) {
  float alpha = roughness * roughness;
  float alphaSquared = alpha * alpha;
  float viewVisibility = normalDotLight * sqrt(
    alphaSquared + (1.0 - alphaSquared) * normalDotView * normalDotView
  );
  float lightVisibility = normalDotView * sqrt(
    alphaSquared + (1.0 - alphaSquared) * normalDotLight * normalDotLight
  );
  return 0.5 / max(viewVisibility + lightVisibility, 1e-6);
}

vec3 fresnelSchlick(float viewDotHalf, vec3 reflectanceAtNormal) {
  float grazing = pow(1.0 - clamp(viewDotHalf, 0.0, 1.0), 5.0);
  return reflectanceAtNormal + (vec3(1.0) - reflectanceAtNormal) * grazing;
}

vec3 diffuseLambert(vec3 diffuseColor) {
  return diffuseColor / GLTF_PBR_PI;
}

// Useful to editable derivatives that add direct lights; PMREM IBL below uses an integrated BRDF fit.
vec3 evaluateGgxSpecular(
  vec3 normal,
  vec3 viewDirection,
  vec3 lightDirection,
  float roughness,
  vec3 reflectanceAtNormal
) {
  vec3 halfDirection = normalize(viewDirection + lightDirection);
  float normalDotView = max(dot(normal, viewDirection), 0.0);
  float normalDotLight = max(dot(normal, lightDirection), 0.0);
  float normalDotHalf = max(dot(normal, halfDirection), 0.0);
  float viewDotHalf = max(dot(viewDirection, halfDirection), 0.0);
  float distribution = distributionGGX(normalDotHalf, roughness);
  float visibility = visibilitySmithGGXCorrelated(normalDotView, normalDotLight, roughness);
  return fresnelSchlick(viewDotHalf, reflectanceAtNormal) * distribution * visibility;
}

mat3 derivativeTangentFrame(vec3 normal, vec2 uv) {
  vec3 positionDx = dFdx(vWorldPosition);
  vec3 positionDy = dFdy(vWorldPosition);
  vec2 uvDx = dFdx(uv);
  vec2 uvDy = dFdy(uv);
  vec3 perpendicularToDy = cross(positionDy, normal);
  vec3 perpendicularToDx = cross(normal, positionDx);
  vec3 tangent = perpendicularToDy * uvDx.x + perpendicularToDx * uvDy.x;
  vec3 bitangent = perpendicularToDy * uvDx.y + perpendicularToDx * uvDy.y;
  float inverseScale = inversesqrt(max(max(dot(tangent, tangent), dot(bitangent, bitangent)), 1e-8));
  return mat3(tangent * inverseScale, bitangent * inverseScale, normal);
}

vec3 pbrWorldNormal() {
  vec3 normal = normalize(vWorldNormal);
  #ifdef DOUBLE_SIDED
    normal *= gl_FrontFacing ? 1.0 : -1.0;
  #endif
  if (!uUseNormalMap || !uGltfHasNormalMap) return normal;

  vec2 normalUv = pbrTextureUv(uGltfNormalUvChannel, uGltfNormalUvTransform);
  vec3 tangentNormal = texture(uGltfNormalMap, normalUv).xyz * 2.0 - 1.0;
  tangentNormal.xy *= uGltfNormalScale * uNormalStrength;
  return normalize(derivativeTangentFrame(normal, normalUv) * tangentNormal);
}

vec2 environmentBrdfApproximation(float roughness, float normalDotView) {
  const vec4 coefficient0 = vec4(-1.0, -0.0275, -0.572, 0.022);
  const vec4 coefficient1 = vec4(1.0, 0.0425, 1.04, -0.04);
  vec4 interpolation = roughness * coefficient0 + coefficient1;
  float response = min(interpolation.x * interpolation.x, exp2(-9.28 * normalDotView))
    * interpolation.x + interpolation.y;
  return vec2(-1.04, 1.04) * response + interpolation.zw;
}

void main() {
  vec4 sampledBaseColor = sampleGltfBaseColor();
  vec4 factorBaseColor = vec4(uGltfBaseColorFactor, uGltfBaseColorOpacity);
  vec4 baseColor = uUseBaseColorMap ? sampledBaseColor : factorBaseColor;
  baseColor.rgb *= uBaseColorTint;
  if (uGltfAlphaCutoff > 0.0 && baseColor.a < uGltfAlphaCutoff) discard;

  float metallic = uGltfMetallicFactor;
  if (uUseMetallicRoughnessMap && uGltfHasMetallicMap) {
    vec2 metallicUv = pbrTextureUv(uGltfMetallicUvChannel, uGltfMetallicUvTransform);
    metallic *= texture(uGltfMetallicMap, metallicUv).b;
  }
  metallic *= uMetallicMultiplier;
  metallic = clamp(metallic, 0.0, 1.0);

  float roughness = uGltfRoughnessFactor;
  if (uUseMetallicRoughnessMap && uGltfHasRoughnessMap) {
    vec2 roughnessUv = pbrTextureUv(uGltfRoughnessUvChannel, uGltfRoughnessUvTransform);
    roughness *= texture(uGltfRoughnessMap, roughnessUv).g;
  }
  roughness *= uRoughnessMultiplier;
  roughness = clamp(roughness, 0.04, 1.0);

  vec3 normal = pbrWorldNormal();
  vec3 viewDirection = normalize(uCameraPosition - vWorldPosition);
  float normalDotView = max(dot(normal, viewDirection), 0.0);
  vec3 reflectanceAtNormal = mix(vec3(0.04), baseColor.rgb, metallic);
  vec3 fresnel = fresnelSchlick(normalDotView, reflectanceAtNormal);
  vec3 diffuseWeight = (vec3(1.0) - fresnel) * (1.0 - metallic);

  vec3 diffuseDirection = normalize(uEnvironmentRotation * normal);
  vec3 reflectionDirection = reflect(-viewDirection, normal);
  vec3 specularDirection = normalize(uEnvironmentRotation * mix(
    reflectionDirection,
    normal,
    roughness * roughness * roughness * roughness
  ));
  vec3 diffuseEnvironment = GLTF_PBR_PI
    * textureCubeUV(uEnvironmentMap, diffuseDirection, 1.0).rgb;
  vec3 specularEnvironment = textureCubeUV(uEnvironmentMap, specularDirection, roughness).rgb;
  vec2 environmentBrdf = environmentBrdfApproximation(roughness, normalDotView);
  vec3 specularWeight = reflectanceAtNormal * environmentBrdf.x + environmentBrdf.y;

  vec3 linearColor = (
    diffuseEnvironment * diffuseLambert(baseColor.rgb) * diffuseWeight
    + specularEnvironment * specularWeight
  ) * uEnvironmentIntensity * uEnvironmentContribution;
  linearColor = max(linearColor, vec3(0.0));
  #ifdef TONE_MAPPING
    linearColor = toneMapping(linearColor);
  #endif
  outColor = linearToOutputTexel(vec4(linearColor, baseColor.a));
}`
