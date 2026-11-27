// Builds the side-by-side review page for the owner (mockup next to the real app).
//
//   node scripts/review-page.ts design/review-notes/m1-round1.json design/alkony/screenshots/m1 <real-shots-dir>
//
// Both image folders hold files named <screen>-<dark|light>-<390|1280>.png. The real shots come from a run
// against the Docker image (Hungarian, same state as the mockup). The notes file lists each screen with its
// verdict and the differences found. Output goes to design/review/<notes name>.html (git-ignored).
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

interface Screen {
  key: string
  title: string
  verdict: string
  differences: string[]
}

const [notesFile, mockDir, realDir] = process.argv.slice(2)
if (!notesFile || !mockDir || !realDir) {
  console.error('usage: node scripts/review-page.ts <notes.json> <mockup-dir> <real-shots-dir>')
  process.exit(1)
}

const name = path.basename(notesFile, '.json')
const root = path.join(import.meta.dirname, '..', 'design', 'review')
const imageDir = path.join(root, name)
mkdirSync(imageDir, { recursive: true })
const screens = JSON.parse(readFileSync(notesFile, 'utf8')) as Screen[]

const escape = (text: string) =>
  text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
const verdictClass = (verdict: string) =>
  verdict.startsWith('matches') ? 'ok' : verdict.includes('clearly') ? 'bad' : 'warn'
const badge = (verdict: string) =>
  `<span class="v ${verdictClass(verdict)}">${escape(verdict)}</span>`

function pair(key: string, theme: 'dark' | 'light', width: 390 | 1280) {
  const size = width === 390 ? 'Phone 390' : 'Desktop 1280'
  const label = `${size}, ${theme === 'dark' ? 'Dark' : 'Light'}`
  const file = `${key}-${theme}-${String(width)}`
  copyFileSync(path.join(mockDir ?? '', `${file}.png`), path.join(imageDir, `${file}-mock.png`))
  copyFileSync(path.join(realDir ?? '', `${file}.png`), path.join(imageDir, `${file}-real.png`))
  const figure = (kind: 'mock' | 'real', caption: string) =>
    `<figure><figcaption>${caption}, ${label}</figcaption><img loading="lazy" src="${name}/${file}-${kind}.png" alt="${caption} ${escape(key)} ${label}"></figure>`
  return `<div class="pair">${figure('mock', 'Mockup')}${figure('real', 'Real app')}</div>`
}

const rows = screens
  .map(
    ({ key, title, verdict }) =>
      `<tr><td><a href="#${key}">${escape(title)}</a></td><td>${badge(verdict)}</td></tr>`,
  )
  .join('')

const sections = screens
  .map(({ key, title, verdict, differences }) => {
    const items = (differences.length ? differences : ['No real differences seen.'])
      .map((text) => `<li>${escape(text)}</li>`)
      .join('')
    return `<section id="${key}">
<h2>${escape(title)} ${badge(verdict)}</h2>
<ul class="diff">${items}</ul>
<div class="grid">${pair(key, 'dark', 390)}${pair(key, 'light', 390)}</div>
<div class="grid wide">${pair(key, 'dark', 1280)}${pair(key, 'light', 1280)}</div>
</section>`
  })
  .join('\n')

const css = `:root{--bg:#fff;--text:#1d1b33;--muted:#5b5875;--line:#d8d4e6;--card:#f5f2fb;--ok:#14683a;--warn:#8a5200;--bad:#a3201a;--okbg:#dff3e6;--warnbg:#fdeccb;--badbg:#fbdcd9}
@media (prefers-color-scheme:dark){:root{--bg:#12101f;--text:#ece9f8;--muted:#a9a4c6;--line:#3a3568;--card:#1c1940;--ok:#7fe0a5;--warn:#f6c26b;--bad:#ff9d96;--okbg:#17372a;--warnbg:#3b2d12;--badbg:#44201e}}
*{box-sizing:border-box}
body{margin:0;background:var(--bg);color:var(--text);font:16px/1.5 system-ui,sans-serif;padding:24px 16px 64px}
main{max-width:1400px;margin:0 auto}
h1{font-size:26px;margin:0 0 8px}
h2{font-size:20px;margin:0 0 8px}
p{color:var(--muted);max-width:80ch}
table{border-collapse:collapse;margin:16px 0 32px;min-width:min(100%,520px)}
td,th{border-bottom:1px solid var(--line);padding:8px 12px;text-align:left}
a{color:inherit}
.v{display:inline-block;font-size:14px;font-weight:600;padding:2px 10px;border-radius:99px}
.v.ok{color:var(--ok);background:var(--okbg)}.v.warn{color:var(--warn);background:var(--warnbg)}.v.bad{color:var(--bad);background:var(--badbg)}
section{border-top:1px solid var(--line);padding:24px 0}
ul.diff{margin:0 0 16px;padding-left:20px;max-width:100ch}
.grid{display:grid;gap:16px;grid-template-columns:repeat(auto-fit,minmax(min(100%,380px),1fr));margin-bottom:16px}
.grid.wide{grid-template-columns:repeat(auto-fit,minmax(min(100%,640px),1fr))}
.pair{display:grid;gap:8px;grid-template-columns:1fr 1fr;background:var(--card);padding:8px;border-radius:12px}
figure{margin:0;min-width:0}
figcaption{font-size:12px;color:var(--muted);margin-bottom:4px}
img{width:100%;height:auto;display:block;border-radius:6px;border:1px solid var(--line)}
@media (max-width:700px){.pair{grid-template-columns:1fr}}`

const page = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Nightjar ${escape(name)} review</title>
<style>${css}</style>
</head>
<body>
<main>
<h1>${escape(name)}: mockup next to the real app</h1>
<p>Left of each pair is the mockup, right is the real app from the Docker image, in Hungarian, with the same text and state where possible. The mockup phone images draw a fake status bar and rounded corners; those are not part of the app, so content starts a bit lower there. Verdicts are a reading of the screenshots.</p>
<table>
<thead><tr><th>Screen</th><th>Verdict</th></tr></thead>
<tbody>${rows}</tbody>
</table>
${sections}
</main>
</body>
</html>
`

writeFileSync(path.join(root, `${name}.html`), page)
console.log(`wrote ${path.join(root, `${name}.html`)}`)
