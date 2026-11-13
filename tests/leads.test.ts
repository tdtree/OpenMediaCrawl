import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { buildLeads, extractContacts, LeadStore, matchIntent, toCsv, type Contact, type Lead } from '../src/crawl/leads.js'

const dirs: string[] = []
async function tempFile(name = 'leads.jsonl'): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'omc-leads-'))
  dirs.push(dir)
  return join(dir, name)
}
afterEach(async () => {
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
})

const phone = (value: string): Contact => ({ type: 'phone', value })
const wechat = (value: string): Contact => ({ type: 'wechat', value })
const qq = (value: string): Contact => ({ type: 'qq', value })

function makeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: 'xhs:c1',
    platform: 'xhs',
    comment_id: 'c1',
    item_id: 'i1',
    item_title: '测试作品',
    item_url: 'https://example.com/i1',
    author_id: 'u1',
    author_name: '小明',
    text: '多少钱？',
    created_at: '2026-11-01T10:00:00+08:00',
    province: '广东',
    matched: [],
    contacts: [],
    collected_at: '2026-11-02T10:00:00+08:00',
    ...overrides,
  }
}

// ---- extractContacts ----

const HIT_CASES: Array<[string, string, Contact[]]> = [
  ['11 位手机号紧跟中文', '电话13812345678', [phone('13812345678')]],
  ['短横线分隔的手机号', '手机 138-1234-5678', [phone('13812345678')]],
  ['空格分隔的手机号', '138 1234 5678', [phone('13812345678')]],
  ['全角数字手机号', '１３８１２３４５６７８', [phone('13812345678')]],
  ['中文数字手机号', '一三八零零一二三四五六', [phone('13800123456')]],
  ['中文数字 + 分隔的手机号', '电话 一三九 一二三四 五六七八', [phone('13912345678')]],
  ['中文数字 + 短横线', '联系方式：一五九-一二三四-五六七八', [phone('15912345678')]],
  ['带国际区号', '+86 13812345678', [phone('13812345678')]],
  ['带 tel 前缀', 'tel:13912345678，欢迎来电', [phone('13912345678')]],
  ['17 号段', '17712345678', [phone('17712345678')]],
  ['15 号段 + 微信同号', '150-1234-5678 微信同号', [phone('15012345678')]],
  ['19 号段', '19912345678', [phone('19912345678')]],
  ['冒号后紧跟手机号', '联系方式：15912345678', [phone('15912345678')]],
  ['微信 + 冒号', '微信: abc_1234', [wechat('abc_1234')]],
  ['微信直接跟账号', '微信abc1234', [wechat('abc1234')]],
  ['加微信 + 全角冒号', '加微信：zhang_san-88', [wechat('zhang_san-88')]],
  ['wx 前缀', 'wx: hello123', [wechat('hello123')]],
  ['大写 WX 前缀', 'WX：Hello_World1', [wechat('Hello_World1')]],
  ['vx 前缀', 'vx abcdef', [wechat('abcdef')]],
  ['vx 是', '我vx是Abc_1234，加我', [wechat('Abc_1234')]],
  ['微信号是', '微信号是 kf_8888', [wechat('kf_8888')]],
  ['v 前缀', 'v: my_wechat', [wechat('my_wechat')]],
  ['大写 V 前缀', 'V：Abc12345', [wechat('Abc12345')]],
  ['vx 带全角冒号', '加我 vx：Abc_8888', [wechat('Abc_8888')]],
  ['weixin 前缀', 'weixin: test_2026', [wechat('test_2026')]],
  ['WeChat 前缀', 'WeChat: shop01', [wechat('shop01')]],
  ['微信号', '微信号：kf_8888', [wechat('kf_8888')]],
  ['薇信变体', '薇信：abcde1', [wechat('abcde1')]],
  ['qq 小写', 'qq 123456789', [qq('123456789')]],
  ['QQ 大写 + 冒号', 'QQ:123456', [qq('123456')]],
  ['加我qq', '加我qq 987654321', [qq('987654321')]],
  ['扣扣变体', '扣扣 12345678', [qq('12345678')]],
  ['企鹅变体', '企鹅 1234567890', [qq('1234567890')]],
  ['qq 是', '我的qq是 55667788', [qq('55667788')]],
  ['qq 号', 'qq号 1234567', [qq('1234567')]],
  ['qq 和数字之间隔几个字', 'qq 联系我 123456', [qq('123456')]],
  ['多种联系方式按出现顺序', '电话13812345678 微信: abc1234 qq 123456789', [
    phone('13812345678'), wechat('abc1234'), qq('123456789'),
  ]],
  ['同一手机号只留一次', '13812345678 或 138 1234 5678', [phone('13812345678')]],
  ['qq 号写成手机号时归 qq', 'qq:13812345678', [qq('13812345678')]],
  ['手机号和微信号共存', '13812345678 同微信 abcd1234', [phone('13812345678'), wechat('abcd1234')]],
  ['微信同号后面跟手机号', '微信同号13812345678', [phone('13812345678')]],
]

