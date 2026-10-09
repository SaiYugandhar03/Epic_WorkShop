import { useEffect, useMemo, useState } from 'react'

const initialState = {
  fileKey: '',
  token: '',
  outputPath: 'figma_design.json',
  prompt: 'Create a polished React login screen from the provided Figma design.',
  apiKey: '',
  baseUrl: 'https://api.x.ai/v1',
  model: 'grok-3-mini',
  outputDir: 'generated_react',
}

export default function App() {
  const [form, setForm] = useState(initialState)
  const [status, setStatus] = useState('Ready to extract Figma data or generate React code.')
  const [busy, setBusy] = useState(false)
  const [backendStatus, setBackendStatus] = useState('checking')
  const [summary, setSummary] = useState(null)
  const [runInfo, setRunInfo] = useState(null)
  const [files, setFiles] = useState({})
  const [activeFile, setActiveFile] = useState('')
  const [panelTab, setPanelTab] = useState('code')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)

  const fileNames = useMemo(() => Object.keys(files), [files])

  useEffect(() => {
    let cancelled = false

    const checkBackend = async () => {
      try {
        const response = await fetch('/api/health')
        if (!response.ok) {
          throw new Error('Backend did not respond correctly.')
        }
        if (!cancelled) {
          setBackendStatus('online')
        }
      } catch {
        if (!cancelled) {
          setBackendStatus('offline')
        }
      }
    }

    checkBackend()

    return () => {
      cancelled = true
    }
  }, [])

  const updateField = (field) => (event) => {
    setForm((current) => ({ ...current, [field]: event.target.value }))
  }

  const handleExtract = async (event) => {
    event.preventDefault()
    setBusy(true)
    setStatus('Extracting Figma JSON...')

    try {
      const response = await fetch('/api/extract-figma', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fileKey: form.fileKey,
          token: form.token,
          outputPath: form.outputPath,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to extract Figma data.')
      }

      setSummary(payload.summary)
      setRunInfo(null)
      setStatus(`Saved JSON to ${payload.outputPath}`)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  const handleGenerate = async (event) => {
    event.preventDefault()
    setBusy(true)
    setStatus('Generating React files...')

    try {
      const response = await fetch('/api/generate-react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          prompt: form.prompt,
          apiKey: form.apiKey,
          baseUrl: form.baseUrl,
          model: form.model,
          figmaJsonPath: form.outputPath,
          outputDir: form.outputDir,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to generate React code.')
      }

      setSummary(payload.summary)
      setFiles(payload.files)
      setActiveFile(Object.keys(payload.files)[0] || '')
      setPanelTab('code')
      setPreviewHtml('')
      setRunInfo({
        mode: payload.mode,
        outputDir: payload.outputDir,
        writtenPaths: payload.writtenPaths,
      })
      setStatus(`Generated ${payload.writtenPaths.length} file(s) using ${payload.mode} mode.`)
    } catch (error) {
      setStatus(error.message)
    } finally {
      setBusy(false)
    }
  }

  const buildPreview = async () => {
    const appCode = files['App.jsx']
    const stylesCode = files['styles.css']

    if (!appCode || !stylesCode) {
      setStatus('Generate both App.jsx and styles.css before opening the Visualize tab.')
      return
    }

    setPreviewLoading(true)
    setStatus('Building live preview...')

    try {
      const response = await fetch('/api/preview-react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          appCode,
          stylesCode,
        }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to build preview.')
      }

      setPreviewHtml(payload.html)
      setStatus('Preview is ready.')
    } catch (error) {
      setStatus(error.message)
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleCopy = async () => {
    if (!activeFile || !files[activeFile]) {
      return
    }

    try {
      await navigator.clipboard.writeText(files[activeFile])
      setStatus(`Copied ${activeFile} to clipboard.`)
    } catch {
      setStatus('Clipboard copy is not available in this browser context.')
    }
  }

  const handleDownload = () => {
    if (!activeFile || !files[activeFile]) {
      return
    }

    const blob = new Blob([files[activeFile]], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = activeFile
    anchor.click()
    URL.revokeObjectURL(url)
    setStatus(`Downloaded ${activeFile}.`)
  }

  const handleReset = () => {
    setSummary(null)
    setRunInfo(null)
    setFiles({})
    setActiveFile('')
    setPanelTab('code')
    setPreviewHtml('')
    setStatus('Reset the current run. Ready for new inputs.')
  }

  return (
    <div className="dashboard-shell">
      <main className="dashboard-grid">
        <section className="hero-panel">
          <div>
            <div className="brand-lockup">
              <div className="brand-mark" aria-hidden="true">
                <span className="brand-leaf" />
              </div>
              <div>
                <p className="eyebrow">Figma to React studio</p>
                <h1>Extract design data, generate code, and tune the backend flow from one screen.</h1>
              </div>
            </div>

            <div className="meta-row">
              <span className={backendStatus === 'online' ? 'pill online' : backendStatus === 'offline' ? 'pill offline' : 'pill'}>
                Backend {backendStatus}
              </span>
              <button type="button" className="ghost-button" onClick={handleReset}>
                Reset session
              </button>
            </div>

            <p className="subtitle">
              Enter your Figma file key and token, save the JSON, then generate React files with either your API key or the local fallback.
            </p>
          </div>

          <div className="preview-card">
            <p className="preview-label">Backend flow</p>
            <ul>
              <li>POST /api/extract-figma saves Figma JSON</li>
              <li>POST /api/generate-react returns App.jsx and styles.css</li>
              <li>Local fallback still works when no LLM key is present</li>
            </ul>
          </div>

          {summary ? (
            <div className="preview-card summary-card">
              <p className="preview-label">Current summary</p>
              <dl>
                <div>
                  <dt>Name</dt>
                  <dd>{summary.name || 'Unknown'}</dd>
                </div>
                <div>
                  <dt>Type</dt>
                  <dd>{summary.type || 'Unknown'}</dd>
                </div>
                <div>
                  <dt>Nodes</dt>
                  <dd>{summary.nodeCount ?? 0}</dd>
                </div>
              </dl>
            </div>
          ) : null}

          {runInfo ? (
            <div className="preview-card run-card">
              <p className="preview-label">Last generation</p>
              <p className="run-line">Mode: {runInfo.mode}</p>
              <p className="run-line">Output: {runInfo.outputDir}</p>
              <p className="run-line">Files: {runInfo.writtenPaths.length}</p>
            </div>
          ) : null}
        </section>

        <section className="form-panel">
          <form className="control-form">
            <div className="panel-group">
              <p className="panel-title">Figma extraction</p>
              <label>
                <span>Figma file key</span>
                <input value={form.fileKey} onChange={updateField('fileKey')} placeholder="e.g. AbCdEf123" />
              </label>
              <label>
                <span>Figma token</span>
                <input value={form.token} onChange={updateField('token')} placeholder="Personal access token" />
              </label>
              <label>
                <span>JSON output path</span>
                <input value={form.outputPath} onChange={updateField('outputPath')} placeholder="figma_design.json" />
              </label>
              <button type="button" onClick={handleExtract} disabled={busy}>
                Save Figma JSON
              </button>
            </div>

            <div className="panel-group">
              <p className="panel-title">React generation</p>
              <label>
                <span>Prompt</span>
                <textarea rows="4" value={form.prompt} onChange={updateField('prompt')} />
              </label>
              <label>
                <span>LLM API key</span>
                <input value={form.apiKey} onChange={updateField('apiKey')} placeholder="Optional: remote generation" />
              </label>
              <div className="split-grid">
                <label>
                  <span>Base URL</span>
                  <input value={form.baseUrl} onChange={updateField('baseUrl')} />
                </label>
                <label>
                  <span>Model</span>
                  <input value={form.model} onChange={updateField('model')} />
                </label>
              </div>
              <label>
                <span>Output directory</span>
                <input value={form.outputDir} onChange={updateField('outputDir')} placeholder="generated_react" />
              </label>
              <button type="button" onClick={handleGenerate} disabled={busy}>
                Generate React Files
              </button>
            </div>
          </form>

          <div className="status-bar" role="status" aria-live="polite">
            <span>{status}</span>
          </div>

          {fileNames.length > 0 ? (
            <div className="output-panel">
              <div className="output-topbar">
                <div className="view-tabs" role="tablist" aria-label="Output view tabs">
                  <button
                    type="button"
                    className={panelTab === 'code' ? 'tab-button active' : 'tab-button'}
                    onClick={() => setPanelTab('code')}
                  >
                    Code
                  </button>
                  <button
                    type="button"
                    className={panelTab === 'visualize' ? 'tab-button active' : 'tab-button'}
                    onClick={async () => {
                      setPanelTab('visualize')
                      if (!previewHtml) {
                        await buildPreview()
                      }
                    }}
                  >
                    Visualize
                  </button>
                </div>
                <div className="output-actions">
                  <button type="button" className="ghost-button" onClick={handleCopy} disabled={panelTab !== 'code'}>
                    Copy
                  </button>
                  <button type="button" className="ghost-button" onClick={handleDownload} disabled={panelTab !== 'code'}>
                    Download
                  </button>
                </div>
              </div>
              {panelTab === 'code' ? (
                <>
                  <div className="output-tabs" role="tablist" aria-label="Generated files">
                    {fileNames.map((name) => (
                      <button
                        key={name}
                        type="button"
                        className={name === activeFile ? 'tab-button active' : 'tab-button'}
                        onClick={() => setActiveFile(name)}
                      >
                        {name}
                      </button>
                    ))}
                  </div>
                  <pre className="code-view">
                    <code>{files[activeFile]}</code>
                  </pre>
                </>
              ) : (
                <div className="preview-frame-shell">
                  {previewLoading ? (
                    <div className="preview-loading">Rendering preview...</div>
                  ) : previewHtml ? (
                    <iframe title="Generated React preview" className="preview-frame" srcDoc={previewHtml} />
                  ) : (
                    <div className="preview-loading">No preview available yet.</div>
                  )}
                </div>
              )}
            </div>
          ) : (
            <div className="output-panel output-empty">
              <p>No generated code yet. Fill in the fields and run extraction or generation.</p>
            </div>
          )}
        </section>
      </main>
    </div>
  )
}
