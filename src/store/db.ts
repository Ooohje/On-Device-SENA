import { openDatabaseSync } from 'expo-sqlite';

// 모든 사용자 데이터는 기기 안 SQLite에만 저장한다 (서버·로그인 없음).
// 기기 변경 시에는 Android 자동 백업 / iCloud 백업으로 복원된다.
const db = openDatabaseSync('sena.db');

db.execSync(`
  PRAGMA journal_mode = WAL;
  CREATE TABLE IF NOT EXISTS profile (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS sessions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    scenario_id TEXT NOT NULL,
    started_at INTEGER NOT NULL,
    ended_at INTEGER,
    recap TEXT,
    report TEXT,
    user_turns INTEGER NOT NULL DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS messages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id INTEGER NOT NULL REFERENCES sessions(id) ON DELETE CASCADE,
    role TEXT NOT NULL,
    content TEXT NOT NULL,
    meta TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_scenario ON sessions(scenario_id, ended_at);
  CREATE TABLE IF NOT EXISTS attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sentence_id TEXT NOT NULL,
    text TEXT NOT NULL,
    articulation REAL NOT NULL,
    prosody REAL NOT NULL,
    transcript TEXT,
    created_at INTEGER NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_attempts_sentence ON attempts(sentence_id);
  CREATE TABLE IF NOT EXISTS practice_sentences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    text TEXT NOT NULL UNIQUE,
    original TEXT,
    source_session INTEGER,
    created_at INTEGER NOT NULL
  );
`);

// ── 프로필 / 설정 ──
const getValue = (key: string) => db.getFirstSync<{ value: string }>('SELECT value FROM profile WHERE key = ?', key)?.value ?? null;
const setValue = (key: string, value: string) => db.runSync('INSERT OR REPLACE INTO profile (key, value) VALUES (?, ?)', key, value);

export const getName = () => getValue('english_name');
export const setName = (name: string) => setValue('english_name', name);
export const getTtsEnabled = () => getValue('tts') !== '0';
export const setTtsEnabled = (on: boolean) => setValue('tts', on ? '1' : '0');
export const getChatLevel = () => getValue('chat_level');
export const setChatLevel = (id: string) => setValue('chat_level', id);
// 다운로드 관리자로 받고 있는 대화 모델의 받기 번호 (앱을 다시 열어도 진행 상황을 이어 보기 위해)
export const getLlmDownloadId = () => Number(getValue('llm_download_id') ?? 0) || null;
export const setLlmDownloadId = (id: number | null) => setValue('llm_download_id', id ? String(id) : '');

// ── 대화 기록 ──
export function createSession(scenarioId: string): number {
  return db.runSync('INSERT INTO sessions (scenario_id, started_at) VALUES (?, ?)', scenarioId, Date.now()).lastInsertRowId;
}

// meta: 음성으로 말한 경우의 말하기 지표 (SpeechMeta, JSON)
export function addMessage(sessionId: number, role: 'user' | 'assistant', content: string, meta?: object) {
  db.runSync(
    'INSERT INTO messages (session_id, role, content, meta, created_at) VALUES (?, ?, ?, ?, ?)',
    sessionId,
    role,
    content,
    meta ? JSON.stringify(meta) : null,
    Date.now(),
  );
  if (role === 'user') db.runSync('UPDATE sessions SET user_turns = user_turns + 1 WHERE id = ?', sessionId);
}

export function endSession(sessionId: number, recap: string) {
  db.runSync('UPDATE sessions SET ended_at = ?, recap = ? WHERE id = ?', Date.now(), recap || null, sessionId);
}

// 학습자가 한 마디도 안 한 대화는 기록에 남기지 않는다
export function discardIfEmpty(sessionId: number) {
  db.runSync('DELETE FROM sessions WHERE id = ? AND user_turns = 0', sessionId);
}

// 다음 대화에서 기억할 이전 대화 요약 (같은 상황, 최근 순)
export function recentRecaps(scenarioId: string, limit = 2): string[] {
  return db
    .getAllSync<{ recap: string }>(
      'SELECT recap FROM sessions WHERE scenario_id = ? AND recap IS NOT NULL ORDER BY ended_at DESC LIMIT ?',
      scenarioId,
      limit,
    )
    .map((r) => r.recap);
}