describe('extractContacts：能认出来的写法', () => {
  for (const [name, text, expected] of HIT_CASES) {
    it(name, () => expect(extractContacts(text)).toEqual(expected))
  }
})

describe('extractContacts：噪声不要误报', () => {
  const MISS_CASES: Array<[string, string]> = [
    ['订单号不是手机号', '订单号13812345678'],
    ['运单号带横线', '运单号 138-1234-5678'],
    ['已脱敏手机号', '138****1234'],
    ['纯日期', '2026-10-10'],
    ['10 位数字', '1381234567'],
    ['12 位数字', '138123456789'],
    ['不是 1 开头的 11 位数字', '23812345678'],
    ['微信号太短', '微信: ab1'],
    ['微信号超过 30 位', `微信: ${'a'.repeat(32)}`],
    ['微信后面是中文', '微信联系我'],
    ['普通文本', '这个多少钱？'],
    ['wwid 不算 wx', 'wxid_abcdefg'],
    ['数字串太短不算 QQ', 'qq 123'],
  ]
  for (const [name, text] of MISS_CASES) {
    it(name, () => expect(extractContacts(text)).toEqual([]))
  }
})

// ---- matchIntent ----

describe('matchIntent', () => {
  it('命中的词按传入顺序返回', () => {
    expect(matchIntent('想代理，能报价吗', ['报价', '代理', '加盟'])).toEqual(['报价', '代理'])
  })

  it('不区分大小写，返回原词', () => {
    expect(matchIntent('VIP 客户价', ['vip'])).toEqual(['vip'])
    expect(matchIntent('vip 客户价', ['VIP'])).toEqual(['VIP'])
  })

  it('传入的词去重', () => {
    expect(matchIntent('求报价', ['报价', '报价', ' 报价 '])).toEqual(['报价'])
  })

  it('没填意向词返回空数组', () => {
    expect(matchIntent('求报价', [])).toEqual([])
  })

  it('没命中返回空数组', () => {
    expect(matchIntent('路过看看', ['报价'])).toEqual([])
  })
})

// ---- buildLeads ----

const ITEMS = [
  { id: 'i1', title: '秋装外套', url: 'https://example.com/i1' },
  { id: 'i2', title: '冬装羽绒服', url: null },
]

const COMMENTS = [
  { id: 'c1', item_id: 'i1', parent_id: null, author: { id: 'u1', name: '小明' }, text: '多少钱？想批发 13812345678', created_at: '2026-11-01T10:00:00+08:00', province: '广东' },
  { id: 'c2', item_id: 'i1', parent_id: null, author: { id: 'u2', name: '小红' }, text: '好看', created_at: '2026-11-01T11:00:00+08:00', province: '浙江' },
  { id: 'c3', item_id: 'i2', parent_id: 'c2', author: null, text: '求代理，微信 abc1234', created_at: null, province: null },
  { id: 'c4', item_id: 'i9', parent_id: null, text: '支持一件代发', province: '广东' },
]

