/**
 * 像素级颜色工具（预览层与导出管线共用，保证"擦除填充"算法一致）。
 *
 * 坐标统一为「设备像素」（已乘 devicePixelRatio），与 pdfjs 渲染画布逐像素对齐。
 */

/**
 * 取 2D 上下文画布中矩形 (x0, y0, w, h) 外带 ring 像素环的中位背景色。
 * - 忽略透明像素（canvas 无底色区域），避免 (0,0,0,0) 污染中位数；
 * - 全部透明时返回白色（无底色文档按白纸处理）。
 */
export function medianOuterRing(
  ctx: CanvasRenderingContext2D,
  x0: number,
  y0: number,
  w: number,
  h: number,
  ring = 2,
): [number, number, number] {
  const sx = Math.max(0, x0 - ring - 1)
  const sy = Math.max(0, y0 - ring - 1)
  const sw = Math.min(ctx.canvas.width - sx, w + ring * 2 + 2)
  const sh = Math.min(ctx.canvas.height - sy, h + ring * 2 + 2)
  if (sw <= 0 || sh <= 0) return [255, 255, 255]
  const data = ctx.getImageData(sx, sy, sw, sh).data
  const rs: number[] = []
  const gs: number[] = []
  const bs: number[] = []
  for (let yy = 0; yy < sh; yy++) {
    for (let xx = 0; xx < sw; xx++) {
      const border = xx < ring || yy < ring || xx >= sw - ring || yy >= sh - ring
      if (!border) continue
      const i = (yy * sw + xx) * 4
      if (data[i + 3] < 128) continue
      rs.push(data[i])
      gs.push(data[i + 1])
      bs.push(data[i + 2])
    }
  }
  if (!rs.length) return [255, 255, 255]
  const mid = (a: number[]) => a.sort((x, y) => x - y)[a.length >> 1]
  return [mid(rs), mid(gs), mid(bs)]
}