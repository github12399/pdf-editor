import type { PDFPageProxy, PageViewport } from 'pdfjs-dist'

/**
 * 页面空间矩形（PDF 点，Y 向上）。
 * 约定：(x, y) 为左下角，w 向右、h 向上 —— 与 PDF 用户空间 / pdf-lib 一致。
 */
export interface PdfRect {
  x: number
  y: number
  w: number
  h: number
}

/** 命中检测用的文本项 */
export interface TextHit {
  str: string
  pdfRect: PdfRect
  fontSize: number
  fontName: string
  hasEOL: boolean
}

/** pdfjs 文本项的最小结构（TextItem 类型未从包入口导出） */
interface RawTextItem {
  str: string
  transform: number[]
  width: number
  fontName: string
  hasEOL: boolean
}

function isTextItem(item: unknown): item is RawTextItem {
  return typeof (item as { str?: unknown }).str === 'string'
}

/**
 * 提取页面文本项并换算为页面空间 bbox。
 * 文本项 transform 为 [a,b,c,d,e,f]（PDF 页面空间，Y 向上）：e/f 是基线左端点，
 * 字号 = hypot(c,d)。
 *
 * bbox 需要覆盖 pdf.js canvas 渲染出的实际字形墨迹。像素级实测（getImageData
 * 行扫描 + viewport.convertToViewportPoint 核对基线，6 行含英文/中文/混排/小字）
 * 表明墨迹覆盖 [baselineY - 0.15em, baselineY + 0.86em]（英文线帽 +0.73em、
 * 中文全角顶 +0.86em、descender 仅 -0.15em），因此矩形取 y = baseline - 0.2em、
 * h = 1.0em，上下各留约 0.05em 余量。
 */
export async function getPageTextHits(page: PDFPageProxy): Promise<TextHit[]> {
  const content = await page.getTextContent()
  const hits: TextHit[] = []
  for (const item of content.items) {
    if (!isTextItem(item)) continue
    if (!item.str.trim()) continue
    const t = item.transform
    const fontSize = Math.hypot(t[2], t[3])
    if (!fontSize || fontSize <= 0) continue
    hits.push({
      str: item.str,
      pdfRect: {
        x: t[4],
        y: t[5] - fontSize * 0.2, // 实测墨迹底 ≈ 基线 - 0.15em（见文件头注释）
        w: item.width,
        h: fontSize, // 覆盖字形墨迹高度（顶 ≈ 基线 + 0.86em）
      },
      fontSize,
      fontName: item.fontName,
      hasEOL: item.hasEOL,
    })
  }
  return hits
}

/** 页面空间 bbox → 渲染该页的 viewport 空间（CSS 坐标，Y 向下，原点左上） */
export function pdfRectToCssRect(pdf: PdfRect, viewport: PageViewport): PdfRect {
  // pdfjs v6 的 PageViewport 已移除 convertToViewportRectangle，
  // 改用 convertToViewportPoint 变换对角两点后取 min/max 归一（Y 轴镜像时方向反转）
  const [x0, y0] = viewport.convertToViewportPoint(pdf.x, pdf.y)
  const [x1, y1] = viewport.convertToViewportPoint(pdf.x + pdf.w, pdf.y + pdf.h)
  return {
    x: Math.min(x0, x1),
    y: Math.min(y0, y1),
    w: Math.abs(x1 - x0),
    h: Math.abs(y1 - y0),
  }
}