import express from 'express'
import fsSync from 'node:fs'
import fs from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)

const PORT = Number(process.env.PORT || 3000)
const FIGMA_API_URL = 'https://api.figma.com/v1/files/{fileKey}'
const DEFAULT_FIGMA_JSON_PATH = path.join(__dirname, 'figma_design.json')
const DEFAULT_OUTPUT_DIR = path.join(__dirname, 'generated_react')
const DIST_DIR = path.join(__dirname, 'dist')

const app = express()
app.use(express.json({ limit: '2mb' }))

function resolveWorkspacePath(inputPath, fallbackPath) {
  if (!inputPath) {
    return fallbackPath
  }

  return path.isAbsolute(inputPath) ? inputPath : path.join(__dirname, inputPath)
}

function countNodes(node) {
  if (!node || typeof node !== 'object') {
    return 0
  }

  const children = Array.isArray(node.children) ? node.children : []
  return 1 + children.reduce((total, child) => total + countNodes(child), 0)
}

function summarizeFigmaData(data) {
  const document = data?.document ?? {}
  const rootChildren = Array.isArray(document.children) ? document.children : []
  return {
    name: document.name,
    type: document.type,
    nodeCount: rootChildren.reduce((total, child) => total + countNodes(child), 0),
    children: rootChildren.slice(0, 10).map((child) => ({
      name: child?.name,
      type: child?.type,
      layoutMode: child?.layoutMode,
      characters: child?.characters,
      box: child?.absoluteBoundingBox
        ? {
            x: child.absoluteBoundingBox.x,
            y: child.absoluteBoundingBox.y,
            width: child.absoluteBoundingBox.width,
            height: child.absoluteBoundingBox.height,
          }
        : undefined,
      children: Array.isArray(child?.children)
        ? child.children.slice(0, 12).map((grandChild) => ({
            name: grandChild?.name,
            type: grandChild?.type,
            characters: grandChild?.characters,
          }))
        : [],
    })),
  }
}

function extractTextNodes(node) {
  if (!node || typeof node !== 'object') {
    return []
  }

  const collected = []
  if (typeof node.characters === 'string' && node.characters.trim()) {
    collected.push(node.characters.trim())
  }

  for (const child of node.children ?? []) {
    collected.push(...extractTextNodes(child))
  }

  return collected
}

function pickBrandName(summary) {
  const values = []
  for (const child of summary.children ?? []) {
    values.push(...extractTextNodes(child))
  }

  const preferred = values.filter((value) => !['sign in', 'welcome', 'password', 'email'].includes(value.toLowerCase()))
  if (preferred.length > 0) {
    return preferred[0]
  }

  return values[0] ?? summary.name ?? 'Haven'
}

