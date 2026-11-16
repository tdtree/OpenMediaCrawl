import type { CommentsState, ItemBody, ReusePolicy } from './types.js'

/**
 * 「这条还要不要真去请求平台」的判定。
 *
 * 纯函数：不碰数据库、不碰网络，输入是库里已有的状态，输出是四个 yes/no。
 * 采集任务和测试都只依赖它，改了策略不用跑真实账号。
 */

export interface ReuseSnapshot {
  /** 库里已有的作品；body 为 summary 表示只在搜索页见过。 */
  item: { body: ItemBody; fetchedAt: number } | null
  comments: CommentsState | null
  /** 已入库的媒体清单；null 表示还没算过。 */
  media: { total: number; ready: number } | null
}

export interface ReuseRequest {
  wantComments: boolean
  /** 需要楼中楼时，只有「全量」的评论才算够用。 */
  wantSubComments: boolean
  wantMedia: boolean
  /** 0 = 全量评论。 */
  maxComments: number
}

export interface ReuseDecision {
  /** 需要发一次 detail。 */
  fetchItem: boolean
  /** 需要发评论列表请求。 */
  fetchComments: boolean
  /** 需要下载媒体。 */
  downloadMedia: boolean
  /** 给日志用的中文原因，顺序与上面对应。 */
  reasons: string[]
}

export function decideReuse(
  snapshot: ReuseSnapshot,
  request: ReuseRequest,
  policy: ReusePolicy,
  now = Date.now(),
): ReuseDecision {
  const reasons: string[] = []

  // ---- 作品正文 ----
  let fetchItem = true
  if (snapshot.item && snapshot.item.body === 'full' && policy.reuseItems) {
    fetchItem = false
    reasons.push('作品已入库')
    if (policy.refresh === 'always') {
      fetchItem = true
      reasons[reasons.length - 1] = '要求强制刷新作品'
    } else if (policy.refresh === 'auto' && now - snapshot.item.fetchedAt > policy.itemTtlMs) {
      fetchItem = true
      reasons[reasons.length - 1] = '作品超过复用窗口，刷新一次'
    }
  } else if (!snapshot.item) {
    reasons.push('作品不在库')
  } else if (snapshot.item.body !== 'full') {
    reasons.push('库里只有搜索摘要')
  } else {
    reasons.push('关闭了作品复用')
  }

  // ---- 评论 ----
  let fetchComments = false
  if (request.wantComments) {
    const state = snapshot.comments
    if (!state) {
      fetchComments = true
      reasons.push('评论未采过')
    } else {
      // 一级评论够不够，和楼中楼是两件事：limit=0 表示一级全量，complete 还要看有没有翻完。
      const topEnough = state.complete || (request.maxComments > 0 && state.limit >= request.maxComments)
      const repliesEnough = !request.wantSubComments || state.withReplies
      const enough = topEnough && repliesEnough
      fetchComments = !enough || !policy.reuseComments
      if (!enough) reasons.push(repliesEnough ? '库里评论条数不够' : '库里没有楼中楼')
      else if (!policy.reuseComments) reasons.push('关闭了评论复用')
      else if (policy.refresh === 'always') {
        fetchComments = true
        reasons.push('要求强制刷新评论')
      } else if (policy.refresh === 'auto' && now - state.fetchedAt > policy.commentTtlMs) {
        fetchComments = true
        reasons.push('评论超过复用窗口')
      } else {
        reasons.push('评论可复用')
      }
    }
  }

  // ---- 媒体 ----
  let downloadMedia = false
  if (request.wantMedia) {
    const media = snapshot.media
    if (!media || media.total <= 0) {
      downloadMedia = false
    } else if (!policy.reuseMedia) {
      downloadMedia = true
      reasons.push('关闭了媒体复用')
    } else if (media.ready < media.total) {
      downloadMedia = true
      reasons.push(`媒体缺 ${media.total - media.ready}/${media.total}`)
    } else {
      reasons.push('媒体已齐')
    }
  }

  return { fetchItem, fetchComments, downloadMedia, reasons }
}

/** 媒体清单是否齐全：每一行都有 sha256 且 blob 文件还在。 */
export function mediaReady(rows: Array<{ sha256: string | null }>, exists: (sha: string) => boolean): number {
  return rows.filter((row) => row.sha256 && exists(row.sha256)).length
}