describe('buildLeads', () => {
  it('不填过滤条件时全留，并按 comment_id 去重', () => {
    const leads = buildLeads({ platform: 'xhs', items: ITEMS, comments: [...COMMENTS, COMMENTS[0]] })
    expect(leads.map((lead) => lead.comment_id)).toEqual(['c1', 'c2', 'c3', 'c4'])
  })

  it('id 用 平台:评论 id，作品信息按 item_id 关联', () => {
    const leads = buildLeads({ platform: 'xhs', items: ITEMS, comments: COMMENTS })
    expect(leads[0].id).toBe('xhs:c1')
    expect(leads[0].item_title).toBe('秋装外套')
    expect(leads[0].item_url).toBe('https://example.com/i1')
    expect(leads[1].item_title).toBe('秋装外套')
    expect(leads[2].item_url).toBeNull()
    // 作品没在 items 里：标题、链接留空，不编造
    expect(leads[3].item_title).toBeNull()
    expect(leads[3].item_url).toBeNull()
  })

  it('作者、地域、命中词、联系方式都带出来', () => {
    const leads = buildLeads({ platform: 'xhs', items: ITEMS, comments: COMMENTS })
    expect(leads[0].author_id).toBe('u1')
    expect(leads[0].author_name).toBe('小明')
    expect(leads[0].province).toBe('广东')
    expect(leads[0].contacts).toEqual([phone('13812345678')])
    expect(leads[2].author_id).toBeNull()
    expect(leads[2].province).toBeNull()
  })

  it('按省份过滤，省份为空的评论不算命中', () => {
    const leads = buildLeads({ platform: 'xhs', items: ITEMS, comments: COMMENTS, provinces: ['广东'] })
    expect(leads.map((lead) => lead.comment_id)).toEqual(['c1', 'c4'])
  })

  it('按意向词过滤，并在 matched 里留下命中的词', () => {
    const leads = buildLeads({ platform: 'xhs', items: ITEMS, comments: COMMENTS, intent: ['代理', '批发'] })
    expect(leads.map((lead) => lead.comment_id)).toEqual(['c1', 'c3'])
    expect(leads[0].matched).toEqual(['批发'])
    expect(leads[1].matched).toEqual(['代理'])
  })

  it('没填意向词时 matched 是空数组（不是全部命中）', () => {
    const leads = buildLeads({ platform: 'xhs', items: ITEMS, comments: COMMENTS })
    expect(leads.every((lead) => lead.matched.length === 0)).toBe(true)
  })

  it('意向词 + 省份同时生效', () => {
    const leads = buildLeads({ platform: 'xhs', items: ITEMS, comments: COMMENTS, intent: ['代理'], provinces: ['广东'] })
    expect(leads).toEqual([])
  })

  it('collected_at 默认当前时间，也可以指定', () => {
    const now = buildLeads({ platform: 'xhs', items: ITEMS, comments: COMMENTS })
    expect(now[0].collected_at).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/)
    const fixed = buildLeads({ platform: 'xhs', items: ITEMS, comments: COMMENTS, collected_at: '2026-11-12T00:00:00+08:00' })
    expect(fixed[0].collected_at).toBe('2026-11-12T00:00:00+08:00')
  })
})

// ---- toCsv ----

