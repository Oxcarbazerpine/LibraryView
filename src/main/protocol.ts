import { net, protocol } from 'electron'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { coversDirectory } from './covers'

/** 必须在 app ready 之前调用：把 lvimg 注册为受信方案。 */
export function registerLvimgScheme(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: 'lvimg',
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
    }
  ])
}

/** app ready 之后调用：处理 lvimg://cover/<id> → 缓存的封面文件。 */
export function handleLvimg(): void {
  protocol.handle('lvimg', async (req) => {
    try {
      const u = new URL(req.url)
      if (u.host === 'cover') {
        const id = u.pathname.replace(/[^0-9]/g, '')
        if (!id) return new Response(null, { status: 400 })
        const file = join(coversDirectory(), `${id}.png`)
        try {
          return await net.fetch(pathToFileURL(file).toString())
        } catch {
          return new Response(null, { status: 404 })
        }
      }
      return new Response(null, { status: 404 })
    } catch {
      return new Response(null, { status: 500 })
    }
  })
}
