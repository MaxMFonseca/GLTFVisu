function decodePath(value: string): string {
  try {
    return decodeURIComponent(value)
  } catch {
    return value
  }
}

export function normalizeResourcePath(value: string): string {
  const suffixIndex = [value.indexOf('?'), value.indexOf('#')]
    .filter((index) => index >= 0)
    .reduce((first, index) => Math.min(first, index), value.length)
  const segments: string[] = []

  for (const segment of decodePath(value.slice(0, suffixIndex)).replaceAll('\\', '/').split('/')) {
    if (!segment || segment === '.') continue
    if (segment === '..') {
      if (segments.length > 0 && segments.at(-1) !== '..') segments.pop()
      else segments.push(segment)
      continue
    }
    segments.push(segment)
  }

  return segments.join('/')
}

export function relativePathForFile(file: File): string {
  return normalizeResourcePath(file.webkitRelativePath || file.name)
}

export function basename(path: string): string {
  return path.split('/').at(-1) ?? ''
}

export function directoryOf(path: string): string {
  const lastSlash = path.lastIndexOf('/')
  return lastSlash < 0 ? '' : path.slice(0, lastSlash + 1)
}
