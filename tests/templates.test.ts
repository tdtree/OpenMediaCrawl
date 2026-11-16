import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { TEMPLATE_LIMIT, deleteTemplate, listTemplates, saveTemplate } from '../src/crawl/templates.js'

const dirs: string[] = []
async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omc-templates-'))
  dirs.push(dir)
  return dir
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

describe('话术模板', () => {
  it('新建、列出、按 id 更新', async () => {
    const root = await tempDir()
    expect(await listTemplates(root)).toEqual([])
    const first = await saveTemplate(root, { name: '宝妈-低价款', text: '宝妈看这里，39 元两件' })
    expect(first.created).toBe(true)
    expect(first.template.name).toBe('宝妈-低价款')
    const second = await saveTemplate(root, { name: '批发-量大', text: '一件代发，量大从优' })
    expect((await listTemplates(root)).map((item) => item.name)).toEqual(['宝妈-低价款', '批发-量大'])
    const updated = await saveTemplate(root, { id: first.template.id, name: '宝妈-高价', text: '宝妈看这里，升级款' })
    expect(updated.created).toBe(false)
    expect(updated.template.id).toBe(first.template.id)
    const items = await listTemplates(root)
    expect(items.find((item) => item.id === second.template.id)?.text).toBe('一件代发，量大从优')
    expect(items.find((item) => item.id === first.template.id)).toMatchObject({ name: '宝妈-高价', text: '宝妈看这里，升级款' })
  })

  it('同名直接覆盖，不会存出两套', async () => {
    const root = await tempDir()
    await saveTemplate(root, { name: '老客户', text: '老客户复购价' })
    const again = await saveTemplate(root, { name: '老客户', text: '老客户复购价，再送一份' })
    expect(again.created).toBe(false)
    const items = await listTemplates(root)
    expect(items).toHaveLength(1)
    expect(items[0]!.text).toBe('老客户复购价，再送一份')
  })

  it('校验名称和内容', async () => {
    const root = await tempDir()
    await expect(saveTemplate(root, { name: '  ', text: '内容' })).rejects.toThrow('话术名称不能为空')
    await expect(saveTemplate(root, { name: '空内容', text: '   ' })).rejects.toThrow('话术内容不能为空')
    await expect(saveTemplate(root, { name: 'x'.repeat(41), text: '内容' })).rejects.toThrow('最多 40 字')
    await expect(saveTemplate(root, { name: '长内容', text: 'x'.repeat(501) })).rejects.toThrow('最多 500 字')
    await expect(saveTemplate(root, { id: 'missing', name: '不存在', text: '内容' })).rejects.toThrow('不存在')
  })

  it('最多 50 套，删除后腾位置', async () => {
    const root = await tempDir()
    for (let i = 0; i < TEMPLATE_LIMIT; i++) await saveTemplate(root, { name: `模板-${i}`, text: `内容-${i}` })
    await expect(saveTemplate(root, { name: '超了', text: '内容' })).rejects.toThrow('最多存 50 套')
    const first = (await listTemplates(root))[0]!
    expect(await deleteTemplate(root, first.id)).toBe(true)
    expect(await deleteTemplate(root, first.id)).toBe(false)
    expect((await saveTemplate(root, { name: '删完再加', text: '内容' })).created).toBe(true)
  })

  it('按用户分文件，互不可见', async () => {
    const alice = await tempDir()
    const bob = await tempDir()
    await saveTemplate(alice, { name: 'A 的话术', text: 'A' })
    expect(await listTemplates(bob)).toEqual([])
  })
})
