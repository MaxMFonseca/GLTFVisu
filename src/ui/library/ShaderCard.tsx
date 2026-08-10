import { useEffect, useState } from 'react'
import type { ShaderDefinition } from '../../domain/shader'

export interface PortraitUrlPort {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export interface ShaderCardProps {
  shader: ShaderDefinition
  selected: boolean
  onSelect(id: string): void
  urls?: PortraitUrlPort
}

export function ShaderCard({ shader, selected, onSelect, urls = URL }: ShaderCardProps) {
  const [capturedUrl, setCapturedUrl] = useState<string>()

  useEffect(() => {
    if (shader.portrait?.kind !== 'captured') {
      setCapturedUrl(undefined)
      return
    }
    const nextUrl = urls.createObjectURL(shader.portrait.blob)
    setCapturedUrl(nextUrl)
    return () => urls.revokeObjectURL(nextUrl)
  }, [shader.portrait, urls])

  const portraitUrl = shader.portrait?.kind === 'bundled' ? shader.portrait.url : capturedUrl

  return (
    <li className="shader-card-item">
      <button
        className="shader-card"
        type="button"
        aria-current={selected ? 'true' : undefined}
        aria-label={shader.name}
        onClick={() => onSelect(shader.id)}
      >
        {portraitUrl === undefined
          ? <span className="shader-card-placeholder" role="img" aria-label={`No preview for ${shader.name}`}>◇</span>
          : <img src={portraitUrl} alt={`${shader.name} preview`} />}
        <span className="shader-card-name">{shader.name}</span>
      </button>
    </li>
  )
}
