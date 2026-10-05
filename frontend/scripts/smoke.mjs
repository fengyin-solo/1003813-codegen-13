// 冒烟测试运行器：用 esbuild 把 scripts/smoke-bone-batch.ts 打包到临时目录后在 Node 里执行。
// 数据层在无 window 环境下走内存缓存 + 种子数据，不会碰浏览器 localStorage。
import { build } from 'esbuild'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const outfile = join(tmpdir(), `smoke-bone-batch-${Date.now()}.mjs`)

await build({
  entryPoints: ['scripts/smoke-bone-batch.ts'],
  bundle: true,
  format: 'esm',
  platform: 'node',
  alias: { '@': './src' },
  outfile,
  logLevel: 'warning',
})

await import(pathToFileURL(outfile).href)