function buildLocalBundle(summary, prompt) {
  const brandName = pickBrandName(summary)
  const textValues = []
  for (const child of summary.children ?? []) {
    textValues.push(...extractTextNodes(child))
  }

  const heading = textValues.find((value) => value.toLowerCase().includes('sign in')) ?? 'Sign in'
  const footerLinks = textValues.some((value) => value.toLowerCase().includes('privacy'))
    ? ['Privacy', 'Help']
    : ['Privacy', 'Need help?']
  const subtitle = prompt?.trim() || 'Use your account credentials to continue.'

  const app = `export default function App() {
  return (
    <div className="dashboard-shell">
      <main className="dashboard-grid">
        <section className="hero-panel">
          <div className="brand-lockup">
            <div className="brand-mark" aria-hidden="true">
              <span className="brand-leaf" />
            </div>
            <div>
              <p className="eyebrow">${brandName}</p>
              <h1>${heading}</h1>
            </div>
          </div>
          <p className="subtitle">${subtitle}</p>

          <div className="preview-card">
            <p className="preview-label">Generated from Figma summary</p>
            <ul>
              <li>Responsive card layout</li>
              <li>Accessible form controls</li>
              <li>Backend-driven generation flow</li>
            </ul>
          </div>
        </section>

        <section className="form-panel">
          <form className="login-form">
            <label>
              <span>Email</span>
              <input type="email" name="email" placeholder="you@example.com" autoComplete="email" />
            </label>

            <label>
              <span>Password</span>
              <input type="password" name="password" placeholder="Enter your password" autoComplete="current-password" />
            </label>

            <div className="form-row">
              <label className="checkbox-row">
                <input type="checkbox" name="remember" />
                <span>Remember me</span>
              </label>
              <a href="#recover">Forgot password?</a>
            </div>

            <button type="submit">Continue</button>
          </form>

          <footer className="page-footer">
            <span>© Haven</span>
            <nav aria-label="Support links">
              <a href="#privacy">${footerLinks[0]}</a>
              <a href="#help">${footerLinks[1]}</a>
            </nav>
          </footer>
        </section>
      </main>
    </div>
  )
}
`

  const styles = `:root {
  color-scheme: light;
  font-family: Inter, ui-sans-serif, system-ui, sans-serif;
  --bg: #f4f1e7;
  --surface: rgba(255, 255, 255, 0.82);
  --surface-strong: rgba(255, 255, 255, 0.96);
  --text: #1b201d;
  --muted: #5d665e;
  --accent: #34664f;
  --accent-strong: #254b3b;
  --border: rgba(27, 32, 29, 0.12);
  --shadow: 0 24px 80px rgba(17, 23, 20, 0.12);
}

* {
  box-sizing: border-box;
}

html,
body,
#root {
  min-height: 100%;
}

body {
  margin: 0;
  color: var(--text);
  background:
    radial-gradient(circle at top, rgba(52, 102, 79, 0.16), transparent 35%),
    linear-gradient(180deg, #faf9f4 0%, #efece2 100%);
}

a {
  color: inherit;
}

.dashboard-shell {
  min-height: 100vh;
  padding: 32px 20px;
}

.dashboard-grid {
  width: min(1120px, 100%);
  margin: 0 auto;
  display: grid;
  grid-template-columns: 1.05fr 0.95fr;
  gap: 24px;
  align-items: stretch;
}

.hero-panel,
.form-panel {
  padding: 32px;
  border-radius: 28px;
  background: var(--surface);
  border: 1px solid var(--border);
  box-shadow: var(--shadow);
  backdrop-filter: blur(18px);
}

.hero-panel {
  display: grid;
  align-content: space-between;
  gap: 24px;
}

.brand-lockup {
  display: flex;
  align-items: center;
  gap: 18px;
}

.brand-mark {
  width: 54px;
  height: 54px;
  border-radius: 18px;
  background: var(--accent);
  display: grid;
  place-items: center;
  flex: 0 0 auto;
}

.brand-leaf {
  width: 20px;
  height: 20px;
  border-radius: 999px 999px 999px 0;
  border: 2px solid rgba(255, 255, 255, 0.96);
  border-left-color: transparent;
  border-bottom-color: transparent;
  transform: rotate(45deg);
}

.eyebrow {
  margin: 0 0 6px;
  font-size: 0.78rem;
  letter-spacing: 0.18em;
  text-transform: uppercase;
  color: var(--muted);
}

h1 {
  margin: 0;
  font-size: clamp(2.2rem, 4vw, 3.4rem);
  line-height: 1;
}

.subtitle {
  margin: 18px 0 0;
  max-width: 54ch;
  color: var(--muted);
  font-size: 1rem;
  line-height: 1.6;
}

.preview-card {
  padding: 20px;
  border-radius: 22px;
  background: var(--surface-strong);
  border: 1px solid var(--border);
}

.preview-label {
  margin: 0 0 12px;
  font-size: 0.82rem;
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--muted);
}

.preview-card ul {
  margin: 0;
  padding-left: 18px;
  color: var(--text);
  display: grid;
  gap: 10px;
}

.login-form {
  display: grid;
  gap: 16px;
}

.login-form label {
  display: grid;
  gap: 8px;
  font-size: 0.95rem;
  font-weight: 600;
}

.login-form span {
  color: var(--text);
}

.login-form input {
  width: 100%;
  border: 1px solid var(--border);
  border-radius: 16px;
  background: rgba(255, 255, 255, 0.94);
  color: var(--text);
  padding: 14px 16px;
  font: inherit;
  transition: border-color 160ms ease, box-shadow 160ms ease, transform 160ms ease;
}

.login-form input:focus {
  outline: none;
  border-color: rgba(52, 102, 79, 0.55);
  box-shadow: 0 0 0 4px rgba(52, 102, 79, 0.12);
}

.form-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  font-size: 0.92rem;
}

.checkbox-row {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 500;
}

.checkbox-row input {
  width: 16px;
  height: 16px;
  margin: 0;
  accent-color: var(--accent);
}

.form-row a,
.page-footer a {
  color: var(--accent-strong);
  text-decoration: none;
}

.login-form button {
  margin-top: 4px;
  border: 0;
  border-radius: 16px;
  padding: 14px 18px;
  background: var(--accent);
  color: white;
  font: inherit;
  font-weight: 700;
  cursor: pointer;
  box-shadow: 0 16px 28px rgba(52, 102, 79, 0.24);
  transition: transform 160ms ease, box-shadow 160ms ease;
}

.login-form button:hover {
  transform: translateY(-1px);
  box-shadow: 0 18px 34px rgba(52, 102, 79, 0.28);
}

.page-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  margin-top: 24px;
  padding-top: 18px;
  border-top: 1px solid var(--border);
  color: var(--muted);
  font-size: 0.85rem;
}

.page-footer nav {
  display: inline-flex;
  gap: 18px;
}

@media (max-width: 900px) {
  .dashboard-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 560px) {
  .dashboard-shell {
    padding: 16px;
  }

  .hero-panel,
  .form-panel {
    padding: 22px;
    border-radius: 22px;
  }

  .brand-lockup {
    align-items: flex-start;
  }

  .form-row,
  .page-footer {
    flex-direction: column;
    align-items: flex-start;
  }
}
`

  return {
    'App.jsx': `${app}\n`,
    'styles.css': `${styles}\n`,
  }
}

