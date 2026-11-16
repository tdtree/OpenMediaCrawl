import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { rm, stat } from 'node:fs/promises'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import vm from 'node:vm'
import { ensureDir, writeFileAtomic } from '../../core/fsutil.js'
import { catbusHome, packageJson, staticFile } from '../../core/paths.js'
import { createContext } from '../../core/vm.js'

export interface Check {
  name: string
  ok: boolean
  message: string
}

const require = createRequire(import.meta.url)

/** onnx 冒烟用的最小模型：c = a + b，float32[2]。 */
const ADD_MODEL =
  'CAg6SAoOCgFhCgFiEgFjIgNBZGQSA2FkZFoPCgFhEgoKCAgBEgQKAggCWg8KAWISCgoICAESBAoCCAJiDwoBYxIKCggIARIECgIIAkIECgAQDQ=='

async function check(name: string, run: () => string | Promise<string>): Promise<Check> {
  try {
    return { name, ok: true, message: await run() }
  } catch (err) {
    return { name, ok: false, message: err instanceof Error ? err.message : String(err) }
  }
}

/** 已安装依赖的版本：从入口文件向上找它的 package.json（有的包不导出 ./package.json）。 */
function installedVersion(name: string): string {
  let dir = dirname(require.resolve(name))
  for (;;) {
    try {
      const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
      if (pkg.name === name) return pkg.version
    } catch {}
    const parent = dirname(dir)
    if (parent === dir) return '?'
    dir = parent
  }
}

/** 只支持 engines 里用到的写法：`^x.y.z`、`>=x.y.z`，用 `||` 连接。 */
export function satisfies(version: string, range: string): boolean {
  const v = version.split('.').map(Number)
  return range.split('||').some((part) => {
    const m = /^\s*(\^|>=)(\d+)\.(\d+)\.(\d+)\s*$/.exec(part)
    if (!m) return false
    const min = [Number(m[2]), Number(m[3]), Number(m[4])]
    const i = v.findIndex((n, j) => n !== min[j])
    const atLeast = i === -1 || v[i]! > min[i]!
    return atLeast && (m[1] === '>=' || v[0] === min[0])
  })
}

export async function doctor(): Promise<Check[]> {
  const engines = packageJson().engines.node
  return [
    await check('node', () => {
      const v = process.versions.node
      if (!satisfies(v, engines)) throw new Error(`Node ${v} 不满足要求 ${engines}`)
      return `Node ${v}（要求 ${engines}）`
    }),

    await check('home', async () => {
      const home = catbusHome()
      await ensureDir(home)
      const probe = join(home, '.doctor')
      await writeFileAtomic(probe, 'ok')
      await rm(probe, { force: true })
      if (process.platform !== 'win32') {
        const mode = (await stat(home)).mode & 0o777
        if (mode & 0o077) {
          throw new Error(`${home} 的权限是 ${mode.toString(8).padStart(4, '0')}，其他用户可以访问；执行 chmod 700 ${home}`)
        }
      }
      return `${home} 可写`
    }),

    await check('vm', () => {
      const expected = createHash('md5').update('catbus').digest('hex')
      const got = vm.runInContext(`require('node:crypto').createHash('md5').update('catbus').digest('hex')`, createContext())
      if (got !== expected) throw new Error(`签名 vm 的结果不对：${got}`)
      return 'node:vm + require 正常'
    }),

    await check('static', () => {
      // 自定义镜像最容易漏掉 static/（Dockerfile.web 曾经就漏了），
      // 少了这些文件抖音登录会直接报 ENOENT，采集也会拿不到签名脚本。
      const required = [
        ['douyin', 'challenge_profile.json'],
        ['douyin', 'mstoken_profile.json'],
        ['tiktok', 'Tiktok_Request.json'],
        ['x', 'transaction_l1.json'],
      ] as const
      const missing = required.filter(([platform, file]) => {
        try { return readFileSync(staticFile(platform, file)).length === 0 } catch { return true }
      })
      if (missing.length) throw new Error(`缺少静态文件：${missing.map(([p, f]) => `static/${p}/${f}`).join('、')}（容器镜像要 COPY static/）`)
      return `${required.length} 个关键静态文件可读`
    }),

    await check('http', async () => {
      const { createSession } = await import('wreq-js')
      const session = await createSession()
      await session.close()
      return `wreq-js ${installedVersion('wreq-js')}`
    }),

    await check('canvas', async () => {
      const { createCanvas } = await import('@napi-rs/canvas')
      const canvas = createCanvas(4, 4)
      const ctx = canvas.getContext('2d')
      ctx.fillStyle = '#f5c2e7'
      ctx.fillRect(0, 0, 4, 4)
      const png = canvas.toBuffer('image/png')
      if (png.subarray(1, 4).toString() !== 'PNG') throw new Error('PNG 编码结果不对')
      return `@napi-rs/canvas ${installedVersion('@napi-rs/canvas')}`
    }),

    await check('onnx', async () => {
      const ort = await import('onnxruntime-web')
      ort.env.wasm.numThreads = 1
      const session = await ort.InferenceSession.create(Buffer.from(ADD_MODEL, 'base64'))
      const input = (v: number[]) => new ort.Tensor('float32', Float32Array.from(v), [2])
      const { c } = await session.run({ a: input([1, 2]), b: input([3, 4]) })
      await session.release()
      const got = Array.from(c!.data as Float32Array).join()
      if (got !== '4,6') throw new Error(`推理结果不对：${got}`)
      return `onnxruntime-web ${installedVersion('onnxruntime-web')}（wasm）`
    }),

    await check('assets-jd', async () => {
      const name = '@cv-cat/catbus-assets-jd'
      const { models } = await import('@cv-cat/catbus-assets-jd').catch(() => {
        throw new Error(`没有安装 ${name}，请重新安装 catbus-cli`)
      })
      return await assetsMessage(name, models)
    }),

    await check('assets-ocr', async () => {
      const name = '@cv-cat/catbus-assets-ocr'
      const { models } = await import('@cv-cat/catbus-assets-ocr').catch(() => {
        throw new Error(`没有安装 ${name}，请重新安装 catbus-cli`)
      })
      return await assetsMessage(name, models)
    }),
  ]
}

/**
 * 验证码模型是可选能力：
 * - Web 镜像故意不带模型（体积小），整个 models 目录都不存在 → 算「未安装」，不算故障；
 * - 目录在、文件缺 → 真的坏了（构建/解压出错），必须报失败；
 * - 文件齐 → 正常。
 */
async function assetsMessage(name: string, models: Record<string, string>): Promise<string> {
  const files = Object.values(models)
  const missing: string[] = []
  for (const file of files) {
    const info = await stat(file).catch(() => null)
    if (!info?.size) missing.push(file)
  }
  if (!missing.length) return `${name} ${installedVersion(name)}`
  // 只有 Web 镜像（Dockerfile.web 设了 OMC_WEB_IMAGE=1）才把「没有模型」当可选；
  // CLI 镜像缺模型仍然算故障，否则京东/淘宝验证码会在运行时才炸。
  if (process.env.OMC_WEB_IMAGE === '1') {
    return `${name} ${installedVersion(name)}（未安装模型；Web 镜像不含，京东/淘宝验证码相关功能不可用）`
  }
  throw new Error(`模型文件缺失：${missing[0]}`)
}
