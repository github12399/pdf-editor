/**
 * 生成测试 PDF：供 M1/M6 验证"打开→渲染→翻页→缩放→改字"全流程。
 * 用法：pnpm tsx scripts/gen-sample-pdf.mjs （直接 node 运行即可）
 */
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib'
import fontkit from '@pdf-lib/fontkit'

const SIMHEI = 'C:/Windows/Fonts/simhei.ttf'
const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'samples')
const outFile = path.join(outDir, 'sample.pdf')

async function main() {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  const cjk = await doc.embedFont(fs.readFileSync(SIMHEI), { subset: true })
  const helv = await doc.embedFont(StandardFonts.Helvetica)
  const helvB = await doc.embedFont(StandardFonts.HelveticaBold)

  // ---- 第 1 页：英文标题 + 中英混排 ----
  const p1 = doc.addPage([595.28, 841.89]) // A4
  p1.drawText('PDF Text Editor - Sample', { x: 60, y: 780, size: 26, font: helvB })
  p1.drawText('This PDF is generated for testing the editor.', {
    x: 60, y: 748, size: 12, font: helv, color: rgb(0.35, 0.35, 0.35),
  })
  p1.drawText('中文测试：这是第一行中文，用于验证文字修改能力。', {
    x: 60, y: 700, size: 15, font: cjk,
  })
  p1.drawText('混排 Mixed line with English words 结束。', {
    x: 60, y: 668, size: 15, font: cjk,
  })
  p1.drawText('彩色文字 Color text line:', {
    x: 60, y: 620, size: 14, font: cjk, color: rgb(0.78, 0.16, 0.16),
  })
  p1.drawText('Small font short line', {
    x: 60, y: 560, size: 10, font: helv,
  })

  // ---- 第 2 页：中文正文 ----
  const p2 = doc.addPage([595.28, 841.89])
  p2.drawText('第二页 · 正文内容', { x: 60, y: 780, size: 22, font: cjk })
  p2.drawText('这里是第二页的中文正文段落，用于验证翻页与逐页文字编辑。', {
    x: 60, y: 740, size: 14, font: cjk,
  })
  p2.drawText('支持连续修改多处文字，修改结果实时预览。', {
    x: 60, y: 714, size: 14, font: cjk,
  })

  // ---- 第 3 页：简短内容 ----
  const p3 = doc.addPage([595.28, 841.89])
  p3.drawText('Page 3 · Short Line for testing.', { x: 60, y: 400, size: 12, font: helv })

  fs.mkdirSync(outDir, { recursive: true })
  const bytes = await doc.save()
  fs.writeFileSync(outFile, bytes)
  console.log('saved:', outFile, bytes.length, 'bytes')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})