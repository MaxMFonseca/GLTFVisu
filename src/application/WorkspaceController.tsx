import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useReducer,
  useRef,
  type ReactNode,
} from 'react'
import { BUILTIN_SHADERS } from '../domain/builtins'
import { parseShaderPackage, serializeShader } from '../domain/importExport'
import {
  createDefaultValue,
  normalizeParameterValue,
  type ShaderParameterDefinition,
  type ShaderParameterValue,
} from '../domain/parameters'
import type { ShaderDefinition, ShaderDraft } from '../domain/shader'
import { validateParameterDefinitions } from '../domain/uniformValidation'
import type { ShaderRepository } from './ShaderRepository'
import type { ViewerPort } from './ViewerPort'
import type { WorkspaceCommands } from './commands'
import { createInitialWorkspaceState, workspaceReducer } from './workspaceReducer'
import {
  cloneShader,
  cloneShaderWithBuiltinParameterValues,
  hasLoadedModel,
  type WorkspaceState,
} from './workspaceState'

const COMPILE_DEBOUNCE_MS = 400
const DEFAULT_FRAGMENT_SOURCE = `void main() {
  outColor = vec4(1.0);
}`

export interface TimerPort {
  set(callback: () => void, milliseconds: number): unknown
  clear(handle: unknown): void
}

export interface ObjectUrlPort {
  createObjectURL(blob: Blob): string
  revokeObjectURL(url: string): void
}

export type DownloadPort = (url: string, filename: string) => void

export interface WorkspaceProviderProps {
  repository: ShaderRepository
  viewer: ViewerPort
  builtins?: readonly ShaderDefinition[]
  idFactory?: () => string
  now?: () => number
  timer?: TimerPort
  urls?: ObjectUrlPort
  download?: DownloadPort
  children?: ReactNode
}

export interface WorkspaceContextValue {
  state: WorkspaceState
  commands: WorkspaceCommands
}

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined)

const DEFAULT_TIMER: TimerPort = {
  set: (callback, milliseconds) => window.setTimeout(callback, milliseconds),
  clear: (handle) => window.clearTimeout(handle as number),
}

function defaultDownload(url: string, filename: string): void {
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Unexpected workspace error'
}

