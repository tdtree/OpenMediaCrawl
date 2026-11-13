/**
 * 仪表盘聚合：把线索列表和任务列表折算成首页要展示的几个数字。
 * 纯函数，不碰文件系统、不碰网络、不改入参；时间一律按「本地日期」分桶，
 * 这样用户在东八区看到的就是自己那天的数据。
 */

export interface StatInput {
  leads: Array<{ platform: string; collected_at: string; contacts: unknown[] }>
  tasks?: Array<{ status: string }>
}

export interface Dashboard {
  total: number
  today: number
  contactHits: number
  runningTasks: number
  trend: Array<{ date: string; count: number }> // 近 N 天（默认 14），缺失日为 0
  platformShare: Array<{ platform: string; count: number; percent: number }>
}

/** 趋势窗口默认天数。 */
const DEFAULT_DAYS = 14

/**
 * 百分比合计的上限，单位是 0.1%。
 * 卡在 100.0 而不是 100.1：0.1 这类小数相加在浮点里会飘成 100.10000000000001，
 * 留出余量后，调用方怎么写求和都不会越过 100.1 这条线。
 */
const PERCENT_CAP_TENTHS = 1000

/** 视为「还在跑」的任务状态。 */
const RUNNING_STATUS: ReadonlySet<string> = new Set(['running', 'pending'])

/** 本地日期键：YYYY-MM-DD（不能用 toISOString，那是 UTC，会整体差 8 小时）。 */
function dayKey(date: Date): string {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

/** 把 collected_at 解析成本地日期键；解析不出来返回 null（脏数据直接跳过，不让一条坏记录拖垮整个仪表盘）。 */
function parseDayKey(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number' && !(value instanceof Date)) return null
  const date = value instanceof Date ? value : new Date(value)
  const time = date.getTime()
  if (!Number.isFinite(time)) return null
  return dayKey(date)
}

/** 归一化天数：非法值退回默认值，负数/小数收敛成非负整数。 */
function normalizeDays(days: number | undefined): number {
  if (typeof days !== 'number' || !Number.isFinite(days)) return DEFAULT_DAYS
  return Math.max(0, Math.floor(days))
}

/** 从 now 所在本地日往前取 days 天（含今天），返回升序的日期键，最后一项是今天。 */
function lastDays(now: Date, days: number): string[] {
  // 先落到本地零点，再按「日」加减：setDate 会跟着夏令时/月末自动进位，不会算错。
  const anchor = new Date(now.getFullYear(), now.getMonth(), now.getDate())
  const dates: string[] = []
  for (let offset = days - 1; offset >= 0; offset--) {
    const cursor = new Date(anchor)
    cursor.setDate(anchor.getDate() - offset)
    dates.push(dayKey(cursor))
  }
  return dates
}

/**
 * 平台占比：按条数降序（同数按平台名升序，保证结果稳定），
 * percent 保留一位小数；四舍五入后合计若超过 100%，从占比最大的开始逐个扣 0.1%，
 * 免得图表上出现「加起来 101%」这种尴尬。
 */
function shareOf(counts: Map<string, number>, total: number): Dashboard['platformShare'] {
  const rows = [...counts.entries()]
    .map(([platform, count]) => ({ platform, count }))
    .sort((a, b) => b.count - a.count || a.platform.localeCompare(b.platform))
  if (total <= 0 || rows.length === 0) return rows.map((row) => ({ ...row, percent: 0 }))

  // 用「千分比」整数运算，避免浮点相加出现 100.20000000000002 这种尾巴。
  const tenths = rows.map((row) => Math.round((row.count / total) * 1000))
  let overflow = tenths.reduce((sum, value) => sum + value, 0) - PERCENT_CAP_TENTHS
  if (overflow > 0) {
    const order = tenths.map((_, index) => index).sort((a, b) => tenths[b]! - tenths[a]!)
    while (overflow > 0) {
      let trimmed = false
      for (const index of order) {
        if (overflow <= 0) break
        if (tenths[index]! <= 0) continue
        tenths[index]! -= 1
        overflow -= 1
        trimmed = true
      }
      if (!trimmed) break // 全被扣到 0 了，兜底退出
    }
  }
  return rows.map((row, index) => ({ ...row, percent: tenths[index]! / 10 }))
}

/** 仪表盘汇总。options.now 便于测试注入固定时间，options.days 控制趋势窗口长度。 */
export function summarize(input: StatInput, options: { now?: Date; days?: number } = {}): Dashboard {
  const now = options.now ?? new Date()
  const days = normalizeDays(options.days)
  const leads = input.leads ?? []
  const tasks = input.tasks ?? []

  const todayKey = dayKey(now)
  const trendDates = lastDays(now, days)
  // 先铺满整条时间轴，缺失日天然就是 0。
  const buckets = new Map<string, number>(trendDates.map((date) => [date, 0]))
  const platformCounts = new Map<string, number>()

  let today = 0
  let contactHits = 0

  for (const lead of leads) {
    if (Array.isArray(lead.contacts) && lead.contacts.length > 0) contactHits++

    const platform = lead.platform || 'unknown'
    platformCounts.set(platform, (platformCounts.get(platform) ?? 0) + 1)

    // 日期解析失败的线索只计入总数和平台占比，不进「今日」和趋势。
    const key = parseDayKey(lead.collected_at)
    if (!key) continue
    if (key === todayKey) today++
    const bucket = buckets.get(key)
    if (bucket !== undefined) buckets.set(key, bucket + 1)
  }

  let runningTasks = 0
  for (const task of tasks) {
    if (RUNNING_STATUS.has(task.status)) runningTasks++
  }

  return {
    total: leads.length,
    today,
    contactHits,
    runningTasks,
    trend: trendDates.map((date) => ({ date, count: buckets.get(date) ?? 0 })),
    platformShare: shareOf(platformCounts, leads.length),
  }
}
