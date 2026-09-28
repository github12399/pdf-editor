<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { useDocStore } from '../stores/docStore'
import { useEditStore } from '../stores/editStore'
import { pdfRectToCssRect } from '../services/text'
import { medianOuterRing } from '../services/pixel'

/**
 * 编辑实时预览层：覆盖在 pdfjs 渲染的原文 canvas 之上（z-index 3），
 * 对本页生效的每条编辑记录做「擦旧字 + 画新字」。
 * - 擦除：对 bbox 做 2px 外扩，填充其外带像素的中位色（白底文档 ≈ 无痕）；
 *   采样在 device 像素空间进行，与 pdfjs canvas 逐像素对齐。
 * - 重绘：canvas 用系统后备字体（Segoe UI / 微软雅黑）同字号绘新字；新字
 *   超出段落宽时按比例自动缩号（与导出管线共用同一适配策略的简化版）。
 * 撤销/重做/新提交都只改 edit store 游标 → records 重放变化 → watch 驱动的
 * 全量重绘天然随栈移动而恢复/重放。
 */
const props = defineProps<{ pageIndex: number }>()
const store = useDocStore()
const edit = useEditStore()

const canvasEl = ref<HTMLCanvasElement | null>(null)

const pageRecords = computed(() =>
  edit.records.filter((r) => r.pageIndex === props.pageIndex),
)

const FONT_FAMILY = '"Segoe UI", "Microsoft YaHei", "PingFang SC", sans-serif'
const PAD_CSS = 2 // 擦除矩形的 CSS px 外扩（覆盖墨迹上下的浅余量）
const INK_COLOR = '#111111' // v1 统一深黑；原文彩色提取见导出管线 P1

function redraw() {
  const canvas = canvasEl.value
  const vp = store.pageViewports[props.pageIndex - 1]
  const recs = pageRecords.value
  const ctx = canvas?.getContext('2d')
  if (!canvas || !ctx || !vp) return

  // 与 pdfjs 原文 canvas 逐像素对齐（尺寸/样式都跟它走）
  const src = canvas.parentElement?.querySelector('canvas')
  if (!src || src === canvas) return
  if (canvas.width !== src.width || canvas.height !== src.height) {
    canvas.width = src.width
    canvas.height = src.height
    canvas.style.width = src.style.width
    canvas.style.height = src.style.height
  }

  ctx.save()
  ctx.setTransform(1, 0, 0, 1, 0, 0)
  ctx.clearRect(0, 0, canvas.width, canvas.height)

  const dpr = window.devicePixelRatio || 1
  for (const r of recs) {
    const css = pdfRectToCssRect(r.pdfRect, vp)
    const px0 = Math.max(0, Math.floor((css.x - PAD_CSS) * dpr))
    const py0 = Math.max(0, Math.floor((css.y - PAD_CSS) * dpr))
    const pw = Math.min(canvas.width - px0, Math.ceil((css.w + PAD_CSS * 2) * dpr))
    const ph = Math.min(canvas.height - py0, Math.ceil((css.h + PAD_CSS * 2) * dpr))
    if (pw <= 0 || ph <= 0) continue

    // 擦旧字：外带中位色填满
    const [br, bg, bb] = medianOuterRing(ctx, px0, py0, pw, ph)
    ctx.fillStyle = `rgb(${br},${bg},${bb})`
    ctx.fillRect(px0, py0, pw, ph)

    // 画新字：基线 = pdfRect 顶 + 0.2em（pdf 空间），转 viewport CSS 再乘 dpr
    const baselineCssY = vp.convertToViewportPoint(r.pdfRect.x, r.pdfRect.y + r.fontSize * 0.2)[1]
    const maxW = (css.w + PAD_CSS * 2) * dpr
    let sizePx = r.fontSize * vp.scale * dpr
    for (let tries = 0; tries < 8; tries++) {
      ctx.font = `${sizePx}px ${FONT_FAMILY}`
      if (ctx.measureText(r.newText).width <= maxW || sizePx < 4 * dpr) break
      sizePx *= (maxW - PAD_CSS * 2 * dpr) / ctx.measureText(r.newText).width
    }
    ctx.textBaseline = 'alphabetic'
    ctx.textAlign = 'left'
    ctx.fillStyle = INK_COLOR
    ctx.fillText(r.newText, px0 + PAD_CSS * dpr, baselineCssY * dpr)
  }
  ctx.restore()
}

/* 触发时机：页码 viewport 就绪/变化、pdfjs 渲染完成（采样需原文）、本页记录变化 */
watch(
  () => [store.pageViewports[props.pageIndex - 1], store.renderScales[props.pageIndex - 1]] as const,
  () => redraw(),
)
watch(pageRecords, () => redraw())
</script>

<template>
  <canvas ref="canvasEl" class="patch-layer"></canvas>
</template>

<style scoped>
.patch-layer {
  position: absolute;
  top: 0;
  left: 0;
  display: block;
  z-index: 3;
  pointer-events: none;
}
</style>