export function sessionCounts(): Record<string, number> {
  const rows = db.getAllSync<{ scenario_id: string; n: number }>(
    'SELECT scenario_id, COUNT(*) AS n FROM sessions WHERE user_turns > 0 GROUP BY scenario_id',
  );
  return Object.fromEntries(rows.map((r) => [r.scenario_id, r.n]));
}

export function saveReport(sessionId: number, report: object) {
  db.runSync('UPDATE sessions SET report = ? WHERE id = ?', JSON.stringify(report), sessionId);
}

export function getReport<T>(sessionId: number): { scenarioId: string; recap: string | null; report: T | null; startedAt: number } | null {
  const r = db.getFirstSync<{ scenario_id: string; recap: string | null; report: string | null; started_at: number }>(
    'SELECT scenario_id, recap, report, started_at FROM sessions WHERE id = ?',
    sessionId,
  );
  return r ? { scenarioId: r.scenario_id, recap: r.recap, report: r.report ? JSON.parse(r.report) : null, startedAt: r.started_at } : null;
}

export function sessionUserMessages(sessionId: number): { content: string; meta: any }[] {
  return db
    .getAllSync<{ content: string; meta: string | null }>("SELECT content, meta FROM messages WHERE session_id = ? AND role = 'user' ORDER BY id", sessionId)
    .map((r) => ({ content: r.content, meta: r.meta ? JSON.parse(r.meta) : null }));
}

export function sessionMessages(sessionId: number): { role: 'user' | 'assistant'; content: string }[] {
  return db.getAllSync('SELECT role, content FROM messages WHERE session_id = ? ORDER BY id', sessionId);
}

export function recentReports(limit = 20) {
  return db.getAllSync<{ id: number; scenario_id: string; ended_at: number; user_turns: number }>(
    'SELECT id, scenario_id, ended_at, user_turns FROM sessions WHERE report IS NOT NULL ORDER BY ended_at DESC LIMIT ?',
    limit,
  );
}

// ── 튜토리얼 ──
export function addAttempt(sentenceId: string, text: string, articulation: number, prosody: number, transcript?: string) {
  db.runSync(
    'INSERT INTO attempts (sentence_id, text, articulation, prosody, transcript, created_at) VALUES (?, ?, ?, ?, ?, ?)',
    sentenceId,
    text,
    articulation,
    prosody,
    transcript ?? null,
    Date.now(),
  );
}

export type BestScore = { articulation: number; prosody: number; tries: number };

// 문장별 최고 점수 (발음+운율 합 기준)
export function bestScores(): Record<string, BestScore> {
  const rows = db.getAllSync<{ sentence_id: string; articulation: number; prosody: number; tries: number }>(`
    SELECT a.sentence_id, a.articulation, a.prosody, c.tries FROM attempts a
    JOIN (SELECT sentence_id, MAX(articulation + prosody) AS best, COUNT(*) AS tries FROM attempts GROUP BY sentence_id) c
      ON a.sentence_id = c.sentence_id AND a.articulation + a.prosody = c.best
    GROUP BY a.sentence_id`);
  return Object.fromEntries(rows.map((r) => [r.sentence_id, { articulation: r.articulation, prosody: r.prosody, tries: r.tries }]));
}

// 자유 대화 보고서에서 넘어온 "내 문장"
export function addPracticeSentences(items: { text: string; original?: string }[], sessionId: number) {
  for (const it of items)
    db.runSync('INSERT OR IGNORE INTO practice_sentences (text, original, source_session, created_at) VALUES (?, ?, ?, ?)', it.text, it.original ?? null, sessionId, Date.now());
}

export function practiceSentences(): { id: number; text: string; original: string | null }[] {
  return db.getAllSync('SELECT id, text, original FROM practice_sentences ORDER BY created_at DESC LIMIT 30');
}

export function removePracticeSentence(id: number) {
  db.runSync('DELETE FROM practice_sentences WHERE id = ?', id);
}

// 로그아웃: 로그인이 없으므로 '이 기기의 SENA를 처음 상태로 되돌리기'와 같다. 이름·설정·대화·튜토리얼 기록을 모두 지운다
export function resetAll() {
  db.execSync('DELETE FROM messages; DELETE FROM sessions; DELETE FROM attempts; DELETE FROM practice_sentences; DELETE FROM profile;');
}

export function clearHistory() {
  db.execSync('DELETE FROM messages; DELETE FROM sessions; DELETE FROM attempts; DELETE FROM practice_sentences;');
}

export { normalizeEnglishName } from './name';
