import { randomUUID } from 'node:crypto'
import { join } from 'node:path'
import { readTextIfExists, writeFileAtomic } from '../core/fsutil.js'
import { CatbusError } from '../core/errors.js'

/**
 * 群发话术模板：按用户存多套文案，发之前挑一套最合适的。
 * 模板只是「预填内容」，群发时真正发出去的还是当时表单里的文案。
 */
export interface MessageTemplate {
  id: string
  name: string
  text: string
  updatedAt: string
}

interface File {
  version: number
  items: MessageTemplate[]
}

export const TEMPLATE_NAME_MAX = 40
export const TEMPLATE_TEXT_MAX = 500
export const TEMPLATE_LIMIT = 50

const file = (root: string) => join(root, 'message-templates.json')

export async function listTemplates(root: string): Promise<MessageTemplate[]> {
  const raw = await readTextIfExists(file(root))
  if (!raw) return []
  try {
    const parsed = JSON.parse(raw) as Partial<File>
    return Array.isArray(parsed.items) ? parsed.items : []
  } catch {
    throw new CatbusError('ERROR', '话术模板文件损坏，可以先删掉 message-templates.json', { hint: file(root) })
  }
}

async function save(root: string, items: MessageTemplate[]): Promise<void> {
  await writeFileAtomic(file(root), JSON.stringify({ version: 1, items }, null, 2) + '\n')
}

function cleanName(name: string): string {
  const value = name.trim().replace(/\s+/g, ' ')
  if (!value) throw new CatbusError('USAGE', '话术名称不能为空')
  if (value.length > TEMPLATE_NAME_MAX) throw new CatbusError('USAGE', `话术名称最多 ${TEMPLATE_NAME_MAX} 字`)
  return value
}

function cleanText(text: string): string {
  const value = text.trim()
  if (!value) throw new CatbusError('USAGE', '话术内容不能为空')
  if (value.length > TEMPLATE_TEXT_MAX) throw new CatbusError('USAGE', `话术内容最多 ${TEMPLATE_TEXT_MAX} 字`)
  return value
}

/** 新建或更新；不带 id 时同名的会覆盖（避免存出两个「宝妈-低价」）。 */
export async function saveTemplate(
  root: string,
  input: { id?: string; name: string; text: string },
): Promise<{ template: MessageTemplate; created: boolean }> {
  const items = await listTemplates(root)
  const name = cleanName(input.name)
  const text = cleanText(input.text)
  const now = new Date().toISOString()
  const id = input.id?.trim() || ''
  const index = id ? items.findIndex((item) => item.id === id) : items.findIndex((item) => item.name === name)
  if (id && index < 0) throw new CatbusError('USAGE', '话术不存在，可能已经被删了')
  let created = false
  if (index < 0) {
    if (items.length >= TEMPLATE_LIMIT) throw new CatbusError('USAGE', `最多存 ${TEMPLATE_LIMIT} 套话术，先删几套不用的`)
    items.push({ id: randomUUID(), name, text, updatedAt: now })
    created = true
  } else {
    items[index] = { ...items[index]!, name, text, updatedAt: now }
  }
  await save(root, items)
  return { template: items[created ? items.length - 1 : index]!, created }
}

export async function deleteTemplate(root: string, id: string): Promise<boolean> {
  if (!id) return false
  const items = await listTemplates(root)
  const next = items.filter((item) => item.id !== id)
  if (next.length === items.length) return false
  await save(root, next)
  return true
}
