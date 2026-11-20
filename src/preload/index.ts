// The only bridge between the interface and the main process.
import { contextBridge, ipcRenderer, webUtils } from 'electron'

const EVENTS = ['session:changed', 'session:checkpoint', 'macro:event', 'macro:running', 'macros:changed', 'app:event',
  'roblox:playing', 'progress:newly', 'toast', 'update:ready']

contextBridge.exposeInMainWorld('luger', {
  invoke: async (channel: string, ...args: unknown[]) => {
    const r = await ipcRenderer.invoke(channel, ...args)
    if (!r.ok) throw new Error(r.error)
    return r.value
  },
  on: (event: string, fn: (payload: unknown) => void) => {
    if (!EVENTS.includes(event)) throw new Error(`Unknown event ${event}`)
    const wrapped = (_e: unknown, payload: unknown) => fn(payload)
    ipcRenderer.on(event, wrapped)
    return () => ipcRenderer.removeListener(event, wrapped)
  },
  pathForFile: (file: File) => webUtils.getPathForFile(file),
  platform: process.platform
})
