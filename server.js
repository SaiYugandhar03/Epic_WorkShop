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

const MAX_SUMMARY_DEPTH = 14
const MAX_CHILDREN_PER_NODE = 14
const MAX_SUMMARY_NODES = 400

function colorChannelToHex(value) {
  const clamped = Math.max(0, Math.min(1, Number(value) || 0))
  return Math.round(clamped * 255).toString(16).padStart(2, '0')
}

function fillToHex(fills) {
  if (!Array.isArray(fills)) {
    return undefined
  }

  const solid = fills.find((fill) => fill?.type === 'SOLID' && fill.visible !== false && fill.color)
  if (!solid) {
    return undefined
  }

  const { r, g, b } = solid.color
  return `#${colorChannelToHex(r)}${colorChannelToHex(g)}${colorChannelToHex(b)}`
}

function summarizeNode(node, depth, counter) {
  if (!node || typeof node !== 'object' || counter.count >= MAX_SUMMARY_NODES) {
    return null
  }

  counter.count += 1

  const layout = {}
  if (node.layoutMode) layout.mode = node.layoutMode
  if (node.primaryAxisAlignItems) layout.primaryAxisAlignItems = node.primaryAxisAlignItems
  if (node.counterAxisAlignItems) layout.counterAxisAlignItems = node.counterAxisAlignItems
  if (node.itemSpacing !== undefined) layout.itemSpacing = node.itemSpacing
  if (node.cornerRadius !== undefined) layout.cornerRadius = node.cornerRadius

  const style = {}
  if (node.style?.fontFamily) style.fontFamily = node.style.fontFamily
  if (node.style?.fontWeight) style.fontWeight = node.style.fontWeight
  if (node.style?.fontSize) style.fontSize = node.style.fontSize
  if (node.style?.textAlignHorizontal) style.textAlign = node.style.textAlignHorizontal

  const summary = {
    name: node.name,
    type: node.type,
  }

  if (typeof node.characters === 'string' && node.characters.trim()) {
    summary.characters = node.characters.trim()
  }
  if (Object.keys(layout).length > 0) summary.layout = layout
  if (Object.keys(style).length > 0) summary.style = style

  const color = fillToHex(node.fills)
  if (color) summary.color = color

  if (node.absoluteBoundingBox) {
    const box = node.absoluteBoundingBox
    summary.box = { x: box.x, y: box.y, width: box.width, height: box.height }
  }

  const children = Array.isArray(node.children) ? node.children : []
  if (children.length > 0 && depth < MAX_SUMMARY_DEPTH) {
    const mapped = []
    for (const child of children.slice(0, MAX_CHILDREN_PER_NODE)) {
      if (counter.count >= MAX_SUMMARY_NODES) break
      const childSummary = summarizeNode(child, depth + 1, counter)
      if (childSummary) mapped.push(childSummary)
    }
    if (mapped.length > 0) summary.children = mapped
  }

  return summary
}

