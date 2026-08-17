import goegapHdrUrl from '../assets/environments/goegap-1k.hdr?url'
import polyHavenStudioHdrUrl from '../assets/environments/poly-haven-studio-1k.hdr?url'
import roglandClearNightHdrUrl from '../assets/environments/rogland-clear-night-1k.hdr?url'
import urbanStreet01HdrUrl from '../assets/environments/urban-street-01-1k.hdr?url'
import type { EnvironmentDefinition } from './environment'

function freezeEnvironment(environment: EnvironmentDefinition): EnvironmentDefinition {
  return Object.freeze(environment)
}

const roglandClearNight = freezeEnvironment({
  id: 'rogland-clear-night',
  name: 'Rogland Clear Night',
  hdrUrl: roglandClearNightHdrUrl,
  license: 'CC0-1.0',
  sourceUrl: 'https://polyhaven.com/a/rogland_clear_night',
  author: 'Greg Zaal',
})

const urbanStreet01 = freezeEnvironment({
  id: 'urban-street-01',
  name: 'Urban Street 01',
  hdrUrl: urbanStreet01HdrUrl,
  license: 'CC0-1.0',
  sourceUrl: 'https://polyhaven.com/a/urban_street_01',
  author: 'Andreas Mischok',
})

const goegap = freezeEnvironment({
  id: 'goegap',
  name: 'Goegap',
  hdrUrl: goegapHdrUrl,
  license: 'CC0-1.0',
  sourceUrl: 'https://polyhaven.com/a/goegap',
  author: 'Greg Zaal',
})

const polyHavenStudio = freezeEnvironment({
  id: 'poly-haven-studio',
  name: 'Poly Haven Studio',
  hdrUrl: polyHavenStudioHdrUrl,
  license: 'CC0-1.0',
  sourceUrl: 'https://polyhaven.com/a/poly_haven_studio',
  author: 'Greg Zaal',
})

export const BUILTIN_ENVIRONMENTS: readonly EnvironmentDefinition[] = Object.freeze([
  roglandClearNight,
  urbanStreet01,
  goegap,
  polyHavenStudio,
])
