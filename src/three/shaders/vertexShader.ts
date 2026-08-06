/** App-owned vertex stage exposing a stable, Three-independent fragment contract. */
export const VERTEX_SHADER = /* glsl */ `
#define USE_UV

out vec3 vWorldPosition;
out vec3 vWorldNormal;

#include <common>
#include <batching_pars_vertex>
#include <uv_pars_vertex>
#include <morphtarget_pars_vertex>
#include <skinning_pars_vertex>

void main() {
  #include <uv_vertex>
  #include <batching_vertex>

  #include <beginnormal_vertex>
  #include <morphinstance_vertex>
  #include <morphnormal_vertex>
  #include <skinbase_vertex>
  #include <skinnormal_vertex>
  #include <defaultnormal_vertex>

  #include <begin_vertex>
  #include <morphtarget_vertex>
  #include <skinning_vertex>
  #include <project_vertex>

  vec4 worldPosition = vec4( transformed, 1.0 );
  #ifdef USE_BATCHING
    worldPosition = batchingMatrix * worldPosition;
  #endif
  #ifdef USE_INSTANCING
    worldPosition = instanceMatrix * worldPosition;
  #endif
  worldPosition = modelMatrix * worldPosition;

  vWorldPosition = worldPosition.xyz;
  vWorldNormal = normalize( inverseTransformDirection( transformedNormal, viewMatrix ) );
}
`
