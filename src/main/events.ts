import { webContents } from 'electron'

/** 向所有渲染窗口广播事件。 */
export function broadcast(channel: string, payload?: unknown): void {
  for (const wc of webContents.getAllWebContents()) {
    if (!wc.isDestroyed()) wc.send(channel, payload)
  }
}
