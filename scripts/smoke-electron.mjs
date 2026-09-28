/**
 * Electron 冒烟测试（纯黑盒）：以生产形态（app:// 协议 + dist 产物）启动应用壳，
 * 走完整用户路径：打开 PDF → 进入编辑模式 → 鼠标命中文字 → 内联改字 → 草稿落盘 →
 * 导出 → 重开同文件草稿恢复。断言全部基于 DOM/UI 与 canvas 像素，不依赖 Vue 内部
 * 属性（生产 build 下 __vueParentComponent 不存在）。失败即非零退出。
 *
 * 用法：node scripts/smoke-electron.mjs
 */
import { _electron as electron } from 'playwright-core'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import { PDFDocument } from 'pdf-lib'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const ELECTRON = path.join(root, 'node_modules', 'electron', 'dist', 'electron.exe')
const SAMPLE = path.join(root, 'public', 'sample.pdf')
// SMOKE_EXE 指向打包产物（安装版/便携版 exe）时，即对最终交付形态做全量冒烟
const EXEC = process.env.SMOKE_EXE || ELECTRON

const fails = []
function check(name, cond, detail = '') {
  const ok = Boolean(cond)
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`)
  if (!ok) fails.push(name)
}

// 干净起点：清掉上次运行的 userData（残留草稿会让恢复断言失真）。
// 打包产物以 productName 命名 userData，一并清理。
fs.rmSync(path.join(process.env.APPDATA || '', 'pdf-editor'), { recursive: true, force: true })
fs.rmSync(path.join(process.env.APPDATA || '', 'PDF文字编辑器'), { recursive: true, force: true })

const app = await electron.launch({
  executablePath: EXEC,
  args: EXEC === ELECTRON ? ['.'] : [],
  cwd: root,
  timeout: 30000,
})
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('PAGE-ERROR:', e.message))
page.on('console', (m) => {
  if (m.type() === 'error') console.log('CONSOLE-ERROR:', m.text())
})

/** 读取页面 IndexedDB 草稿库快照 */
const dumpIdb = () =>
  page.evaluate(async () => {
    const db = await new Promise((res, rej) => {
      const r = indexedDB.open('pdf-editor-drafts', 1)
      r.onsuccess = () => res(r.result)
      r.onerror = () => rej(r.error)
    })
    return await new Promise((res) => {
      const tx = db.transaction('drafts', 'readonly')
      const req = tx.objectStore('drafts').getAll()
      req.onsuccess = () =>
        res(
          req.result.map((d) => ({
            fp: d.fingerprint,
            fileName: d.fileName,
            recs: Array.isArray(d.records) ? d.records.length : String(d.records),
            bytes: d.bytes ? `${d.bytes.byteLength}B` : String(d.bytes),
          })),
        )
    })
  })

// 1) 窗口加载
await page.waitForLoadState('domcontentloaded')
check('窗口 URL 为 app:// 协议', (page.url() || '').startsWith('app://'), page.url())
check('页面标题', (await page.title()).includes('PDF'), await page.title())
check('IndexedDB 可用', await page.evaluate(() => typeof window.indexedDB?.open === 'function'))

// 2) 打开 PDF（真实 file input）
await page.setInputFiles('input[type=file]', SAMPLE)
await page.waitForSelector('.page-wrap[data-page="3"]', { timeout: 30000 })
check('渲染出 3 页', (await page.locator('.page-wrap').count()) === 3)

// 3) 进入编辑模式，网格移动鼠标直到 hover 高亮出现（= 文本层命中就绪）
await page.getByRole('button', { name: /改文字/ }).click()
const layerBox = await page.locator('.page-wrap[data-page="1"] .text-edit-layer').boundingBox()
let hover = null
outer: for (let yp = 0.2; yp <= 0.36; yp += 0.02) {
  for (let xp = 0.15; xp <= 0.8; xp += 0.05) {
    const x = layerBox.x + layerBox.width * xp
    const y = layerBox.y + layerBox.height * yp
    await page.mouse.move(x, y)
    try {
      await page.waitForSelector('.page-wrap[data-page="1"] .te-hover', { timeout: 120 })
      hover = { x, y }
      break outer
    } catch {
      /* 继续扫描 */
    }
  }
}
check('文本层命中（hover 高亮出现）', hover !== null, hover && `@(${Math.round(hover.x)},${Math.round(hover.y)})`)

// 4) 点击命中的文字 → 内联输入框
await page.mouse.click(hover.x, hover.y)
const input = page.locator('.te-input')
await input.waitFor({ timeout: 5000 })
const original = await input.inputValue()
check('点击命中弹出内联输入框（预填原文）', original.length > 0, original.slice(0, 20))

// 5) 画布实时预览：Enter 提交后输入框即移除，先记下编辑框位置再提交
const editPos = await page.evaluate(() => {
  const iw = document.querySelector('.page-wrap[data-page="1"] .te-input-wrap')
  return iw ? { left: iw.offsetLeft, top: iw.offsetTop, w: iw.offsetWidth, h: iw.offsetHeight } : null
})
await input.fill('Electron 冒烟测试改写')
await input.press('Enter')

// 6) 侧栏出现「编辑记录（1）」+ 提交位置的画布像素应有墨迹
check('侧栏出现编辑记录（1）', await page.getByText('编辑记录（1）').waitFor({ timeout: 5000 }).then(() => true).catch(() => false))

const ink = await page.evaluate((pos) => {
  if (!pos) return -1
  const cv = document.querySelector('.page-wrap[data-page="1"] canvas')
  const sf = cv.width / cv.getBoundingClientRect().width
  const d = cv
    .getContext('2d')
    .getImageData(Math.round(pos.left * sf), Math.round(pos.top * sf), Math.round(pos.w * sf), Math.round(pos.h * sf))
    .data
  let n = 0
  for (let q = 0; q < d.length; q += 4) if (Math.min(d[q], d[q + 1], d[q + 2]) < 235) n++
  return n / (d.length / 4)
}, editPos)
check('画布实时预览有墨迹', ink > 0.1, `inkRatio=${typeof ink === 'number' ? ink.toFixed(3) : ink} pos=${JSON.stringify(editPos)}`)

// 7) 导出（无编辑记录时按钮 disabled，records 非空才会走导出）
const exportBtn = page.getByRole('button', { name: /导出 PDF/ })
check('导出按钮已启用（记录非空的旁证）', await exportBtn.isEnabled())
await page.evaluate(() => {
  window.__bytes = null
  const orig = HTMLAnchorElement.prototype.click
  HTMLAnchorElement.prototype.click = function () {
    if (this.href.startsWith('blob:') && this.download) {
      fetch(this.href)
        .then((r) => r.arrayBuffer())
        .then((b) => (window.__bytes = new Uint8Array(b)))
    } else orig.call(this)
  }
})
await exportBtn.click()
await page.waitForFunction(() => window.__bytes, { timeout: 30000 })
const bytes = Buffer.from(
  await page.evaluate(() => {
    const u8 = window.__bytes
    let s = ''
    for (let i = 0; i < u8.length; i += 8192) s += String.fromCharCode.apply(null, u8.subarray(i, i + 8192))
    return btoa(s)
  }),
  'base64',
)
check('导出有字节流', bytes.length > 1000, `${bytes.length} B`)
check('PDF 文件头', bytes.subarray(0, 5).toString() === '%PDF-')
const outDoc = await PDFDocument.load(bytes)
check('导出可解析且 3 页', outDoc.getPageCount() === 3, `${outDoc.getPageCount()} 页`)
const outPath = path.join(root, 'release', 'smoke-exported.pdf')
fs.mkdirSync(path.dirname(outPath), { recursive: true })
fs.writeFileSync(outPath, bytes)
console.log('      导出样本已保存:', outPath)

// 8) 草稿持久化：等防抖落盘 → 重载 → 重开同一文件（同指纹）→ 编辑记录应从 IndexedDB 恢复
let draftSaved = false
for (let i = 0; i < 20 && !draftSaved; i++) {
  await new Promise((r) => setTimeout(r, 300))
  draftSaved = (await dumpIdb()).some((d) => d.fileName === 'sample.pdf' && d.recs === 1)
}
check('编辑后草稿写入 IndexedDB', draftSaved, JSON.stringify(await dumpIdb()))

await page.reload()
await page.waitForSelector('input[type=file]', { state: 'attached', timeout: 15000 })
await page.setInputFiles('input[type=file]', SAMPLE)
check(
  '重开同文件后草稿自动恢复（IndexedDB）',
  await page
    .getByText('编辑记录（1）')
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false),
)
check('重开后导出按钮仍启用', await page.getByRole('button', { name: /导出 PDF/ }).isEnabled())

await app.close()
console.log(fails.length ? `\n${fails.length} 项失败：${fails.join(' / ')}` : '\n全部通过 ✔')
process.exit(fails.length ? 1 : 0)
