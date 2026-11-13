import { describe, expect, it } from 'vitest'
import { summarize } from '../src/crawl/stats.js'
import type { StatInput } from '../src/crawl/stats.js'

/** 本地时间构造，避免 toISOString 的 UTC 偏移把用例写歪。 */
function local(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${year}-${pad(month)}-${pad(day)}T${pad(hour)}:${pad(minute)}:${pad(second)}`
}

function lead(platform: string, collectedAt: string, contacts: unknown[] = []): StatInput['leads'][number] {
  return { platform, collected_at: collectedAt, contacts }
}

const NOW = new Date(2026, 10, 12, 8, 0, 0) // 2026-11-12 08:00 本地时间

describe('summarize 空输入', () => {
  it('返回全 0 结构，趋势仍有 days 个 0', () => {
    const dash = summarize({ leads: [] }, { now: NOW, days: 7 })
    expect(dash).toEqual({
      total: 0,
      today: 0,
      contactHits: 0,
      runningTasks: 0,
      trend: ['2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12']
        .map((date) => ({ date, count: 0 })),
      platformShare: [],
    })
  })

  it('不传 days 时默认 14 天，最后一天是今天', () => {
    const dash = summarize({ leads: [] }, { now: NOW })
    expect(dash.trend).toHaveLength(14)
    expect(dash.trend.every((point) => point.count === 0)).toBe(true)
    expect(dash.trend.at(-1)!.date).toBe('2026-11-12')
    expect(dash.trend[0]!.date).toBe('2026-10-30')
  })

  it('缺省 tasks 时 runningTasks 为 0', () => {
    expect(summarize({ leads: [] }, { now: NOW }).runningTasks).toBe(0)
  })
})

describe('summarize 今日与跨天', () => {
  it('今日边界：00:00:00 与 23:59:59 都算今天，前一天 23:59:59 不算', () => {
    const dash = summarize({
      leads: [
        lead('douyin', local(2026, 11, 12, 0, 0, 0)),
        lead('douyin', local(2026, 11, 12, 23, 59, 59)),
        lead('douyin', local(2026, 11, 11, 23, 59, 59)),
      ],
    }, { now: NOW, days: 3 })

    expect(dash.total).toBe(3)
    expect(dash.today).toBe(2)
    expect(dash.trend).toEqual([
      { date: '2026-11-10', count: 0 },
      { date: '2026-11-11', count: 1 },
      { date: '2026-11-12', count: 2 },
    ])
  })

  it('now 就在 23:59:59 时，当天记录仍算今天', () => {
    const dash = summarize({ leads: [lead('xhs', local(2026, 11, 12, 23, 59, 59))] }, {
      now: new Date(2026, 10, 12, 23, 59, 59),
      days: 1,
    })
    expect(dash.today).toBe(1)
    expect(dash.trend).toEqual([{ date: '2026-11-12', count: 1 }])
  })

  it('按本地日期分桶，窗口外的记录只计总数', () => {
    const dash = summarize({
      leads: [
        lead('douyin', local(2026, 11, 12, 10, 0, 0)),
        lead('douyin', local(2026, 11, 9, 23, 59, 59)), // 窗口外
        lead('weibo', '2026-11-12T23:30:00+08:00'),     // 东八区仍是 12 号
      ],
    }, { now: NOW, days: 3 })

    expect(dash.total).toBe(3)
    expect(dash.today).toBe(2)
    expect(dash.trend.map((point) => point.count)).toEqual([0, 0, 2])
  })
})

describe('summarize 平台占比', () => {
  it('按条数降序，percent 保留一位小数', () => {
    const dash = summarize({
      leads: [
        lead('douyin', local(2026, 11, 12)),
        lead('douyin', local(2026, 11, 12)),
        lead('douyin', local(2026, 11, 11)),
        lead('xiaohongshu', local(2026, 11, 12)),
        lead('weibo', local(2026, 11, 10)),
      ],
    }, { now: NOW })

    expect(dash.platformShare).toEqual([
      { platform: 'douyin', count: 3, percent: 60 },
      { platform: 'weibo', count: 1, percent: 20 },
      { platform: 'xiaohongshu', count: 1, percent: 20 },
    ])
  })

  it('同条数按平台名升序，结果稳定可复现', () => {
    const dash = summarize({
      leads: [lead('weibo', local(2026, 11, 12)), lead('douyin', local(2026, 11, 12)), lead('xhs', local(2026, 11, 12))],
    }, { now: NOW })
    expect(dash.platformShare.map((row) => row.platform)).toEqual(['douyin', 'weibo', 'xhs'])
  })

  it('百分比合计永远不超过 100.1，且都是一位小数', () => {
    // 6 个平台各 1 条：朴素四舍五入会得到 16.7×6 = 100.2，必须被压回 100.1 以内。
    const even = summarize({
      leads: ['a', 'b', 'c', 'd', 'e', 'f'].map((platform) => lead(platform, local(2026, 11, 12))),
    }, { now: NOW })
    const evenSum = even.platformShare.reduce((sum, row) => sum + row.percent, 0)
    expect(even.platformShare).toHaveLength(6)
    expect(evenSum).toBeLessThanOrEqual(100.1)
    for (const row of even.platformShare) {
      expect(Number.isInteger(Math.round(row.percent * 10))).toBe(true)
      expect(row.percent).toBeCloseTo(Math.round(row.percent * 10) / 10, 10)
    }

    const three = summarize({
      leads: [lead('a', local(2026, 11, 12)), lead('b', local(2026, 11, 12)), lead('c', local(2026, 11, 12))],
    }, { now: NOW })
    expect(three.platformShare.reduce((sum, row) => sum + row.percent, 0)).toBeLessThanOrEqual(100.1)
  })

  it('占比不受日期好坏影响，坏日期的线索也计入平台条数', () => {
    const dash = summarize({
      leads: [lead('douyin', 'not-a-date'), lead('douyin', local(2026, 11, 12))],
    }, { now: NOW })
    expect(dash.platformShare).toEqual([{ platform: 'douyin', count: 2, percent: 100 }])
  })
})

describe('summarize 任务与联系人', () => {
  it('running/pending 计入，其余不计', () => {
    const dash = summarize({
      leads: [],
      tasks: [{ status: 'running' }, { status: 'pending' }, { status: 'done' }, { status: 'failed' }, { status: 'running' }],
    }, { now: NOW })
    expect(dash.runningTasks).toBe(3)
  })

  it('contactHits 只数 contacts 非空的线索', () => {
    const dash = summarize({
      leads: [
        lead('douyin', local(2026, 11, 12), [{ type: 'wechat', value: 'a' }]),
        lead('douyin', local(2026, 11, 12), []),
        lead('douyin', local(2026, 11, 12), ['x', 'y']),
      ],
    }, { now: NOW })
    expect(dash.contactHits).toBe(2)
    expect(dash.total).toBe(3)
  })
})

describe('summarize 坏日期容错', () => {
  it('解析失败的 collected_at 既不算今天也不进趋势，但仍计入 total', () => {
    const bad = ['not-a-date', '', '2026-13-45T99:00:00', '昨天下午']
    const dash = summarize({
      leads: [
        ...bad.map((value) => lead('douyin', value)),
        lead('xiaohongshu', local(2026, 11, 12, 9, 30, 0)),
      ],
    }, { now: NOW, days: 3 })

    expect(dash.total).toBe(5)
    expect(dash.today).toBe(1)
    expect(dash.trend.map((point) => point.count)).toEqual([0, 0, 1])
    expect(dash.platformShare).toEqual([
      { platform: 'douyin', count: 4, percent: 80 },
      { platform: 'xiaohongshu', count: 1, percent: 20 },
    ])
  })
})
