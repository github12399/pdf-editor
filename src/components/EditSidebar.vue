<script setup lang="ts">
import { computed } from 'vue'
import { useDocStore } from '../stores/docStore'
import { useEditStore } from '../stores/editStore'
import { deleteDraft } from '../services/draftStore'
import type { EditRecord } from '../stores/editStore'

const store = useDocStore()
const edit = useEditStore()

/** 按页分组（页码升序，页内按记录出现顺序） */
const byPage = computed(() => {
  const map = new Map<number, EditRecord[]>()
  for (const r of edit.records) {
    if (!map.has(r.pageIndex)) map.set(r.pageIndex, [])
    map.get(r.pageIndex)!.push(r)
  }
  return [...map.entries()].sort((a, b) => a[0] - b[0])
})

function clearAll() {
  edit.clear()
  const fp = store.fingerprint
  if (fp) void deleteDraft(fp).catch(() => {})
}
</script>

<template>
  <aside class="edit-sidebar">
    <div class="sidebar-head">
      <span>编辑记录（{{ edit.records.length }}）</span>
      <button
        v-if="edit.records.length"
        class="btn mini"
        title="删除全部修改记录"
        @click="clearAll"
      >
        全部清空
      </button>
    </div>

    <div v-if="!edit.records.length" class="sidebar-empty">
      <p>暂无编辑记录</p>
      <p class="dim">开启工具栏「✏️ 改文字」后，点击 PDF 上的文字即可修改。</p>
    </div>

    <div v-else class="sidebar-list">
      <template v-for="[page, items] in byPage" :key="page">
        <div class="sidebar-page">第 {{ page }} 页</div>
        <div
          v-for="r in items"
          :key="r.id"
          class="sidebar-item"
          :title="`双击跳转到第 ${page} 页`"
          @dblclick="store.goToPage(r.pageIndex)"
        >
          <div class="sidebar-text">
            <span class="old" :title="r.originalText">{{ r.originalText }}</span>
            <span class="arrow">↓</span>
            <span class="new" :title="r.newText">{{ r.newText }}</span>
          </div>
          <button class="btn mini" title="删除这一处修改" @click="edit.remove(r.id)">✕</button>
        </div>
      </template>
    </div>
  </aside>
</template>

<style scoped>
.edit-sidebar {
  width: 300px;
  flex: none;
  display: flex;
  flex-direction: column;
  background: var(--toolbar-bg);
  border-left: 1px solid #3d434e;
  color: var(--toolbar-fg);
  overflow: hidden;
}

.sidebar-head {
  flex: none;
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 12px;
  font-weight: 600;
  border-bottom: 1px solid #3d434e;
}

.sidebar-empty {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 6px;
  text-align: center;
  padding: 20px;
  color: var(--toolbar-fg);
}

.sidebar-empty .dim {
  color: var(--toolbar-fg-dim);
  font-size: 13px;
}

.sidebar-list {
  flex: 1;
  overflow-y: auto;
  padding: 10px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.sidebar-page {
  font-size: 12px;
  color: var(--toolbar-fg-dim);
  margin-top: 4px;
}

.sidebar-item {
  display: flex;
  align-items: center;
  gap: 6px;
  background: #31363f;
  border: 1px solid #3d434e;
  border-radius: 6px;
  padding: 6px 8px;
  cursor: default;
}

.sidebar-item:hover {
  border-color: var(--accent);
}

.sidebar-text {
  flex: 1;
  min-width: 0;
  display: flex;
  flex-direction: column;
  gap: 1px;
  font-size: 12px;
}

.old {
  color: #f87171;
  text-decoration: line-through;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.arrow {
  color: var(--toolbar-fg-dim);
  font-size: 11px;
  line-height: 1;
}

.new {
  color: #a7f3d0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
