import Database from "better-sqlite3";
import path from "node:path";
import fs from "node:fs";

const dataDir = path.resolve(process.cwd(), "data");
if (!fs.existsSync(dataDir)) fs.mkdirSync(dataDir, { recursive: true });

const dbPath = path.join(dataDir, "analytics.sqlite");
export const db = new Database(dbPath);

db.pragma("journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sessionId TEXT NOT NULL,
    userId TEXT NOT NULL,
    eventType TEXT NOT NULL,
    element TEXT NOT NULL,
    page TEXT NOT NULL,
    timestamp INTEGER NOT NULL,
    payloadJson TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_events_session_ts ON events(sessionId, timestamp);
  CREATE INDEX IF NOT EXISTS idx_events_session_type ON events(sessionId, eventType);

  CREATE TABLE IF NOT EXISTS submitted_sessions (
    sessionId TEXT PRIMARY KEY,
    userId TEXT NOT NULL,
    taskId TEXT,
    taskDone INTEGER NOT NULL DEFAULT 0,
    submittedAt INTEGER NOT NULL,
    metaJson TEXT
  );
  CREATE INDEX IF NOT EXISTS idx_submitted_sessions_submittedAt ON submitted_sessions(submittedAt);
`);

export function insertEvent(evt, payloadJson) {
  const stmt = db.prepare(
    `INSERT INTO events (sessionId, userId, eventType, element, page, timestamp, payloadJson)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  );
  stmt.run(
    evt.sessionId,
    evt.userId,
    evt.eventType,
    evt.element,
    evt.page,
    evt.timestamp,
    payloadJson ?? null
  );
}

export function getSessionEvents(sessionId) {
  return db
    .prepare(
      `SELECT id, sessionId, userId, eventType, element, page, timestamp, payloadJson
       FROM events
       WHERE sessionId = ?
       ORDER BY timestamp ASC`
    )
    .all(sessionId);
}

export function submitSession({ sessionId, userId, taskId, taskDone, submittedAt, metaJson }) {
  db.prepare(
    `INSERT INTO submitted_sessions (sessionId, userId, taskId, taskDone, submittedAt, metaJson)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(sessionId) DO UPDATE SET
       taskId=excluded.taskId,
       taskDone=excluded.taskDone,
       submittedAt=excluded.submittedAt,
       metaJson=excluded.metaJson`
  ).run(sessionId, userId, taskId ?? null, taskDone ? 1 : 0, submittedAt, metaJson ?? null);
}

export function listSubmittedSessions({ limit = 50 } = {}) {
  return db
    .prepare(
      `SELECT sessionId, userId, taskId, taskDone, submittedAt, metaJson
       FROM submitted_sessions
       ORDER BY submittedAt DESC
       LIMIT ?`
    )
    .all(limit);
}

export function getSubmittedSession(sessionId) {
  return db
    .prepare(
      `SELECT sessionId, userId, taskId, taskDone, submittedAt, metaJson
       FROM submitted_sessions
       WHERE sessionId = ?`
    )
    .get(sessionId);
}
