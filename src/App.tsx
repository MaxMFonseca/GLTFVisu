function App() {
  return (
    <div className="workspace-shell">
      <aside className="workspace-panel workspace-library" aria-label="Shader library">
        <h1>Shaders</h1>
        <p>Load a model to begin exploring materials.</p>
      </aside>

      <main className="workspace-viewer" aria-label="Shader workspace">
        <section className="viewer-empty-state" aria-label="3D viewer">
          <h2>Viewer</h2>
          <p>Drop a GLB or GLTF file here to preview its shaders.</p>
        </section>
      </main>

      <aside className="workspace-panel workspace-editor" aria-label="Shader editor">
        <h2>Editor</h2>
        <p>Select a shader to edit its fragment source.</p>
      </aside>
    </div>
  )
}

export default App
