import foxModelUrl from '../assets/models/fox.glb?url'
import studioEnvironmentUrl from '../assets/environments/poly-haven-studio-1k.hdr?url'
import type { CompileResult, ModelInfo } from '../application/ViewerPort'
import { cloneShader } from '../application/workspaceState'
import { BUILTIN_SHADERS } from '../domain/builtins'
import type { EnvironmentDisplaySettings, EnvironmentLoadSource } from '../domain/environment'
import type { ShaderDraft } from '../domain/shader'
import { ViewerEngine } from '../three/ViewerEngine'
import { PORTRAIT_BACKGROUND } from './portraitConfig'

export interface PortraitViewer {
  loadModel(files: File[], root: File): Promise<ModelInfo>
  loadEnvironment(source: EnvironmentLoadSource): Promise<void>
  updateEnvironment(settings: EnvironmentDisplaySettings): void
  compileShader(draft: ShaderDraft): Promise<CompileResult>
  selectAnimation(name: string): void
  setAnimationPlaying(playing: boolean): void
  setPortraitView(): void
  dispose(): void
}

export interface RenderBuiltinPortraitDependencies {
  fetch?: typeof globalThis.fetch
  createViewer?: (host: HTMLElement) => PortraitViewer
  waitForAnimationFrame?: () => Promise<void>
}

const PORTRAIT_ENVIRONMENT_SETTINGS: EnvironmentDisplaySettings = {
  backgroundMode: 'clear-color',
  clearColor: PORTRAIT_BACKGROUND,
  rotation: 0,
  intensity: 1,
  blur: 0,
}

export async function renderBuiltinPortrait(
  host: HTMLElement,
  shaderId: string,
  dependencies: RenderBuiltinPortraitDependencies = {},
): Promise<void> {
  window.__GLTFVISU_PORTRAIT__ = { status: 'loading', shaderId }
  let viewer: PortraitViewer | undefined
  let teardown: (() => void) | undefined

  try {
    const shader = BUILTIN_SHADERS.find(({ id }) => id === shaderId)
    if (shader === undefined) throw new Error(`Unknown built-in shader: ${shaderId}`)

    const response = await (dependencies.fetch ?? globalThis.fetch)(foxModelUrl)
    if (!response.ok) throw new Error('Unable to load Fox')
    const model = new File([await response.blob()], 'fox.glb', { type: 'model/gltf-binary' })

    viewer = dependencies.createViewer?.(host) ?? new ViewerEngine(host, {}, { devicePixelRatio: 1 })
    teardown = () => viewer?.dispose()
    window.addEventListener('pagehide', teardown, { once: true })

    const modelInfo = await viewer.loadModel([model], model)
    const survey = modelInfo.animationClips.find(({ label }) => label === 'Survey')
    if (survey === undefined) throw new Error('Fox is missing its Survey animation')
    viewer.selectAnimation(survey.id)
    viewer.setAnimationPlaying(false)
    await viewer.loadEnvironment({
      kind: 'bundled',
      id: 'poly-haven-studio',
      url: studioEnvironmentUrl,
    })
    viewer.updateEnvironment(PORTRAIT_ENVIRONMENT_SETTINGS)
    const compileResult = await viewer.compileShader(cloneShader(shader))
    if (compileResult.status === 'error') {
      throw new Error(compileResult.diagnostics[0]?.message ?? 'Unable to compile built-in shader')
    }
    viewer.setPortraitView()

    const waitForFrame = dependencies.waitForAnimationFrame ?? waitForAnimationFrame
    await waitForFrame()
    await waitForFrame()
    window.__GLTFVISU_PORTRAIT__ = { status: 'ready', shaderId }
  } catch (error) {
    if (teardown !== undefined) window.removeEventListener('pagehide', teardown)
    viewer?.dispose()
    window.__GLTFVISU_PORTRAIT__ = {
      status: 'error',
      shaderId,
      message: error instanceof Error ? error.message : 'Unexpected portrait capture error',
    }
  }
}

function waitForAnimationFrame(): Promise<void> {
  return new Promise((resolve) => {
    window.requestAnimationFrame(() => resolve())
  })
}
