import {
  getDocument,
  GlobalWorkerOptions,
  type PDFDocumentProxy,
  type PDFPageProxy,
  type PDFDocumentLoadingTask,
  type PageViewport,
} from 'pdfjs-dist'

let workerInit: Promise<void> | null = null

/* ---------- IAB rAF 兼容 ----------
 * IAB（应用内浏览器）实测：window.requestAnimationFrame 的回调从不触发
 * （请求发出后 hits 恒为 0）。pdf.js 渲染默认 useRequestAnimationFrame=true，
 * InternalRenderTask._next 只由 rAF 回调驱动，于是 operatorListIdx 永远停在
 * 0、canvas 空白、render promise 永不 settle。这里把 rAF 请求统一改为微任务
 * 调度（保留请求 id 与取消语义），让 _scheduleNext 的 rAF 分支立即推进。 */
let rafPatched = false
function patchRafForIab() {
  if (rafPatched || typeof window === 'undefined') return
  rafPatched = true
  const pending = new Map<number, true>()
  let seq = 0
  window.requestAnimationFrame = ((cb: FrameRequestCallback): number => {
    const id = ++seq
    pending.set(id, true)
    queueMicrotask(() => {
      if (!pending.delete(id)) return // 已被 cancelAnimationFrame 取消
      cb(performance.now())
    })
    return id
  }) as typeof window.requestAnimationFrame
  window.cancelAnimationFrame = ((id: number): void => {
    pending.delete(id)
  }) as typeof window.cancelAnimationFrame
}
// Electron 等正常宿主的原生 rAF 无恙；补丁会把渲染循环改成同步微任务，
// 大文档渲染时不让出主线程，故仅在补丁目标环境（IAB）启用。
if (!navigator.userAgent.includes('Electron')) patchRafForIab()

/**
 * 自建 pdfjs worker 并注入 workerPort。
 *
 * 为什么不用 GlobalWorkerOptions.workerSrc？IAB（应用内浏览器）里
 * `new Worker(workerSrc, {type:'module'})` 后 pdf.js 的 sendTest（带
 * transferable 的 postMessage）会抛 "Maximum call stack size exceeded"，
 * 于是 pdf.js 回退到 fake worker——它执行 `import(workerSrc)`，而 Vite 在
 * dev 下会把该动态 import 改写为 `/pdf.worker.min.mjs?import`（500），
 * 导致 getDocument() 直接失败，render() 永远挂起、canvas 空白。
 *
 * 绕开整条链路的办法：应用自己 fetch 到 worker 文件内容 → 做成 blob
 * URL → `new Worker(blobUrl, {type:'module'})`（IAB 实测可用，能正常
 * 回 ready）→ 赋给 GlobalWorkerOptions.workerPort。pdf.js 发现
 * workerPort 后走 initializeFromPort，不再触碰 workerSrc。
 */
/** worker 环境的 Map upsert polyfill——与 main.ts 同理，pdfjs v6 需要（见 main.ts 顶部说明） */
const MAP_UPSERT_POLYFILL = `
if (typeof Map.prototype.getOrInsert !== 'function') {
  Object.defineProperties(Map.prototype, {
    getOrInsert: { value(k, v) { if (!this.has(k)) this.set(k, v); return this.get(k) }, writable: true, configurable: true },
    getOrInsertComputed: { value(k, c) { if (!this.has(k)) this.set(k, c()); return this.get(k) }, writable: true, configurable: true },
  })
};
`

function initWorker(): Promise<void> {
  if (workerInit) return workerInit
  workerInit = (async () => {
    const resp = await fetch('/pdf.worker.min.mjs')
    if (!resp.ok) throw new Error(`worker 资源加载失败：HTTP ${resp.status}`)
    const text = MAP_UPSERT_POLYFILL + (await resp.text())
    const blobUrl = URL.createObjectURL(new Blob([text], { type: 'text/javascript' }))
    GlobalWorkerOptions.workerPort = new Worker(blobUrl, { type: 'module' })
  })()
  return workerInit
}

/** 加载 PDF 字节，返回文档代理。 */
export async function loadPdf(bytes: ArrayBuffer | Uint8Array): Promise<PDFDocumentLoadingTask> {
  await initWorker()
  return getDocument({
    data: bytes,
    // 传入 getDocument 的才是 resource URL；GlobalWorkerOptions 在 v6 只认
    // workerSrc / workerPort，standardFontDataUrl 放那边无效，会导致
    // 非嵌入字体数据拉取为空、render() 永久挂起。
    standardFontDataUrl: '/standard_fonts/',
    cMapUrl: '/cmaps/',
    cMapPacked: true,
  })
}

/** 读取 scale=1 的基准 viewport（宽高按 PDF 逻辑像素计算）。 */
export function getBaseViewport(page: PDFPageProxy): PageViewport {
  return page.getViewport({ scale: 1 })
}

/**
 * 渲染一页到 canvas。
 * canvas 的 CSS 尺寸 = viewport 尺寸（CSS px），内部按 devicePixelRatio 放大绘制，
 * 使后续命中检测可直接使用 CSS 像素坐标。
 */
export function renderPage(
  canvas: HTMLCanvasElement,
  page: PDFPageProxy,
  viewport: PageViewport,
): Promise<void> {
  const dpr = window.devicePixelRatio || 1
  canvas.width = Math.max(1, Math.floor(viewport.width * dpr))
  canvas.height = Math.max(1, Math.floor(viewport.height * dpr))
  canvas.style.width = `${viewport.width}px`
  canvas.style.height = `${viewport.height}px`

  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法获取 canvas 2d 上下文')

  // 清空上一帧，避免低 DPR 缩放叠加残影
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const transform = dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined
  return page
    .render({ canvas, canvasContext: ctx, viewport, transform })
    .promise.then(() => undefined)
}

export type { PDFDocumentProxy, PDFPageProxy, PageViewport }