function escapeScriptContent(value) {
  return String(value ?? '').replace(/<\/script>/gi, '<\\/script>')
}

function normalizeAppCodeForPreview(value) {
  return String(value ?? '')
    .replace(/^\s*import\s+[^\n]*from\s+['"][^'"]+['"];?\s*$/gm, '')
    .replace(/^\s*export\s+default\s+/gm, '')
    .trim()
}

function buildPreviewDocument(appCode, stylesCode) {
  const safeAppCode = escapeScriptContent(normalizeAppCodeForPreview(appCode))
  const safeStylesCode = String(stylesCode ?? '')
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated Preview</title>
    <style>${safeStylesCode}</style>
    <script crossorigin src="https://unpkg.com/react@18/umd/react.development.js"></script>
    <script crossorigin src="https://unpkg.com/react-dom@18/umd/react-dom.development.js"></script>
    <script crossorigin src="https://unpkg.com/@babel/standalone/babel.min.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script type="text/babel" data-presets="react">
      const { useEffect, useMemo, useState } = React;
      ${safeAppCode}
      const root = ReactDOM.createRoot(document.getElementById('root'));
      root.render(<App />);
    </script>
  </body>
</html>`
}

function extractCodeFiles(text) {
  const filePattern = /(?:^|\n)File:\s*(?<name>[\w.\-/]+)\s*\n```(?:[\w-]+)?\n(?<code>.*?)```/gs
  const parts = {}
  for (const match of text.matchAll(filePattern)) {
    parts[match.groups.name.trim()] = match.groups.code.trim()
  }

  if (Object.keys(parts).length > 0) {
    return parts
  }

  const fencedBlocks = [...text.matchAll(/```(?:[\w-]+)?\n(.*?)```/gs)].map((match) => match[1].trim())
  if (fencedBlocks.length === 1) {
    return { 'App.jsx': fencedBlocks[0] }
  }

  const defaultNames = ['App.jsx', 'styles.css', 'main.jsx', 'index.css']
  fencedBlocks.forEach((block, index) => {
    const fileName = defaultNames[index] ?? `file-${index + 1}.txt`
    parts[fileName] = block
  })

  return Object.keys(parts).length > 0 ? parts : { 'App.jsx': text.trim() }
}

async function ensureDirectory(dirPath) {
  await fs.mkdir(dirPath, { recursive: true })
}

async function writeFiles(outputDir, files) {
  await ensureDirectory(outputDir)
  const written = []

  for (const [name, content] of Object.entries(files)) {
    const filePath = path.join(outputDir, name)
    await fs.writeFile(filePath, `${String(content).trimEnd()}\n`, 'utf8')
    written.push(filePath)
  }

  return written
}

async function fetchFigmaFile(fileKey, token) {
  const response = await fetch(FIGMA_API_URL.replace('{fileKey}', encodeURIComponent(fileKey)), {
    headers: {
      'X-Figma-Token': token,
    },
  })

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`)
  }

  return response.json()
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.post('/api/extract-figma', async (request, response) => {
  const fileKey = String(request.body.fileKey ?? '').trim()
  const token = String(request.body.token ?? '').trim()
  const outputPath = resolveWorkspacePath(request.body.outputPath, DEFAULT_FIGMA_JSON_PATH)

  if (!fileKey || !token) {
    return response.status(400).json({ error: 'fileKey and token are required.' })
  }

  try {
    const figmaData = await fetchFigmaFile(fileKey, token)
    await fs.writeFile(outputPath, `${JSON.stringify(figmaData, null, 2)}\n`, 'utf8')
    return response.json({
      ok: true,
      outputPath,
      summary: summarizeFigmaData(figmaData),
    })
  } catch (error) {
    return response.status(500).json({ error: error.message })
  }
})

