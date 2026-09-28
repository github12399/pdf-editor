const { app, BrowserWindow, protocol, net, Menu, shell } = require('electron')
const path = require('node:path')
const { pathToFileURL } = require('node:url')

/** 前端产物目录（electron-builder 打包后位于 asar 内，同样按相对路径可读） */
const DIST = path.join(__dirname, '..', 'dist')

// 必须在 app.ready 之前注册特权协议。
// standard+secure：页面以标准 URL 语义加载（绝对路径 /x 正确解析、可写 IndexedDB）；
// supportFetchAPI：应用运行期 fetch('/pdf.worker.min.mjs' | '/fonts/simhei.ttf' | …) 可用；
// stream：允许 Range/流式响应，pdfjs 按需拉取 cmaps / standard_fonts。
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
])

/** app://<任意 host>/<path> → dist/<path>；host 不参与查找（统一忽略）。
 *  handle 访问默认 session，必须在 app ready 后调用（ready 前仅能 registerSchemesAsPrivileged）。 */
function registerAppProtocol() {
  protocol.handle('app', (request) => {
    try {
      const { pathname } = new URL(request.url)
      const rel = decodeURIComponent(pathname).replace(/^\/+/, '') || 'index.html'
      const file = path.normalize(path.join(DIST, rel))
      if (!file.startsWith(DIST)) return new Response('forbidden', { status: 403 })
      return net.fetch(pathToFileURL(file).toString())
    } catch {
      return new Response('not found', { status: 404 })
    }
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 860,
    minWidth: 860,
    minHeight: 600,
    title: 'PDF 文字编辑器',
    autoHideMenuBar: true,
    backgroundColor: '#f3f4f6',
    webPreferences: {
      contextIsolation: true,
      sandbox: true,
    },
  })
  // 拦截 window.open / 外链，走系统浏览器
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:/i.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.loadURL('app://bundle/index.html')
}

// 单实例：二次启动时聚焦已有窗口（双击便携版两次时体验一致）
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })

  Menu.setApplicationMenu(null) // 无需默认菜单（File/Edit…），界面全部在页面内

  app.whenReady().then(() => {
    registerAppProtocol()
    createWindow()
  })

  app.on('window-all-closed', () => {
    app.quit()
  })
}
