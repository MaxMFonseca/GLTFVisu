import { useState, type ChangeEvent, type DragEvent } from 'react'
import { useWorkspace } from '../../application/WorkspaceController'

function filePath(file: File): string {
  return file.webkitRelativePath || file.name
}

function compareFilePaths(left: File, right: File): number {
  const leftPath = filePath(left)
  const rightPath = filePath(right)
  return leftPath.localeCompare(rightPath, 'en', { sensitivity: 'base' })
    || leftPath.localeCompare(rightPath, 'en')
}

function isModelRoot(file: File): boolean {
  return /\.(?:glb|gltf)$/i.test(file.name)
}

export function ModelLoader() {
  const { state, commands } = useWorkspace()
  const [selectedFiles, setSelectedFiles] = useState<File[]>([])
  const [roots, setRoots] = useState<File[]>([])
  const [rootPath, setRootPath] = useState('')
  const [selectionError, setSelectionError] = useState<string>()

  function receiveFiles(files: File[]): void {
    const nextRoots = files.filter(isModelRoot).sort(compareFilePaths)
    setSelectedFiles(files)
    setRoots(nextRoots)
    setRootPath(nextRoots[0] === undefined ? '' : filePath(nextRoots[0]))
    if (nextRoots.length === 0) {
      setSelectionError('Selected files must include a .glb or .gltf root.')
      return
    }
    setSelectionError(undefined)
    if (nextRoots.length === 1) void commands.loadModel(files, nextRoots[0])
  }

  function chooseFiles(event: ChangeEvent<HTMLInputElement>): void {
    const files = Array.from(event.currentTarget.files ?? [])
    event.currentTarget.value = ''
    receiveFiles(files)
  }

  function dropFiles(event: DragEvent<HTMLDivElement>): void {
    event.preventDefault()
    receiveFiles(Array.from(event.dataTransfer.files))
  }

  function loadSelectedRoot(): void {
    const root = roots.find((candidate) => filePath(candidate) === rootPath)
    if (root !== undefined) void commands.loadModel(selectedFiles, root)
  }

  return (
    <section className="model-loader" aria-labelledby="model-loader-heading">
      <div className="model-loader-heading">
        <div>
          <p className="panel-kicker">Asset</p>
          <h2 id="model-loader-heading">Model</h2>
        </div>
        <label className="button-label">
          Choose files
          <input className="visually-hidden" type="file" multiple aria-label="Choose model files" onChange={chooseFiles} />
        </label>
      </div>

      <div
        className="model-drop-zone"
        data-testid="model-drop-zone"
        onDragOver={(event) => event.preventDefault()}
        onDrop={dropFiles}
      >
        <p>Drop a GLB or GLTF with its local dependencies.</p>
        <span>Files stay on this device.</span>
      </div>

      {selectedFiles.length > 0 && (
        <details className="selected-files" open>
          <summary>{selectedFiles.length} {selectedFiles.length === 1 ? 'file' : 'files'} selected</summary>
          <ul>{selectedFiles.map((file, index) => <li key={`${filePath(file)}-${index}`}>{filePath(file)}</li>)}</ul>
        </details>
      )}

      {roots.length > 1 && (
        <div className="root-selector">
          <label htmlFor="model-root">Model root</label>
          <select id="model-root" value={rootPath} onChange={(event) => setRootPath(event.currentTarget.value)}>
            {roots.map((root) => <option key={filePath(root)} value={filePath(root)}>{filePath(root)}</option>)}
          </select>
          <button type="button" onClick={loadSelectedRoot}>Load selected model</button>
        </div>
      )}

      {selectionError !== undefined && <p className="panel-message panel-error" role="alert">{selectionError}</p>}
      {state.modelLoad.status === 'empty' && selectedFiles.length === 0 && <p className="panel-message">No model loaded.</p>}
      {state.modelLoad.status === 'loading' && <p className="panel-message" role="status">Loading {state.modelLoad.fileName}…</p>}
      {state.modelLoad.status === 'loaded' && <p className="model-summary">{state.modelLoad.name} · {state.modelLoad.meshCount} {state.modelLoad.meshCount === 1 ? 'mesh' : 'meshes'}</p>}
      {state.modelLoad.status === 'error' && <p className="panel-message panel-error" role="alert">{state.modelLoad.message}</p>}
    </section>
  )
}
