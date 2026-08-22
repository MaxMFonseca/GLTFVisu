export interface DefaultModelDefinition {
  url: string
  fileName: string
  initialAnimation?: {
    name: string
    playing: boolean
  }
}

export type DefaultModelFetcher = (url: string) => Promise<Blob>

export async function fetchDefaultModel(
  definition: DefaultModelDefinition,
  fetcher: DefaultModelFetcher,
): Promise<File> {
  if (definition.fileName.trim().length === 0) throw new Error('Invalid default model filename')
  const blob = await fetcher(definition.url)
  return new File([blob], definition.fileName, { type: 'model/gltf-binary' })
}

export async function fetchDefaultModelBlob(
  url: string,
  fetcher: typeof fetch = fetch,
): Promise<Blob> {
  const response = await fetcher(url)
  if (!response.ok) throw new Error('Unable to load the default model')
  return response.blob()
}
