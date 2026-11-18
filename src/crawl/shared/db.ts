import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'

/**
 * 共享内容库的库文件与表结构。
 *
 * 一个库放三样东西：内容（items/comments/creators）、媒体清单与字节、以及「谁采到过什么」（refs）。
 * 内容按 (platform, id) 唯一；refs 才是按用户区分的部分。
 */

export const DB_FILE = 'content.sqlite'

const SCHEMA = `
PRAGMA journal_mode = WAL;
PRAGMA synchronous = NORMAL;
PRAGMA busy_timeout = 5000;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT OR IGNORE INTO meta(key, value) VALUES ('version', '0');
INSERT OR IGNORE INTO meta(key, value) VALUES ('schema', '1');

CREATE TABLE IF NOT EXISTS items (
  platform TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  body TEXT NOT NULL,
  hash TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  seen_at INTEGER NOT NULL,
  source_user TEXT,
  source_account TEXT,
  PRIMARY KEY (platform, id)
);
CREATE INDEX IF NOT EXISTS items_seen ON items(seen_at);

CREATE TABLE IF NOT EXISTS comments (
  platform TEXT NOT NULL,
  item_id TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  first_seen_at INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (platform, item_id, id)
);
CREATE INDEX IF NOT EXISTS comments_item ON comments(platform, item_id);
CREATE INDEX IF NOT EXISTS comments_fetched ON comments(fetched_at);
CREATE INDEX IF NOT EXISTS comments_first_seen ON comments(platform, item_id, first_seen_at);

CREATE TABLE IF NOT EXISTS comments_state (
  platform TEXT NOT NULL,
  item_id TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  lim INTEGER NOT NULL,
  complete INTEGER NOT NULL,
  with_replies INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (platform, item_id)
);

CREATE TABLE IF NOT EXISTS creators (
  platform TEXT NOT NULL,
  id TEXT NOT NULL,
  data TEXT NOT NULL,
  fetched_at INTEGER NOT NULL,
  PRIMARY KEY (platform, id)
);

CREATE TABLE IF NOT EXISTS item_media (
  platform TEXT NOT NULL,
  item_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  kind TEXT NOT NULL,
  url TEXT,
  sha256 TEXT,
  bytes INTEGER,
  mime TEXT,
  PRIMARY KEY (platform, item_id, seq)
);
CREATE INDEX IF NOT EXISTS item_media_sha ON item_media(sha256);

CREATE TABLE IF NOT EXISTS blobs (
  sha256 TEXT PRIMARY KEY,
  path TEXT NOT NULL,
  bytes INTEGER NOT NULL,
  mime TEXT,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS refs (
  platform TEXT NOT NULL,
  item_id TEXT NOT NULL,
  user TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  job_id TEXT,
  keyword TEXT,
  account TEXT,
  PRIMARY KEY (platform, item_id, user)
);
CREATE INDEX IF NOT EXISTS refs_user ON refs(user, platform, last_at);
CREATE INDEX IF NOT EXISTS refs_item ON refs(platform, item_id);
CREATE INDEX IF NOT EXISTS refs_job ON refs(user, job_id);

-- 同一作品可能被多个关键词采到：refs.keyword 只能存最后一个，这里保留完整映射。
CREATE TABLE IF NOT EXISTS ref_keywords (
  platform TEXT NOT NULL,
  item_id TEXT NOT NULL,
  user TEXT NOT NULL,
  keyword TEXT NOT NULL,
  first_at INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  job_id TEXT,
  PRIMARY KEY (platform, item_id, user, keyword)
);
CREATE INDEX IF NOT EXISTS ref_keywords_user ON ref_keywords(user, platform, last_at);
CREATE INDEX IF NOT EXISTS ref_keywords_keyword ON ref_keywords(user, platform, keyword);

CREATE TABLE IF NOT EXISTS claims (
  platform TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  owner TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  PRIMARY KEY (platform, item_id, kind)
);

CREATE TABLE IF NOT EXISTS fetch_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  platform TEXT NOT NULL,
  item_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  result TEXT NOT NULL,
  user TEXT,
  account TEXT,
  job_id TEXT,
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS fetch_log_at ON fetch_log(at);

CREATE TABLE IF NOT EXISTS user_masks (
  user TEXT NOT NULL,
  platform TEXT NOT NULL,
  item_id TEXT NOT NULL,
  comment_id TEXT NOT NULL,
  hidden_at INTEGER NOT NULL,
  PRIMARY KEY (user, platform, item_id, comment_id)
);
`

/** 打开（必要时新建）共享库。目录不存在会被创建。 */
export function openDatabase(dir: string): DatabaseSync {
  mkdirSync(dir, { recursive: true })
  const db = new DatabaseSync(join(dir, DB_FILE))
  db.exec(SCHEMA)
  // 旧库补列：comments_state.with_replies 是后加的（用来区分「采没采楼中楼」）。
  const stateColumns = db.prepare('PRAGMA table_info(comments_state)').all() as Array<{ name: string }>
  if (!stateColumns.some((column) => column.name === 'with_replies')) {
    db.exec('ALTER TABLE comments_state ADD COLUMN with_replies INTEGER NOT NULL DEFAULT 0')
  }
  // comments.first_seen_at：增量评论的关键，老数据补 0（表示「不知道什么时候第一次见到的」）。
  const commentColumns = db.prepare('PRAGMA table_info(comments)').all() as Array<{ name: string }>
  if (!commentColumns.some((column) => column.name === 'first_seen_at')) {
    db.exec('ALTER TABLE comments ADD COLUMN first_seen_at INTEGER NOT NULL DEFAULT 0')
    db.exec('CREATE INDEX IF NOT EXISTS comments_first_seen ON comments(platform, item_id, first_seen_at)')
  }
  // ref_keywords 是后加的：从 refs.keyword 回填一次，并 bump 库版本，让线索缓存重算一次。
  const backfilled = db.prepare(`
    INSERT OR IGNORE INTO ref_keywords(platform, item_id, user, keyword, first_at, last_at, job_id)
    SELECT platform, item_id, user, keyword, first_at, last_at, job_id FROM refs
    WHERE keyword IS NOT NULL AND keyword <> ''
  `).run()
  if (Number(backfilled.changes) > 0) {
    db.exec("UPDATE meta SET value = CAST(CAST(value AS INTEGER) + 1 AS TEXT) WHERE key = 'version'")
  }
  return db
}