describe('toCsv', () => {
  it('带 BOM、固定表头、CRLF', () => {
    const csv = toCsv([makeLead()])
    expect(csv.startsWith('\ufeff')).toBe(true)
    const lines = csv.slice(1).split('\r\n')
    expect(lines[0]).toBe('平台,评论者,评论内容,联系方式,地域,命中词,评论时间,作品标题,作品链接,评论者ID,采集时间')
    expect(lines[1]).toBe('xhs,小明,多少钱？,,广东,,2026-11-01T10:00:00+08:00,测试作品,https://example.com/i1,u1,2026-11-02T10:00:00+08:00')
    expect(csv.endsWith('\r\n')).toBe(true)
  })

  it('逗号、引号、换行按 RFC 4180 转义', () => {
    const csv = toCsv([makeLead({ text: '他说,"贵"了\n再便宜点', author_name: 'A,B' })])
    expect(csv).toContain('"A,B"')
    expect(csv).toContain('"他说,""贵""了\n再便宜点"')
  })

  it('联系方式用 类型:值 拼接', () => {
    const csv = toCsv([makeLead({ contacts: [phone('13812345678'), wechat('abc1234'), qq('123456789')] })])
    expect(csv).toContain('phone:13812345678;wechat:abc1234;qq:123456789')
  })

  it('mask 时手机号保留前 3 后 4，微信 / QQ 打中间', () => {
    const csv = toCsv([makeLead({ contacts: [phone('13812345678'), wechat('abc1234'), qq('123456')] })], { mask: true })
    expect(csv).toContain('phone:138****5678')
    expect(csv).toContain('wechat:ab***34')
    expect(csv).toContain('qq:12**56')
  })

  it('长度不超过 5 的账号不遮', () => {
    const csv = toCsv([makeLead({ contacts: [wechat('abc12'), qq('12345')] })], { mask: true })
    expect(csv).toContain('wechat:abc12;qq:12345')
  })

  it('空数组只有表头', () => {
    expect(toCsv([])).toBe(
      '\ufeff平台,评论者,评论内容,联系方式,地域,命中词,评论时间,作品标题,作品链接,评论者ID,采集时间\r\n',
    )
  })
})

// ---- LeadStore ----

