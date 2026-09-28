import { PDFDocument, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'
import type { EditRecord } from '../stores/editStore'
import type { PDFPageProxy } from 'pdfjs-dist'
import { getBaseViewport } from './pdf'
import { pdfRectToCssRect } from './text'
import { medianOuterRing } from './pixel'

/**
 * 导出管线：把原始 PDF 字节 + 编辑记录重新写出一份新 PDF。
 *
 * 对每个编辑记录：
 * 1. 擦除原字 —— 在 scale=1 离屏渲染上采样 bbox 外带的中位背景色，
 *    以该色 fillRect 覆盖 bbox（外扩 2pt）。白底文档 ≈ 无痕（与预览层同算法）。
 * 2. 重绘新字 —— 嵌入黑体后备字体（fontkit 自动子集化）+ 同字号 drawText，
 *    新字超宽时按段落宽比例缩号。
 * 坐标系：pdf-lib 原点在左下、Y 向上，与 pdfRect 的 PDF 用户空间约定一致，
 * 因此 pdfRect 可直接用于 drawRectangle / drawText。
 */
export interface ExportOptions {
  fileBytes: ArrayBuffer
  fileName: string
  records: EditRecord[]
  /** 取第 pageIndex（1-based）页的 pdfjs 页面代理，用于离屏采样渲染 */
  getPage: (pageIndex: number) => Promise<PDFPageProxy>
}

export interface ExportResult {
  bytes: Uint8Array
  fileName: string
}

/** 擦除矩形外扩（PDF 点 / scale=1 设备像素） */
const PAD = 2
/** 最小可读字号（pt）——缩号下限 */
const MIN_SIZE = 6
/** 新字颜色 v1：接近 #111；原文彩色提取（operator list）见计划 P1 */
const INK = rgb(0.07, 0.07, 0.07)

let fontBytesPromise: Promise<Uint8Array> | null = null

/** 后端字体（黑体，中英混排）——子集化后体积交给 M5 优化，此处直接可用即可 */
export function loadFallbackFont(): Promise<Uint8Array> {
  if (!fontBytesPromise) {
    fontBytesPromise = fetch('/fonts/simhei.ttf').then((resp) => {
      if (!resp.ok) throw new Error(`后备字体加载失败：HTTP ${resp.status}`)
      return resp.arrayBuffer().then((b) => new Uint8Array(b))
    })
  }
  return fontBytesPromise
}

async function samplePage(
  page: PDFPageProxy,
): Promise<{ ctx: CanvasRenderingContext2D; canvas: HTMLCanvasElement }> {
  const vp1 = getBaseViewport(page)
  const canvas = document.createElement('canvas')
  canvas.width = Math.round(vp1.width)
  canvas.height = Math.round(vp1.height)
  const ctx = canvas.getContext('2d')!
  await page
    .render({ canvasContext: ctx, viewport: vp1, canvas })
    .promise
  return { ctx, canvas }
}

export async function exportEditedPdf(opts: ExportOptions): Promise<ExportResult> {
  if (!opts.records.length) throw new Error('没有可导出的编辑记录')

  const [doc] = await Promise.all([
    PDFDocument.load(new Uint8Array(opts.fileBytes)),
  ])
  doc.registerFontkit(fontkit)

  // 同 hitKey 只导出最新一次提交（records 本身已按栈重放去重，这里再兜底一次）
  const byPage = new Map<number, EditRecord[]>()
  for (const r of opts.records) {
    if (!byPage.has(r.pageIndex)) byPage.set(r.pageIndex, [])
    byPage.get(r.pageIndex)!.push(r)
  }

  for (const [pageIndex, recs] of byPage) {
    const page = await opts.getPage(pageIndex)
    const { ctx, canvas } = await samplePage(page)
    const pdfPage = doc.getPage(pageIndex - 1)

    // 每页共用一个子集字体（embedFont 每次调用都嵌入，同页只嵌一次）
    const font = await doc.embedFont(await loadFallbackFont(), {
      subset: true,
    })

    for (const rec of recs) {
      const px = rec.pdfRect
      // scale=1 下 CSS/设备像素与 pdf 点 1:1，采样即可用设备坐标
      const css = pdfRectToCssRect(px, getBaseViewport(page))
      const dx = Math.max(0, Math.floor(css.x - PAD))
      const dy = Math.max(0, Math.floor(css.y - PAD))
      const dw = Math.min(canvas.width - dx, Math.ceil(css.w + PAD * 2))
      const dh = Math.min(canvas.height - dy, Math.ceil(css.h + PAD * 2))
      const [br, bg, bb] =
        dw > 0 && dh > 0 ? medianOuterRing(ctx, dx, dy, dw, dh) : [255, 255, 255]

      // 擦除原字
      pdfPage.drawRectangle({
        x: px.x - PAD,
        y: px.y - PAD,
        width: px.w + PAD * 2,
        height: px.h + PAD * 2,
        color: rgb(br / 255, bg / 255, bb / 255),
      })

      // 重绘新字（基线 = pdfRect 顶 + 0.2em；与预览层取法一致）
      const baselineY = px.y + rec.fontSize * 0.2
      let fs = rec.fontSize
      for (let i = 0; i < 8; i++) {
        const tw = font.widthOfTextAtSize(rec.newText, fs)
        if (tw <= px.w + PAD * 2 || fs <= MIN_SIZE) break
        fs *= (px.w + PAD * 2 - 1) / tw
      }
      pdfPage.drawText(rec.newText, {
        x: px.x - PAD + 1,
        y: baselineY,
        size: fs,
        font,
        color: INK,
      })
    }
  }

  const bytes = await doc.save()
  const base = opts.fileName.replace(/\.pdf$/i, '') || 'document'
  return { bytes, fileName: `${base}-edited.pdf` }
}