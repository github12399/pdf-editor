import { defineStore } from 'pinia'
import { computed, ref } from 'vue'
import type { PdfRect } from '../services/text'

/** 一条文本编辑记录：记录某一处原文在页面空间（左下原点，单位为 pdf 点）的位置与改后文本 */
export interface EditRecord {
  id: string
  pageIndex: number // 1-based
  /** 命中键，形如 `pageIndex:seq`，用于把预览/导出与具体文本项对应 */
  hitKey: string
  pdfRect: PdfRect
  originalText: string
  newText: string
  fontSize: number
}

/** 撤销/重做栈中的一步：记录该 hitKey 在本次提交前/后的 newText */
interface EditOp extends EditRecord {
  /** 操作前该 hitKey 的 newText；null = 首次新增 */
  prevText: string | null
}

export const useEditStore = defineStore('edit', () => {
  /** 文本编辑模式开关（只在开启时允许点击改字） */
  const editing = ref(false)

  /** 编辑操作栈；undo/redo 只移动游标，records 由栈重放得到 */
  const ops = ref<EditOp[]>([])
  const cursor = ref(-1) // 当前生效到 ops[cursor]；-1 = 尚无生效操作

  let uid = 0

  /** 按栈顺序重放 ops[0..cursor]，同一 hitKey 只保留最新一次提交 */
  const records = computed<EditRecord[]>(() => {
    const map = new Map<string, EditRecord>()
    for (let i = 0; i <= cursor.value; i++) {
      const o = ops.value[i]
      map.set(o.hitKey, o)
    }
    return [...map.values()]
  })

  const undoable = computed(() => cursor.value >= 0)
  const redoable = computed(() => cursor.value < ops.value.length - 1)

  /** 按页索引：某页已编辑的 hitKey 集合 */
  const editedKeysByPage = computed(() => {
    const m = new Map<number, Set<string>>()
    for (const r of records.value) {
      if (!m.has(r.pageIndex)) m.set(r.pageIndex, new Set())
      m.get(r.pageIndex)!.add(r.hitKey)
    }
    return m
  })

  function commit(rec: Omit<EditRecord, 'id'>) {
    // 新提交截断 redo 分支
    ops.value = ops.value.slice(0, cursor.value + 1)
    const prev = records.value.find((r) => r.hitKey === rec.hitKey)
    ops.value.push({
      ...rec,
      id: prev?.id ?? `e${++uid}`,
      originalText: prev?.originalText ?? rec.originalText,
      prevText: prev?.newText ?? null,
    })
    cursor.value = ops.value.length - 1
  }

  function undo() {
    if (cursor.value >= 0) cursor.value--
  }

  function redo() {
    if (cursor.value < ops.value.length - 1) cursor.value++
  }

  /** 显式删除一条记录（侧栏删除）：从栈中移除其全部操作并修正游标 */
  function remove(id: string) {
    const idx = ops.value.findIndex((o) => o.id === id)
    if (idx < 0) return
    ops.value = ops.value.filter((o) => o.id !== id)
    if (cursor.value >= idx) {
      cursor.value = Math.min(cursor.value - 1, ops.value.length - 1)
    }
  }

  /** 用持久化的记录重建编辑栈（打开文档恢复草稿时调用）；恢复后视为首次新增 */
  function hydrate(records: EditRecord[]) {
    ops.value = records.map((r) => ({
      ...r,
      prevText: null,
    }))
    cursor.value = records.length - 1
    let max = 0
    for (const r of records) {
      const n = Number(r.id.slice(1))
      if (Number.isFinite(n) && n > max) max = n
    }
    uid = max
  }

  function clear() {
    ops.value = []
    cursor.value = -1
  }

  function isEdited(pageIndex: number, hitKey: string): boolean {
    return editedKeysByPage.value.get(pageIndex)?.has(hitKey) ?? false
  }

  return {
    editing,
    records,
    undoable,
    redoable,
    editedKeysByPage,
    commit,
    undo,
    redo,
    remove,
    hydrate,
    clear,
    isEdited,
  }
})