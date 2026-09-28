/* Map upsert 提案 polyfill：pdfjs-dist v6 用到 Map.prototype.getOrInsert(Computed)，
 * 旧内核（Electron 38 / Chromium 140 及更早、部分国产浏览器）尚未 ship 该方法，
 * 缺失时 pdfjs 直接抛错、文本层无法加载。主线程与 pdfjs worker 各注入一份
 * （worker 见 services/pdf.ts initWorker）。 */
if (typeof (Map.prototype as any).getOrInsert !== 'function') {
  Object.defineProperties(Map.prototype, {
    getOrInsert: {
      value(key: any, value: any) {
        if (!this.has(key)) this.set(key, value)
        return this.get(key)
      },
      writable: true,
      configurable: true,
    },
    getOrInsertComputed: {
      value(key: any, calc: () => any) {
        if (!this.has(key)) this.set(key, calc())
        return this.get(key)
      },
      writable: true,
      configurable: true,
    },
  })
}

import { createApp } from 'vue'
import { createPinia } from 'pinia'
import './style.css'
import App from './App.vue'

createApp(App).use(createPinia()).mount('#app')
