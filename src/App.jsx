import { useEffect, useMemo, useState } from 'react'
import {
  IxApplication,
  IxApplicationHeader,
  IxContent,
  IxCard,
  IxCardTitle,
  IxCardContent,
  IxInput,
  IxTextarea,
  IxButton,
  IxTypography,
  IxMessageBar,
  IxTabs,
  IxTabItem,
  IxPill,
  IxSpinner,
} from '@siemens/ix-react'

const initialState = {
  fileKey: '',
  token: '',
  outputPath: 'figma_design.json',
  prompt: 'Create a polished React screen from the provided Figma design using Siemens iX components.',
  apiKey: '',
  baseUrl: 'https://api.x.ai/v1',
  model: 'grok-3-mini',
  outputDir: 'generated_react',
}

const JSON_PREVIEW_LIMIT = 400_000

function formatBytes(bytes) {
  if (!Number.isFinite(bytes)) return 'Unknown size'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`
}

export default function App() {
  const [form, setForm] = useState(initialState)
  const [status, setStatus] = useState('Ready to extract Figma data or generate React code.')
  const [statusTone, setStatusTone] = useState('info')
  const [busy, setBusy] = useState(false)
  const [jsonBusy, setJsonBusy] = useState(false)
  const [backendStatus, setBackendStatus] = useState('checking')
  const [themeMode, setThemeMode] = useState(() => {
    if (typeof window === 'undefined') {
      return 'light'
    }

    const savedMode = window.localStorage.getItem('trio-theme-mode')
    if (savedMode === 'light' || savedMode === 'dark') {
      return savedMode
    }

    return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  })
  const [summary, setSummary] = useState(null)
  const [runInfo, setRunInfo] = useState(null)
  const [files, setFiles] = useState({})
  const [activeFile, setActiveFile] = useState('')
  const [panelTab, setPanelTab] = useState('figma-json')
  const [previewHtml, setPreviewHtml] = useState('')
  const [previewLoading, setPreviewLoading] = useState(false)
  const [figmaJson, setFigmaJson] = useState(null)
  const [figmaMeta, setFigmaMeta] = useState(null)

  const fileNames = useMemo(() => Object.keys(files), [files])

  const announce = (message, tone = 'info') => {
    setStatus(message)
    setStatusTone(tone)
  }

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

  useEffect(() => {
    const root = document.documentElement
    root.setAttribute('data-ix-theme', 'classic')
    root.setAttribute('data-ix-color-schema', themeMode)
    window.localStorage.setItem('trio-theme-mode', themeMode)
  }, [themeMode])

  const updateField = (field) => (event) => {
    const value = event && event.detail !== undefined ? event.detail : event?.target?.value ?? ''
    setForm((current) => ({ ...current, [field]: value }))
  }

  const buildPreview = async (appCode, stylesCode) => {
    setPreviewLoading(true)
    announce('Building live preview...', 'info')

    try {
      const response = await fetch('/api/preview-react', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ appCode, stylesCode }),
      })

      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to build preview.')
      }

      setPreviewHtml(payload.html)
      announce('Preview is ready.', 'success')
    } catch (error) {
      announce(error.message, 'error')
    } finally {
      setPreviewLoading(false)
    }
  }

  const handleExtract = async () => {
    setBusy(true)
    announce('Extracting Figma JSON...', 'info')

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
      setFigmaJson(payload.raw ?? null)
      setFigmaMeta({ path: payload.outputPath, size: payload.size })
      setRunInfo(null)
      setPanelTab('figma-json')
      announce(`Saved JSON to ${payload.outputPath} (${formatBytes(payload.size)}).`, 'success')
    } catch (error) {
      announce(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleLoadSavedJson = async () => {
    setJsonBusy(true)
    announce('Loading saved Figma JSON...', 'info')

    try {
      const response = await fetch(`/api/figma-json?path=${encodeURIComponent(form.outputPath)}`)
      const payload = await response.json()
      if (!response.ok) {
        throw new Error(payload.error || 'Failed to load Figma JSON.')
      }

      setSummary(payload.summary)
      setFigmaJson(payload.raw ?? null)
      setFigmaMeta({ path: payload.path, size: payload.size })
      setPanelTab('figma-json')
      announce(`Loaded ${payload.path} (${formatBytes(payload.size)}).`, 'success')
    } catch (error) {
      announce(error.message, 'error')
    } finally {
      setJsonBusy(false)
    }
  }

  const handleGenerate = async () => {
    setBusy(true)
    announce('Generating React files with Siemens iX components...', 'info')

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
      const fallbackNote = payload.remoteError ? ` (Remote generation fell back to local: ${payload.remoteError})` : ''
      announce(
        `Generated ${payload.writtenPaths.length} file(s) using ${payload.mode} mode.${fallbackNote}`,
        payload.remoteError ? 'warning' : 'success',
      )
    } catch (error) {
      announce(error.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const handleTabChange = (event) => {
    const nextTab = event.detail
    setPanelTab(nextTab)
    if (nextTab === 'visualize' && !previewHtml && files['App.jsx']) {
      buildPreview(files['App.jsx'], files['styles.css'])
    }
  }

  const handleCopy = async (text, label) => {
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      announce(`Copied ${label} to clipboard.`, 'success')
    } catch {
      announce('Clipboard copy is not available in this browser context.', 'warning')
    }
  }

  const handleDownload = (filename, content) => {
    if (!content) return
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const anchor = document.createElement('a')
    anchor.href = url
    anchor.download = filename
    anchor.click()
    URL.revokeObjectURL(url)
    announce(`Downloaded ${filename}.`, 'success')
  }

  const handleReset = () => {
    setSummary(null)
    setRunInfo(null)
    setFiles({})
    setActiveFile('')
    setPanelTab('figma-json')
    setPreviewHtml('')
    setFigmaJson(null)
    setFigmaMeta(null)
    announce('Reset the current run. Ready for new inputs.', 'info')
  }

  const toggleTheme = () => {
    setThemeMode((current) => {
      const nextMode = current === 'dark' ? 'light' : 'dark'
      const root = document.documentElement
      root.setAttribute('data-ix-theme', 'classic')
      root.setAttribute('data-ix-color-schema', nextMode)
      try {
        window.localStorage.setItem('trio-theme-mode', nextMode)
      } catch {
        // Ignore storage failures and keep the theme switch working.
      }
      return nextMode
    })
  }

  const jsonText = figmaJson ? JSON.stringify(figmaJson, null, 2) : ''
  const jsonTruncated = jsonText.length > JSON_PREVIEW_LIMIT
  const jsonPreviewText = jsonTruncated
    ? `${jsonText.slice(0, JSON_PREVIEW_LIMIT)}\n\n... truncated for display, download to view the full file ...`
    : jsonText

  const messageType = statusTone === 'error' ? 'alarm' : statusTone

  return (
    <IxApplication>
      <IxApplicationHeader slot="application-header" name="Figma to React Studio" nameSuffix="Siemens iX">
        <div className="header-actions">
          <button type="button" className="theme-toggle" aria-pressed={themeMode === 'dark'} onClick={toggleTheme}>
            {themeMode === 'dark' ? 'Switch to light' : 'Switch to dark'}
          </button>
          <IxPill variant={backendStatus === 'online' ? 'success' : backendStatus === 'offline' ? 'alarm' : 'neutral'}>
            Backend {backendStatus}
          </IxPill>
        </div>
      </IxApplicationHeader>
      <IxContent>
        <div className="studio-content">
          <div className="studio-grid">
            <div className="studio-column">
              <div className="brand-row">
                <div className="brand-mark" aria-hidden="true">
                  <span className="brand-leaf" />
                </div>
                <div>
                  <IxTypography format="h3">Extract, inspect, and generate</IxTypography>
                  <IxTypography format="body" textColor="soft">
                    Pull a Figma file into JSON, review it right here, then generate a Siemens iX React screen from it.
                  </IxTypography>
                </div>
              </div>

              <div className="status-row">
                <IxMessageBar type={messageType} persistent>
                  {status}
                </IxMessageBar>
                <IxButton type="button" variant="secondary" icon="reset" onClick={handleReset}>
                  Reset session
                </IxButton>
              </div>

              <IxCard>
                <IxCardTitle>Backend flow</IxCardTitle>
                <IxCardContent>
                  <ul>
                    <li>POST /api/extract-figma saves Figma JSON and returns it for preview</li>
                    <li>GET /api/figma-json re-loads a previously saved file</li>
                    <li>POST /api/generate-react returns Siemens iX powered App.jsx and styles.css</li>
                  </ul>
                </IxCardContent>
              </IxCard>

              {summary ? (
                <IxCard>
                  <IxCardTitle>Current summary</IxCardTitle>
                  <IxCardContent>
                    <dl className="summary-grid">
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
                  </IxCardContent>
                </IxCard>
              ) : null}

              {runInfo ? (
                <IxCard>
                  <IxCardTitle>Last generation</IxCardTitle>
                  <IxCardContent>
                    <div className="run-lines">
                      <span>Mode: {runInfo.mode}</span>
                      <span>Output: {runInfo.outputDir}</span>
                      <span>Files: {runInfo.writtenPaths.length}</span>
                    </div>
                  </IxCardContent>
                </IxCard>
              ) : null}
            </div>

            <div className="studio-column">
              <IxCard>
                <IxCardTitle>Figma extraction</IxCardTitle>
                <IxCardContent>
                  <form className="control-form" onSubmit={(event) => event.preventDefault()}>
                    <div className="field-group">
                      <IxInput
                        label="Figma file key"
                        value={form.fileKey}
                        onValueChange={updateField('fileKey')}
                        placeholder="e.g. AbCdEf123 or a full figma.com/file/... URL"
                      />
                      <IxInput
                        label="Figma token"
                        type="password"
                        value={form.token}
                        onValueChange={updateField('token')}
                        placeholder="Personal access token"
                      />
                      <IxInput
                        label="JSON output path"
                        value={form.outputPath}
                        onValueChange={updateField('outputPath')}
                        placeholder="figma_design.json"
                      />
                    </div>
                    <div className="button-row">
                      <IxButton type="button" icon="save-all" loading={busy} onClick={handleExtract}>
                        Save Figma JSON
                      </IxButton>
                      <IxButton
                        type="button"
                        variant="secondary"
                        icon="folder-open"
                        loading={jsonBusy}
                        onClick={handleLoadSavedJson}
                      >
                        Load saved JSON
                      </IxButton>
                    </div>
                  </form>
                </IxCardContent>
              </IxCard>

              <IxCard>
                <IxCardTitle>React generation</IxCardTitle>
                <IxCardContent>
                  <form className="control-form" onSubmit={(event) => event.preventDefault()}>
                    <div className="field-group">
                      <IxTextarea
                        label="Prompt"
                        textareaRows={4}
                        value={form.prompt}
                        onValueChange={updateField('prompt')}
                      />
                      <IxInput
                        label="LLM API key"
                        type="password"
                        value={form.apiKey}
                        onValueChange={updateField('apiKey')}
                        placeholder="Optional: remote generation"
                      />
                      <div className="split-grid">
                        <IxInput label="Base URL" value={form.baseUrl} onValueChange={updateField('baseUrl')} />
                        <IxInput label="Model" value={form.model} onValueChange={updateField('model')} />
                      </div>
                      <IxInput
                        label="Output directory"
                        value={form.outputDir}
                        onValueChange={updateField('outputDir')}
                        placeholder="generated_react"
                      />
                    </div>
                    <div className="button-row">
                      <IxButton type="button" icon="rocket" loading={busy} onClick={handleGenerate}>
                        Generate React Files
                      </IxButton>
                    </div>
                  </form>
                </IxCardContent>
              </IxCard>

              <IxCard>
                <IxCardContent>
                  <IxTabs activeTabKey={panelTab} onTabChange={handleTabChange}>
                    <IxTabItem tabKey="figma-json">Figma JSON</IxTabItem>
                    <IxTabItem tabKey="code">Code</IxTabItem>
                    <IxTabItem tabKey="visualize">Visualize</IxTabItem>
                  </IxTabs>

                  <div className="output-panel">
                    {panelTab === 'figma-json' &&
                      (figmaJson ? (
                        <>
                          <div className="json-toolbar">
                            <div className="json-meta">
                              <span>Path: {figmaMeta?.path ?? form.outputPath}</span>
                              <span>Size: {formatBytes(figmaMeta?.size)}</span>
                            </div>
                            <div className="output-actions">
                              <IxButton
                                type="button"
                                variant="secondary"
                                icon="copy"
                                onClick={() => handleCopy(jsonText, 'Figma JSON')}
                              >
                                Copy
                              </IxButton>
                              <IxButton
                                type="button"
                                variant="secondary"
                                icon="download"
                                onClick={() => handleDownload('figma_design.json', jsonText)}
                              >
                                Download
                              </IxButton>
                            </div>
                          </div>
                          <pre className="json-view">
                            <code>{jsonPreviewText}</code>
                          </pre>
                        </>
                      ) : (
                        <p className="empty-hint">
                          No Figma JSON loaded yet. Save a new extraction or load an existing{' '}
                          <code>figma_design.json</code> file.
                        </p>
                      ))}

                    {panelTab === 'code' &&
                      (fileNames.length > 0 ? (
                        <>
                          <div className="output-topbar">
                            <div className="file-tabs">
                              {fileNames.map((name) => (
                                <IxButton
                                  type="button"
                                  key={name}
                                  variant={name === activeFile ? 'primary' : 'tertiary'}
                                  onClick={() => setActiveFile(name)}
                                >
                                  {name}
                                </IxButton>
                              ))}
                            </div>
                            <div className="output-actions">
                              <IxButton
                                type="button"
                                variant="secondary"
                                icon="copy"
                                onClick={() => handleCopy(files[activeFile], activeFile)}
                              >
                                Copy
                              </IxButton>
                              <IxButton
                                type="button"
                                variant="secondary"
                                icon="download"
                                onClick={() => handleDownload(activeFile, files[activeFile])}
                              >
                                Download
                              </IxButton>
                            </div>
                          </div>
                          <pre className="code-view">
                            <code>{files[activeFile]}</code>
                          </pre>
                        </>
                      ) : (
                        <p className="empty-hint">No generated code yet. Run React generation to produce Siemens iX components.</p>
                      ))}

                    {panelTab === 'visualize' && (
                      <div className="preview-frame-shell">
                        {previewLoading ? (
                          <div className="preview-loading">
                            <IxSpinner />
                          </div>
                        ) : previewHtml ? (
                          <iframe title="Generated React preview" className="preview-frame" srcDoc={previewHtml} />
                        ) : (
                          <div className="preview-loading">No preview available yet. Generate code first.</div>
                        )}
                      </div>
                    )}
                  </div>
                </IxCardContent>
              </IxCard>
            </div>
          </div>
        </div>
      </IxContent>
    </IxApplication>
  )
}