function summarizeFigmaData(data) {
  const document = data?.document ?? {}
  const rootChildren = Array.isArray(document.children) ? document.children : []
  const counter = { count: 0 }

  return {
    name: document.name,
    type: document.type,
    nodeCount: rootChildren.reduce((total, child) => total + countNodes(child), 0),
    children: rootChildren
      .slice(0, 10)
      .map((child) => summarizeNode(child, 0, counter))
      .filter(Boolean),
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

const CTA_WORDS = new Set([
  'sign in', 'log in', 'login', 'submit', 'continue', 'get started',
  'sign up', 'register', 'send', 'next', 'confirm', 'save', 'search', 'subscribe',
])
const INPUT_NAME_PATTERN = /input|field|email|password|username|search/i
const PASSWORD_PATTERN = /password/i
const EMAIL_PATTERN = /email|username/i

function escapeJsxText(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\{/g, '&#123;')
    .replace(/\}/g, '&#125;')
    .replace(/"/g, '&quot;')
}

function slugify(value) {
  const slug = String(value ?? 'field')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '')
  return slug || 'field'
}

function humanizeName(value) {
  return String(value ?? 'Field')
    .replace(/[_-]+/g, ' ')
    .trim()
    .replace(/\b\w/g, (letter) => letter.toUpperCase())
}

function inputType(name, label) {
  const probe = `${name ?? ''} ${label ?? ''}`
  if (PASSWORD_PATTERN.test(probe)) return 'password'
  if (EMAIL_PATTERN.test(probe)) return 'email'
  return 'text'
}

function collectFrames(summary) {
  const frames = []
  for (const page of summary.children ?? []) {
    if (Array.isArray(page.children) && page.children.length > 0) {
      frames.push(...page.children)
    } else {
      frames.push(page)
    }
  }
  return frames.length > 0 ? frames : summary.children ?? []
}

function findInputMatches(node, matches) {
  if (!node || typeof node !== 'object') {
    return false
  }

  let childMatched = false
  for (const child of node.children ?? []) {
    if (findInputMatches(child, matches)) {
      childMatched = true
    }
  }

  if (!childMatched && !node.characters && typeof node.name === 'string' && INPUT_NAME_PATTERN.test(node.name)) {
    matches.add(node)
    return true
  }

  return childMatched
}

function collectEntries(node, entries, inputMatches) {
  if (!node || typeof node !== 'object') {
    return
  }

  if (inputMatches.has(node)) {
    entries.push({ kind: 'input', name: node.name })
    return
  }

  if (typeof node.characters === 'string' && node.characters.trim()) {
    entries.push({ kind: 'text', text: node.characters.trim(), name: node.name })
  }

  for (const child of node.children ?? []) {
    collectEntries(child, entries, inputMatches)
  }
}

function classifyEntries(entries) {
  const buttons = []
  const inputs = []
  const texts = []
  const seenButtons = new Set()

  entries.forEach((entry) => {
    if (entry.kind === 'input') {
      const label = texts.length > 0 ? texts.pop().text : humanizeName(entry.name)
      inputs.push({ name: entry.name, label })
      return
    }

    const normalized = entry.text.toLowerCase()
    const isButton = CTA_WORDS.has(normalized) || (entry.name && /button|cta/i.test(entry.name))
    if (isButton && !seenButtons.has(normalized)) {
      seenButtons.add(normalized)
      buttons.push(entry.text)
    } else if (!isButton) {
      texts.push(entry)
    }
  })

  return { buttons, inputs, texts }
}

function renderSection(frame, index) {
  const inputMatches = new Set()
  findInputMatches(frame, inputMatches)
  const entries = []
  collectEntries(frame, entries, inputMatches)
  const { buttons, inputs, texts } = classifyEntries(entries)

  if (texts.length === 0 && inputs.length === 0 && buttons.length === 0) {
    return null
  }

  const heading = escapeJsxText(texts[0]?.text ?? frame.name ?? `Section ${index + 1}`)
  const lines = [
    '          <IxCard className="generated-block">',
    `            <IxCardTitle>${heading}</IxCardTitle>`,
    '            <IxCardContent>',
  ]

  texts.slice(1).forEach((entry) => {
    lines.push(`              <IxTypography format="body" textColor="soft">${escapeJsxText(entry.text)}</IxTypography>`)
  })

  if (inputs.length > 0 || buttons.length > 0) {
    lines.push('              <form className="generated-form">')
    inputs.forEach((entry) => {
      const type = inputType(entry.name, entry.label)
      const label = escapeJsxText(entry.label)
      lines.push(
        `                <IxInput type="${type}" name="${slugify(entry.label)}" label="${label}" placeholder="${label}"></IxInput>`,
      )
    })
    buttons.forEach((text) => {
      lines.push(`                <IxButton type="button">${escapeJsxText(text)}</IxButton>`)
    })
    lines.push('              </form>')
  }

  lines.push('            </IxCardContent>')
  lines.push('          </IxCard>')
  return lines.join('\n')
}

function collectColors(node, bag) {
  if (!node || typeof node !== 'object') {
    return
  }

  if (node.color) bag.push(node.color)
  for (const child of node.children ?? []) {
    collectColors(child, bag)
  }
}

function isNeutralHex(hex) {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  return Math.max(r, g, b) - Math.min(r, g, b) < 18
}

function pickAccentColor(frames) {
  const bag = []
  frames.forEach((frame) => collectColors(frame, bag))
  return bag.find((hex) => !isNeutralHex(hex)) ?? '#34664f'
}

function darken(hex, amount = 0.18) {
  const value = hex.replace('#', '')
  const r = parseInt(value.slice(0, 2), 16)
  const g = parseInt(value.slice(2, 4), 16)
  const b = parseInt(value.slice(4, 6), 16)
  const factor = 1 - amount
  const toHex = (channel) => Math.max(0, Math.round(channel * factor)).toString(16).padStart(2, '0')
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`
}

function buildLocalBundle(summary, prompt) {
  const frames = collectFrames(summary)
  const brandName = pickBrandName(summary)
  const pageTitle = frames[0]?.name || summary.name || 'Generated screen'
  const subtitle = prompt?.trim() || 'Generated automatically from your Figma design.'
  const accent = pickAccentColor(frames)
  const accentStrong = darken(accent)

  const sections = frames.map((frame, index) => renderSection(frame, index)).filter(Boolean)
  const bodySections = sections.length > 0
    ? sections.join('\n')
    : `          <IxCard className="generated-block">
            <IxCardTitle>${escapeJsxText(pageTitle)}</IxCardTitle>
            <IxCardContent>
              <IxTypography format="body" textColor="soft">
                No text or input layers were found in this Figma file yet. Add layers with real content to see them reflected here.
              </IxTypography>
            </IxCardContent>
          </IxCard>`

  const app = `import {
  IxApplication,
  IxApplicationHeader,
  IxContent,
  IxCard,
  IxCardTitle,
  IxCardContent,
  IxInput,
  IxButton,
  IxTypography,
} from '@siemens/ix-react'

export default function App() {
  return (
    <IxApplication style={{ '--theme-color-primary': '${accent}' }}>
      <IxApplicationHeader slot="application-header" name="${escapeJsxText(brandName)}"></IxApplicationHeader>
      <IxContent>
        <div className="generated-grid">
          <header className="generated-header">
            <IxTypography format="h1">${escapeJsxText(pageTitle)}</IxTypography>
            <IxTypography format="body" textColor="soft">${escapeJsxText(subtitle)}</IxTypography>
          </header>
${bodySections}
        </div>
      </IxContent>
    </IxApplication>
  )
}
`

  const styles = `/*
 * This file only contains layout rules. Buttons, inputs, cards, and
 * typography are styled by the Siemens iX design system itself. The app
 * that renders this file must import the iX stylesheets once, e.g. in
 * main.jsx:
 *
 *   import '@siemens/ix/dist/siemens-ix/siemens-ix.css'
 *   import '@siemens/ix/dist/siemens-ix/theme/classic-light.css'
 *
 * and have these packages installed:
 *
 *   npm install @siemens/ix @siemens/ix-react @siemens/ix-icons
 */

.generated-grid {
  width: min(960px, 100%);
  margin: 0 auto;
  display: grid;
  gap: 20px;
  padding: 32px 20px;
}

.generated-header {
  display: grid;
  gap: 8px;
  margin-bottom: 8px;
}

.generated-form {
  display: grid;
  gap: 16px;
  margin-top: 16px;
  max-width: 420px;
}

@media (max-width: 560px) {
  .generated-grid {
    padding: 20px 16px;
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
  return String(value ?? '').trim()
}

function buildPreviewDocument(appCode, stylesCode) {
  const transformedAppCode = normalizeAppCodeForPreview(appCode)
  const appCodeJson = escapeScriptContent(JSON.stringify(transformedAppCode))
  const safeStylesCode = String(stylesCode ?? '')
  return `<!doctype html>
<html lang="en" data-ix-theme="classic" data-ix-color-schema="light">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Generated Preview</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@siemens/ix/dist/siemens-ix/siemens-ix.css" />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@siemens/ix/dist/siemens-ix/theme/classic-light.css" />
    <style>
      ${safeStylesCode}
      .preview-error {
        margin: 24px;
        padding: 16px 20px;
        border-radius: 12px;
        background: #fdecea;
        border: 1px solid #f3b4ad;
        color: #7c2d22;
        font-family: ui-monospace, Menlo, Consolas, monospace;
        white-space: pre-wrap;
        font-size: 0.85rem;
      }
    </style>
    <script type="importmap">
      {
        "imports": {
          "react": "https://esm.sh/react@18.3.1",
          "react-dom": "https://esm.sh/react-dom@18.3.1?external=react",
          "react-dom/client": "https://esm.sh/react-dom@18.3.1/client?external=react",
          "react/jsx-runtime": "https://esm.sh/react@18.3.1/jsx-runtime",
          "@siemens/ix-react": "https://esm.sh/@siemens/ix-react@5.3.0?external=react,react-dom",
          "@siemens/ix-icons": "https://esm.sh/@siemens/ix-icons@3.7.0"
        }
      }
    </script>
    <script crossorigin src="https://cdn.jsdelivr.net/npm/@babel/standalone@7/babel.min.js"></script>
  </head>
  <body>
    <div id="root"></div>
    <script>
      window.addEventListener('error', (event) => {
        const root = document.getElementById('root');
        if (root && !root.hasChildNodes()) {
          root.innerHTML = '<div class="preview-error">' + (event?.error?.message || event.message || 'Unknown preview error') + '</div>';
        }
      });

      (async () => {
        try {
          const rawCode = ${appCodeJson};
          const transformed = Babel.transform(rawCode, {
            presets: [['react', { runtime: 'automatic' }]],
            filename: 'App.jsx',
          }).code;
          const blob = new Blob([transformed], { type: 'text/javascript' });
          const moduleUrl = URL.createObjectURL(blob);
          const [{ default: App }, { createElement }, { createRoot }] = await Promise.all([
            import(moduleUrl),
            import('react'),
            import('react-dom/client'),
          ]);
          URL.revokeObjectURL(moduleUrl);
          const root = createRoot(document.getElementById('root'));
          root.render(createElement(App));
        } catch (error) {
          const container = document.getElementById('root');
          container.innerHTML = '<div class="preview-error">' + (error && error.message ? error.message : String(error)) + '</div>';
        }
      })();
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

function parseFigmaFileKey(input) {
  const value = String(input ?? '').trim()
  if (!value) {
    return ''
  }

  const urlMatch = value.match(/figma\.com\/(?:file|design|proto)\/([a-zA-Z0-9]+)/)
  return urlMatch ? urlMatch[1] : value
}

app.get('/api/health', (_request, response) => {
  response.json({ ok: true })
})

app.post('/api/extract-figma', async (request, response) => {
  const fileKey = parseFigmaFileKey(request.body.fileKey)
  const token = String(request.body.token ?? '').trim()
  const outputPath = resolveWorkspacePath(request.body.outputPath, DEFAULT_FIGMA_JSON_PATH)

  if (!fileKey || !token) {
    return response.status(400).json({ error: 'fileKey and token are required.' })
  }

  try {
    const figmaData = await fetchFigmaFile(fileKey, token)
    const serialized = `${JSON.stringify(figmaData, null, 2)}\n`
    await fs.writeFile(outputPath, serialized, 'utf8')
    return response.json({
      ok: true,
      outputPath,
      size: Buffer.byteLength(serialized, 'utf8'),
      raw: figmaData,
      summary: summarizeFigmaData(figmaData),
    })
  } catch (error) {
    return response.status(500).json({ error: error.message })
  }
})

app.get('/api/figma-json', async (request, response) => {
  const jsonPath = resolveWorkspacePath(request.query.path, DEFAULT_FIGMA_JSON_PATH)

  try {
    const [raw, stats] = await Promise.all([fs.readFile(jsonPath, 'utf8'), fs.stat(jsonPath)])
    const figmaData = JSON.parse(raw)
    return response.json({
      ok: true,
      path: jsonPath,
      size: stats.size,
      modifiedAt: stats.mtime,
      raw: figmaData,
      summary: summarizeFigmaData(figmaData),
    })
  } catch (error) {
    if (error.code === 'ENOENT') {
      return response.status(404).json({ error: `No Figma JSON file found at ${jsonPath}.` })
    }
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
    let remoteError

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
                  'You are a senior front-end engineer. Build the UI using the Siemens iX design system via the "@siemens/ix-react" package (components like IxApplication, IxApplicationHeader, IxContent, IxCard, IxCardTitle, IxCardContent, IxButton, IxInput, IxTextarea, IxTypography) instead of plain HTML elements wherever a matching component exists. Return only file-marked React code blocks for App.jsx and styles.css.',
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
          } else {
            remoteError = 'Remote response did not contain recognizable code blocks.'
          }
        } else {
          remoteError = `Remote API responded with ${remoteResponse.status} ${remoteResponse.statusText}.`
        }
      } catch (error) {
        remoteError = error.message
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
      remoteError,
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