describe('LeadStore', () => {
  it('文件不存在时 load 返回空数组', async () => {
    const store = new LeadStore(await tempFile())
    expect(await store.load()).toEqual([])
  })

  it('upsert 按 id 去重，返回新增条数', async () => {
    const file = await tempFile()
    const store = new LeadStore(file)
    const first = await store.upsert([makeLead(), makeLead({ id: 'xhs:c2', comment_id: 'c2' })])
    expect(first).toEqual({ added: 2, total: 2 })

    const second = await store.upsert([makeLead({ text: '更新后的内容' }), makeLead({ id: 'xhs:c3', comment_id: 'c3' })])
    expect(second).toEqual({ added: 1, total: 3 })

    const leads = await store.load()
    expect(leads).toHaveLength(3)
    expect(leads.find((lead) => lead.id === 'xhs:c1')?.text).toBe('更新后的内容')
    // 一行一个 Lead
    expect((await readFile(file, 'utf8')).trim().split('\n')).toHaveLength(3)
  })

  it('load 跳过坏行', async () => {
    const file = await tempFile()
    const good = JSON.stringify(makeLead())
    await writeFile(file, [
      good,
      '',
      '   ',
      '{坏行',
      'null',
      '"字符串"',
      JSON.stringify({ id: 'xhs:c9' }),
      `${JSON.stringify(makeLead({ id: 'xhs:c2', comment_id: 'c2' }))}\r`,
    ].join('\n'), 'utf8')
    const leads = await new LeadStore(file).load()
    expect(leads.map((lead) => lead.id).sort()).toEqual(['xhs:c1', 'xhs:c2'])
  })

  it('load 补齐缺失字段', async () => {
    const file = await tempFile()
    await writeFile(file, `${JSON.stringify({ id: 'xhs:c1', platform: 'xhs', comment_id: 'c1', text: 'hi' })}\n`, 'utf8')
    const [lead] = await new LeadStore(file).load()
    expect(lead).toMatchObject({
      id: 'xhs:c1',
      item_id: '',
      item_title: null,
      matched: [],
      contacts: [],
      province: null,
    })
    expect(typeof lead.collected_at).toBe('string')
  })

  it('query 按平台 / 关键词 / 省份 / 有无联系方式过滤', async () => {
    const store = new LeadStore(await tempFile())
    await store.upsert([
      makeLead({ id: 'xhs:c1', comment_id: 'c1', text: '想批发，多少钱', author_name: '小明', contacts: [phone('13812345678')] }),
      makeLead({ id: 'xhs:c2', comment_id: 'c2', platform: 'xhs', text: '好看', author_name: 'Alice', province: '浙江', contacts: [] }),
      makeLead({ id: 'dy:c3', comment_id: 'c3', platform: 'dy', text: '求代理', author_name: '小红', province: '浙江', contacts: [] }),
    ])

    expect((await store.query({ platform: 'dy' })).items.map((lead) => lead.id)).toEqual(['dy:c3'])
    expect((await store.query({ q: '批发' })).items.map((lead) => lead.id)).toEqual(['xhs:c1'])
    expect((await store.query({ q: 'alice' })).items.map((lead) => lead.id)).toEqual(['xhs:c2'])
    expect((await store.query({ province: '浙江' })).total).toBe(2)
    expect((await store.query({ hasContact: true })).items.map((lead) => lead.id)).toEqual(['xhs:c1'])
    expect((await store.query({ hasContact: false })).total).toBe(2)
    // 多关键词：空格或 / 分隔，命中任意一个即可
    expect((await store.query({ q: '批发 代理' })).items.map((lead) => lead.id).sort()).toEqual(['dy:c3', 'xhs:c1'])
    expect((await store.query({ q: '代理/Alice' })).items.map((lead) => lead.id).sort()).toEqual(['dy:c3', 'xhs:c2'])
    expect((await store.query({ q: '批发 / 不存在' })).items.map((lead) => lead.id)).toEqual(['xhs:c1'])
    expect((await store.query({ q: '不存在' })).total).toBe(0)
  })

  it('query 按时间范围过滤，时间为空的排除', async () => {
    const store = new LeadStore(await tempFile())
    await store.upsert([
      makeLead({ id: 'xhs:c1', comment_id: 'c1', created_at: '2026-09-01T00:00:00+08:00' }),
      makeLead({ id: 'xhs:c2', comment_id: 'c2', created_at: '2026-10-01T00:00:00+08:00' }),
      makeLead({ id: 'xhs:c3', comment_id: 'c3', created_at: null }),
    ])
    expect((await store.query({ from: '2026-09-15' })).items.map((lead) => lead.id)).toEqual(['xhs:c2'])
    expect((await store.query({ to: '2026-09-15' })).items.map((lead) => lead.id)).toEqual(['xhs:c1'])
    expect((await store.query({ from: '2026-08-01', to: '2026-12-01' })).total).toBe(2)
  })

  it('query 新的在前，支持分页', async () => {
    const store = new LeadStore(await tempFile())
    await store.upsert([
      makeLead({ id: 'xhs:c1', comment_id: 'c1', created_at: '2026-10-01T00:00:00+08:00' }),
      makeLead({ id: 'xhs:c2', comment_id: 'c2', created_at: '2026-10-03T00:00:00+08:00' }),
      makeLead({ id: 'xhs:c3', comment_id: 'c3', created_at: '2026-10-02T00:00:00+08:00' }),
    ])
    expect((await store.query()).items.map((lead) => lead.id)).toEqual(['xhs:c2', 'xhs:c3', 'xhs:c1'])
    const page = await store.query({ limit: 1, offset: 1 })
    expect(page.items.map((lead) => lead.id)).toEqual(['xhs:c3'])
    expect(page.total).toBe(3)
  })

  it('query 默认 limit 50，上限 500', async () => {
    const store = new LeadStore(await tempFile())
    const many: Lead[] = Array.from({ length: 505 }, (_, i) =>
      makeLead({ id: `xhs:c${i}`, comment_id: `c${i}`, created_at: `2026-10-01T00:${String(i % 60).padStart(2, '0')}:00+08:00` }),
    )
    await store.upsert(many)
    expect((await store.query()).items).toHaveLength(50)
    expect((await store.query()).total).toBe(505)
    expect((await store.query({ limit: 9999 })).items).toHaveLength(500)
  })

  it('clear 清空文件', async () => {
    const file = await tempFile()
    const store = new LeadStore(file)
    await store.upsert([makeLead()])
    await store.clear()
    expect(await store.load()).toEqual([])
    expect(await readFile(file, 'utf8')).toBe('')
  })
})