app.post('/api/generate-react', async (request, response) => {
  const figmaJsonPath = resolveWorkspacePath(request.body.figmaJsonPath, DEFAULT_FIGMA_JSON_PATH)
  const outputDir = resolveWorkspacePath(request.body.outputDir, DEFAULT_OUTPUT_DIR)
  const prompt = String(request.body.prompt ?? '').trim()
  const apiKey = String(request.body.apiKey ?? '').trim()
  const baseUrl = String(request.body.baseUrl ?? 'https://api.x.ai/v1').trim().replace(/\/$/, '')
  const model = String(request.body.model ?? 'grok-3-mini').trim()

  try {
    const figmaData = JSON.parse(await fs.readFile(figmaJsonPath, 'utf8'))
    const summary = summarizeFigmaData(figmaData)

    let mode = 'local'
    let files = buildLocalBundle(summary, prompt)

    if (apiKey) {
      try {
        const remoteResponse = await fetch(`${baseUrl}/chat/completions`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${apiKey}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            model,
            temperature: 0.2,
            messages: [
              {
                role: 'system',
                content:
                  'You are a senior front-end engineer. Return only file-marked React code blocks for App.jsx and styles.css.',
              },
              {
                role: 'user',
                content: `${prompt || 'Generate a React login screen.'}\n\nFigma summary:\n${JSON.stringify(summary, null, 2)}`,
              },
            ],
          }),
        })

        if (remoteResponse.ok) {
          const payload = await remoteResponse.json()
          const content = payload?.choices?.[0]?.message?.content ?? ''
          const extracted = extractCodeFiles(content)
          if (Object.keys(extracted).length > 0) {
            files = extracted
            mode = 'remote'
          }
        }
      } catch {
        mode = 'local'
      }
    }

    const writtenPaths = await writeFiles(outputDir, files)
    return response.json({
      ok: true,
      mode,
      outputDir,
      files,
      writtenPaths,
      summary,
    })
  } catch (error) {
    return response.status(500).json({ error: error.message })
  }
})

app.post('/api/preview-react', async (request, response) => {
  const appCode = String(request.body.appCode ?? '')
  const stylesCode = String(request.body.stylesCode ?? '')

  if (!appCode.trim()) {
    return response.status(400).json({ error: 'appCode is required.' })
  }

  const html = buildPreviewDocument(appCode, stylesCode)
  return response.json({
    ok: true,
    html,
  })
})

if (fsSync.existsSync(DIST_DIR)) {
  app.use(express.static(DIST_DIR))
  app.get('*', (_request, response) => {
    response.sendFile(path.join(DIST_DIR, 'index.html'))
  })
}

app.listen(PORT, () => {
  console.log(`Server listening on http://localhost:${PORT}`)
})