function safeFilename(name: string): string {
  const stem = name.trim().replace(/[\\/:*?"<>|]+/g, '-').replace(/\s+/g, ' ') || 'shader'
  return `${stem}.shader.json`
}

function sameParameterDefinition(
  left: ShaderParameterDefinition,
  right: ShaderParameterDefinition,
): boolean {
  if (
    left.id !== right.id
    || left.type !== right.type
    || left.uniformName !== right.uniformName
    || left.label !== right.label
    || left.defaultValue !== right.defaultValue
  ) return false
  if (left.type === 'color' || left.type === 'boolean') return true
  if (right.type === 'color' || right.type === 'boolean') return false
  return left.min === right.min && left.max === right.max && left.step === right.step
}

function sameParameterSchema(
  left: readonly ShaderParameterDefinition[],
  right: readonly ShaderParameterDefinition[],
): boolean {
  return left.length === right.length
    && left.every((parameter, index) => {
      const counterpart = right[index]
      return counterpart !== undefined && sameParameterDefinition(parameter, counterpart)
    })
}

function reselectedSaveAdoptsShaderChanges(
  current: WorkspaceState,
  saved: ShaderDefinition,
  submittedSelectionRevision: number,
): boolean {
  if (saved.id !== current.selectedId || submittedSelectionRevision === current.selectionRevision) return false
  return (!current.dirty.source && saved.fragmentSource !== current.draft.fragmentSource)
    || (!current.dirty.schema && !sameParameterSchema(saved.parameters, current.draft.parameters))
}

function normalizeForSave(draft: ShaderDraft, timestamp: number): ShaderDefinition {
  const name = draft.name.trim()
  if (name.length === 0) throw new Error('Shader name is required')
  const errors = validateParameterDefinitions(draft.parameters)
  if (errors.length > 0) throw new Error('Shader parameter schema is invalid')
  const parameterValues: Record<string, ShaderParameterValue> = {}
  for (const parameter of draft.parameters) {
    parameterValues[parameter.id] = normalizeParameterValue(
      parameter,
      draft.parameterValues[parameter.id] ?? createDefaultValue(parameter),
    )
  }
  return {
    ...cloneShader(draft),
    name,
    origin: 'local',
    parameters: draft.parameters.map((parameter) => ({ ...parameter })),
    parameterValues,
    createdAt: draft.createdAt ?? timestamp,
    updatedAt: timestamp,
  }
}

function createLocal(id: string, timestamp: number): ShaderDefinition {
  return {
    id,
    name: 'Untitled shader',
    fragmentSource: DEFAULT_FRAGMENT_SOURCE,
    origin: 'local',
    parameters: [],
    parameterValues: {},
    createdAt: timestamp,
    updatedAt: timestamp,
    schemaVersion: 2,
    materialInputProfile: 'none',
  }
}

function duplicateLocal(shader: ShaderDefinition, id: string, timestamp: number): ShaderDefinition {
  const duplicate: ShaderDefinition = {
    ...cloneShader(shader),
    id,
    name: `${shader.name} copy`,
    origin: 'local',
    createdAt: timestamp,
    updatedAt: timestamp,
  }
  if (duplicate.portrait?.kind === 'bundled') delete duplicate.portrait
  return duplicate
}

export function WorkspaceProvider({
  repository,
  viewer,
  builtins = BUILTIN_SHADERS,
  idFactory = () => crypto.randomUUID(),
  now = () => Date.now(),
  timer = DEFAULT_TIMER,
  urls = URL,
  download = defaultDownload,
  children,
}: WorkspaceProviderProps) {
  const [state, dispatch] = useReducer(workspaceReducer, builtins, createInitialWorkspaceState)
  const stateRef = useRef(state)
  const activeRef = useRef(true)
  const compileTimerRef = useRef<unknown>(undefined)
  const compileGenerationRef = useRef(0)
  const loadGenerationRef = useRef(0)
  stateRef.current = state

  const cancelScheduledCompile = useCallback(() => {
    if (compileTimerRef.current === undefined) return
    timer.clear(compileTimerRef.current)
    compileTimerRef.current = undefined
  }, [timer])

  const compileDraft = useCallback(async (draft: ShaderDraft): Promise<void> => {
    const errors = validateParameterDefinitions(draft.parameters)
    if (errors.length > 0) {
      const generation = ++compileGenerationRef.current
      if (activeRef.current) dispatch({ type: 'schemaInvalid', generation, errors })
      return
    }
    const generation = ++compileGenerationRef.current
    dispatch({ type: 'compileStarted', generation })
    try {
      const result = await viewer.compileShader(cloneShader(draft))
      if (activeRef.current) dispatch({ type: 'compileFinished', generation, result })
    } catch (error) {
      if (!activeRef.current) return
      dispatch({
        type: 'compileFinished',
        generation,
        result: {
          status: 'error',
          generation,
          diagnostics: [{ severity: 'error', message: errorMessage(error), raw: errorMessage(error) }],
        },
      })
    }
  }, [viewer])

  const scheduleCompile = useCallback((selectedId: string) => {
    cancelScheduledCompile()
    const generation = ++compileGenerationRef.current
    dispatch({ type: 'compileInvalidated', generation })
    compileTimerRef.current = timer.set(() => {
      compileTimerRef.current = undefined
      const current = stateRef.current
      if (
        !activeRef.current
        || current.selectedId !== selectedId
        || current.compile.generation !== generation
      ) return
      void compileDraft(current.draft)
    }, COMPILE_DEBOUNCE_MS)
  }, [cancelScheduledCompile, compileDraft, timer])

  const findShader = useCallback((id: string): ShaderDefinition | undefined => {
    const current = stateRef.current
    return current.builtins.find((shader) => shader.id === id)
      ?? current.locals.find((shader) => shader.id === id)
  }, [])

  const selectConcreteShader = useCallback((shader: ShaderDefinition) => {
    cancelScheduledCompile()
    dispatch({ type: 'select', shader })
    const compileInput = shader.origin === 'builtin'
      ? cloneShaderWithBuiltinParameterValues(shader, stateRef.current.builtinParameterValues)
      : shader
    void compileDraft(compileInput)
  }, [cancelScheduledCompile, compileDraft])

  useEffect(() => {
    activeRef.current = true
    void repository.list().then(
      (locals) => {
        if (activeRef.current) dispatch({ type: 'hydrateSucceeded', locals })
      },
      (error: unknown) => {
        if (activeRef.current) dispatch({ type: 'hydrateFailed', message: errorMessage(error) })
      },
    )
    void compileDraft(stateRef.current.draft)
    return () => {
      activeRef.current = false
      cancelScheduledCompile()
      compileGenerationRef.current += 1
      loadGenerationRef.current += 1
    }
  }, [cancelScheduledCompile, compileDraft, repository])

  const commands: WorkspaceCommands = {
    selectShader(id) {
      const shader = findShader(id)
      if (shader !== undefined && shader.id !== stateRef.current.selectedId) selectConcreteShader(shader)
    },
    async createShader() {
      const shader = createLocal(idFactory(), now())
      try {
        await repository.save(shader)
        if (!activeRef.current) return
        dispatch({ type: 'installLocal', shader })
        void compileDraft(shader)
      } catch (error) {
        if (activeRef.current) dispatch({ type: 'operationFailed', scope: 'save', message: errorMessage(error) })
      }
    },
    async duplicateShader(id) {
      const current = stateRef.current
      const source = findShader(id ?? current.selectedId)
      if (source === undefined) return
      const duplicateSource = source.origin === 'builtin'
        ? {
            ...source,
            parameterValues: {
              ...source.parameterValues,
              ...current.builtinParameterValues[source.id],
            },
          }
        : source
      const shader = duplicateLocal(duplicateSource, idFactory(), now())
      try {
        await repository.save(shader)
        if (!activeRef.current) return
        dispatch({ type: 'installLocal', shader })
        void compileDraft(shader)
      } catch (error) {
        if (activeRef.current) dispatch({ type: 'operationFailed', scope: 'save', message: errorMessage(error) })
      }
    },
    editName(name) {
      if (stateRef.current.draft.origin === 'builtin') return
      dispatch({ type: 'editName', name })
    },
    editSource(source) {
      const current = stateRef.current.draft
      if (current.origin === 'builtin') return
      dispatch({ type: 'editSource', source })
      scheduleCompile(current.id)
    },
    editSchema(parameters, parameterValues) {
      const current = stateRef.current.draft
      if (current.origin === 'builtin') return
      const definitions = parameters.map((parameter) => ({ ...parameter }))
      const values = { ...parameterValues }
      dispatch({ type: 'editSchema', parameters: definitions, parameterValues: values })
      const errors = validateParameterDefinitions(definitions)
      if (errors.length > 0) {
        cancelScheduledCompile()
        const generation = ++compileGenerationRef.current
        dispatch({ type: 'schemaInvalid', generation, errors })
      } else {
        scheduleCompile(current.id)
      }
    },
    updateValue(parameterId, value) {
      const current = stateRef.current.draft
      const definition = current.parameters.find((parameter) => parameter.id === parameterId)
      if (definition === undefined) return
      const normalized = normalizeParameterValue(definition, value)
      viewer.updateParameter(definition, normalized)
      dispatch({ type: 'editValue', parameterId, value: normalized })
    },
    async save() {
      const current = stateRef.current.draft
      if (current.origin === 'builtin' || stateRef.current.compile.status !== 'valid') return
      const errors = validateParameterDefinitions(current.parameters)
      if (errors.length > 0) {
        cancelScheduledCompile()
        const generation = ++compileGenerationRef.current
        dispatch({ type: 'schemaInvalid', generation, errors })
        return
      }
      let snapshot: ShaderDefinition
      const submittedRevisions = { ...stateRef.current.fieldRevisions }
      const selectionRevision = stateRef.current.selectionRevision
      try {
        snapshot = normalizeForSave(current, now())
      } catch (error) {
        dispatch({ type: 'operationFailed', scope: 'save', message: errorMessage(error) })
        return
      }
      dispatch({ type: 'saveStarted' })
      try {
        await repository.save(snapshot)
        if (activeRef.current) {
          const shouldRecompile = reselectedSaveAdoptsShaderChanges(
            stateRef.current,
            snapshot,
            selectionRevision,
          )
          dispatch({ type: 'saveSucceeded', shader: snapshot, submittedRevisions, selectionRevision })
          dispatch({ type: 'operationSucceeded', scope: 'save', message: `Saved ${snapshot.name}` })
          if (shouldRecompile) scheduleCompile(snapshot.id)
        }
      } catch (error) {
        if (activeRef.current) dispatch({ type: 'operationFailed', scope: 'save', message: errorMessage(error) })
      }
    },
    async deleteShader(id) {
      const targetId = id ?? stateRef.current.selectedId
      const target = findShader(targetId)
      if (target?.origin !== 'local') return
      try {
        await repository.delete(targetId)
        if (!activeRef.current) return
        const current = stateRef.current
        if (current.selectedId !== targetId) {
          dispatch({ type: 'deleteSucceeded', id: targetId })
          return
        }
        const fallback = current.locals.find((shader) => shader.id !== targetId) ?? current.builtins[0]
        if (fallback === undefined) return
        cancelScheduledCompile()
        dispatch({ type: 'deleteSucceeded', id: targetId, fallback })
        void compileDraft(fallback)
      } catch (error) {
        if (activeRef.current) dispatch({ type: 'operationFailed', scope: 'delete', message: errorMessage(error) })
      }
    },
    async importShader(packageJson) {
      try {
        const shader = parseShaderPackage(packageJson, idFactory, now())
        await repository.save(shader)
        if (!activeRef.current) return
        cancelScheduledCompile()
        dispatch({ type: 'installLocal', shader, message: `Imported ${shader.name}` })
        void compileDraft(shader)
      } catch (error) {
        if (activeRef.current) dispatch({ type: 'operationFailed', scope: 'import', message: errorMessage(error) })
      }
    },
    async exportShader(id) {
      const shader = findShader(id ?? stateRef.current.selectedId)
      if (shader === undefined) return
      let objectUrl: string | undefined
      try {
        const json = await serializeShader(shader)
        objectUrl = urls.createObjectURL(new Blob([json], { type: 'application/json' }))
        download(objectUrl, safeFilename(shader.name))
        if (activeRef.current) {
          dispatch({ type: 'operationSucceeded', scope: 'export', message: `Exported ${shader.name}` })
        }
      } catch (error) {
        if (activeRef.current) dispatch({ type: 'operationFailed', scope: 'export', message: errorMessage(error) })
      } finally {
        if (objectUrl !== undefined) urls.revokeObjectURL(objectUrl)
      }
    },
    async capturePortrait() {
      const selectedId = stateRef.current.selectedId
      if (
        stateRef.current.draft.origin !== 'local'
        || !hasLoadedModel(stateRef.current.modelLoad)
        || stateRef.current.compile.status !== 'valid'
      ) {
        dispatch({ type: 'operationFailed', scope: 'capture', message: 'Load a model with a valid local shader before capture' })
        return
      }
      try {
        const portrait = await viewer.capturePortrait()
        if (activeRef.current && stateRef.current.selectedId === selectedId) {
          dispatch({ type: 'portraitCaptured', portrait })
          dispatch({
            type: 'operationSucceeded',
            scope: 'capture',
            message: `Captured portrait for ${stateRef.current.draft.name}`,
          })
        }
      } catch (error) {
        if (activeRef.current) dispatch({ type: 'operationFailed', scope: 'capture', message: errorMessage(error) })
      }
    },
    async loadModel(files, root) {
      const generation = ++loadGenerationRef.current
      dispatch({ type: 'modelLoadStarted', fileName: root.name })
      try {
        const info = await viewer.loadModel(files, root)
        if (activeRef.current && generation === loadGenerationRef.current) dispatch({ type: 'modelLoadSucceeded', info })
      } catch (error) {
        if (activeRef.current && generation === loadGenerationRef.current) {
          dispatch({ type: 'operationFailed', scope: 'model', message: errorMessage(error) })
        }
      }
    },
    fitModel() {
      viewer.fitModel()
    },
    resizeViewer() {
      viewer.resize()
    },
    selectAnimation(name) {
      if (!stateRef.current.animations.clips.some((clip) => clip.id === name)) return
      viewer.selectAnimation(name)
      dispatch({ type: 'animationsChanged', selectedClipId: name, playing: stateRef.current.animations.playing })
    },
    setAnimationPlaying(playing) {
      if (!hasLoadedModel(stateRef.current.modelLoad)) return
      viewer.setAnimationPlaying(playing)
      dispatch({ type: 'animationsChanged', selectedClipId: stateRef.current.animations.selectedClipId, playing })
    },
    async compile() {
      cancelScheduledCompile()
      await compileDraft(stateRef.current.draft)
    },
    clearNotices() {
      dispatch({ type: 'clearNotices' })
    },
  }

  return <WorkspaceContext.Provider value={{ state, commands }}>{children}</WorkspaceContext.Provider>
}

// The task's public API intentionally colocates the provider and its hook.
// eslint-disable-next-line react-refresh/only-export-components
export function useWorkspace(): WorkspaceContextValue {
  const context = useContext(WorkspaceContext)
  if (context === undefined) throw new Error('useWorkspace must be used within WorkspaceProvider')
  return context
}
