import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';

const COOKIE = 'cike_workspace';
type ActionBody = { action: string; id?: string; ids?: string[]; cardId?: string; folderId?: string; name?: string; color?: string; coverType?: string; coverValue?: string | null; term?: string; meaning?: string; entries?: Array<{ term: string; meaning: string }>; session?: { practiceType: string; contentMode: string; scopeKey: string; scopeLabel: string; totalCount: number; correctCount: number; accuracy: number; averageItemMs: number; itemsPerMinute: number } };

function cookieValue(request: Request, name: string) {
  const raw = request.headers.get('cookie') ?? '';
  return raw.split(';').map((part) => part.trim()).find((part) => part.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
}
async function hashToken(token: string) {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}
function normalize(value: string) { return value.trim().normalize('NFC').replace(/\s+/g, ' ').toLocaleLowerCase(); }

async function ensureSchema() {
  const db = env.DB;
  await db.batch([
    db.prepare('CREATE TABLE IF NOT EXISTS workspaces (id TEXT PRIMARY KEY, token_hash TEXT NOT NULL UNIQUE, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'),
    db.prepare("CREATE TABLE IF NOT EXISTS cards (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, name TEXT NOT NULL, color TEXT NOT NULL DEFAULT '#1d6b5b', cover_type TEXT NOT NULL DEFAULT 'COLOR', cover_value TEXT, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)"),
    db.prepare('CREATE TABLE IF NOT EXISTS folders (id TEXT PRIMARY KEY, card_id TEXT NOT NULL REFERENCES cards(id) ON DELETE CASCADE, name TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS entries (id TEXT PRIMARY KEY, folder_id TEXT NOT NULL REFERENCES folders(id) ON DELETE CASCADE, term TEXT NOT NULL, meaning TEXT NOT NULL, normalized_term TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL)'),
    db.prepare('CREATE TABLE IF NOT EXISTS practice_sessions (id TEXT PRIMARY KEY, workspace_id TEXT NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE, practice_type TEXT NOT NULL, content_mode TEXT NOT NULL, scope_key TEXT NOT NULL, scope_label TEXT NOT NULL, total_count INTEGER NOT NULL, correct_count INTEGER NOT NULL, accuracy REAL NOT NULL, average_item_ms INTEGER NOT NULL, items_per_minute REAL NOT NULL, completed_at INTEGER NOT NULL)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_cards_workspace ON cards(workspace_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_folders_card ON folders(card_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_entries_folder ON entries(folder_id)'),
    db.prepare('CREATE INDEX IF NOT EXISTS idx_sessions_compare ON practice_sessions(workspace_id, scope_key, practice_type, completed_at)'),
  ]);
}

async function seedWorkspace(workspaceId: string) {
  const now = Date.now(), statCard = crypto.randomUUID(), englishCard = crypto.randomUUID(), statFolder = crypto.randomUUID(), englishFolder = crypto.randomUUID();
  const rows = [
    [statFolder, 'mean', '一组数值之和除以数值个数'], [statFolder, 'median', '排序后位于中间位置的数值'], [statFolder, 'variance', '各数值与平均数之差的平方的平均数'], [statFolder, 'standard deviation', '方差的算术平方根'], [statFolder, 'sample', '从总体中抽取并进行观察的一部分'],
    [englishFolder, 'coherent', '逻辑清楚、整体一致的'], [englishFolder, 'derive', '从某个来源得到或推演出来'], [englishFolder, 'empirical', '基于观察或实验的'], [englishFolder, 'interpret', '说明某事物的含义'], [englishFolder, 'significant', '重要的，或在统计上具有意义的'],
  ] as const;
  await env.DB.batch([
    env.DB.prepare('INSERT INTO cards (id, workspace_id, name, color, cover_type, cover_value, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(statCard, workspaceId, '统计学', '#1d6b5b', 'COLOR', null, 0, now, now),
    env.DB.prepare('INSERT INTO cards (id, workspace_id, name, color, cover_type, cover_value, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(englishCard, workspaceId, '学术英语', '#d76745', 'COLOR', null, 1, now, now),
    env.DB.prepare('INSERT INTO folders (id, card_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(statFolder, statCard, 'Unit 1 · 描述统计', 0, now, now),
    env.DB.prepare('INSERT INTO folders (id, card_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(englishFolder, englishCard, 'Unit 1 · Academic Words', 0, now, now),
    ...rows.map(([folderId, term, meaning], index) => env.DB.prepare('INSERT INTO entries (id, folder_id, term, meaning, normalized_term, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), folderId, term, meaning, normalize(term), index, now, now)),
  ]);
}

async function getWorkspace(request: Request) {
  await ensureSchema();
  const token = cookieValue(request, COOKIE);
  if (token) {
    const found = await env.DB.prepare('SELECT id FROM workspaces WHERE token_hash = ?').bind(await hashToken(token)).first<{ id: string }>();
    if (found) return { id: found.id, token: null as string | null };
  }
  const newToken = `${crypto.randomUUID()}${crypto.randomUUID()}`, id = crypto.randomUUID(), now = Date.now();
  await env.DB.prepare('INSERT INTO workspaces (id, token_hash, created_at, updated_at) VALUES (?, ?, ?, ?)').bind(id, await hashToken(newToken), now, now).run();
  await seedWorkspace(id);
  return { id, token: newToken };
}
async function loadState(workspaceId: string) {
  const cards = (await env.DB.prepare('SELECT c.*, (SELECT COUNT(*) FROM folders f WHERE f.card_id = c.id) AS folder_count, (SELECT COUNT(*) FROM entries e JOIN folders f ON e.folder_id = f.id WHERE f.card_id = c.id) AS entry_count FROM cards c WHERE c.workspace_id = ? ORDER BY c.sort_order, c.created_at').bind(workspaceId).all()).results;
  const folders = (await env.DB.prepare('SELECT f.* FROM folders f JOIN cards c ON f.card_id = c.id WHERE c.workspace_id = ? ORDER BY f.sort_order, f.created_at').bind(workspaceId).all()).results;
  const entries = (await env.DB.prepare('SELECT e.* FROM entries e JOIN folders f ON e.folder_id = f.id JOIN cards c ON f.card_id = c.id WHERE c.workspace_id = ? ORDER BY e.sort_order, e.created_at').bind(workspaceId).all()).results;
  const sessions = (await env.DB.prepare('SELECT * FROM practice_sessions WHERE workspace_id = ? ORDER BY completed_at DESC LIMIT 50').bind(workspaceId).all()).results;
  return { cards, folders, entries, sessions };
}
function withCookie(payload: unknown, token: string | null, status = 200) {
  const response = NextResponse.json(payload, { status });
  if (token) response.cookies.set(COOKIE, token, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 31536000 });
  return response;
}
async function ownsCard(workspaceId: string, id: string) { return Boolean(await env.DB.prepare('SELECT id FROM cards WHERE id = ? AND workspace_id = ?').bind(id, workspaceId).first()); }
async function ownsFolder(workspaceId: string, id: string) { return Boolean(await env.DB.prepare('SELECT f.id FROM folders f JOIN cards c ON f.card_id = c.id WHERE f.id = ? AND c.workspace_id = ?').bind(id, workspaceId).first()); }
async function ownsEntry(workspaceId: string, id: string) { return Boolean(await env.DB.prepare('SELECT e.id FROM entries e JOIN folders f ON e.folder_id = f.id JOIN cards c ON f.card_id = c.id WHERE e.id = ? AND c.workspace_id = ?').bind(id, workspaceId).first()); }

export async function GET(request: Request) {
  try { const workspace = await getWorkspace(request); return withCookie(await loadState(workspace.id), workspace.token); }
  catch (error) { console.error('state-load-failed', error instanceof Error ? error.message : 'unknown'); return NextResponse.json({ error: '暂时无法载入内容，请稍后重试。' }, { status: 500 }); }
}

export async function POST(request: Request) {
  try {
    const workspace = await getWorkspace(request), body = await request.json() as ActionBody, now = Date.now(), name = body.name?.trim();
    switch (body.action) {
      case 'createCard': {
        if (!name || name.length > 80) throw new Error('INVALID_NAME');
        const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM cards WHERE workspace_id = ?').bind(workspace.id).first<{ count: number }>();
        await env.DB.prepare('INSERT INTO cards (id, workspace_id, name, color, cover_type, cover_value, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspace.id, name, body.color ?? '#1d6b5b', body.coverType ?? 'COLOR', body.coverValue ?? null, count?.count ?? 0, now, now).run(); break;
      }
      case 'updateCard': if (!body.id || !name || !(await ownsCard(workspace.id, body.id))) throw new Error('NOT_FOUND'); else { await env.DB.prepare('UPDATE cards SET name = ?, color = ?, cover_type = ?, cover_value = ?, updated_at = ? WHERE id = ? AND workspace_id = ?').bind(name, body.color ?? '#1d6b5b', body.coverType ?? 'COLOR', body.coverValue ?? null, now, body.id, workspace.id).run(); break; }
      case 'deleteCard': if (!body.id || !(await ownsCard(workspace.id, body.id))) throw new Error('NOT_FOUND'); else { await env.DB.prepare('DELETE FROM cards WHERE id = ? AND workspace_id = ?').bind(body.id, workspace.id).run(); break; }
      case 'createFolder': {
        if (!body.cardId || !name || !(await ownsCard(workspace.id, body.cardId))) throw new Error('NOT_FOUND');
        const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM folders WHERE card_id = ?').bind(body.cardId).first<{ count: number }>();
        await env.DB.prepare('INSERT INTO folders (id, card_id, name, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), body.cardId, name, count?.count ?? 0, now, now).run(); break;
      }
      case 'updateFolder': if (!body.id || !name || !(await ownsFolder(workspace.id, body.id))) throw new Error('NOT_FOUND'); else { await env.DB.prepare('UPDATE folders SET name = ?, updated_at = ? WHERE id = ?').bind(name, now, body.id).run(); break; }
      case 'deleteFolder': if (!body.id || !(await ownsFolder(workspace.id, body.id))) throw new Error('NOT_FOUND'); else { await env.DB.prepare('DELETE FROM folders WHERE id = ?').bind(body.id).run(); break; }
      case 'createEntry': {
        const term = body.term?.trim(), meaning = body.meaning?.trim();
        if (!body.folderId || !term || !meaning || term.length > 200 || meaning.length > 2000 || !(await ownsFolder(workspace.id, body.folderId))) throw new Error('INVALID_ENTRY');
        const count = await env.DB.prepare('SELECT COUNT(*) AS count FROM entries WHERE folder_id = ?').bind(body.folderId).first<{ count: number }>();
        await env.DB.prepare('INSERT INTO entries (id, folder_id, term, meaning, normalized_term, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), body.folderId, term, meaning, normalize(term), count?.count ?? 0, now, now).run(); break;
      }
      case 'updateEntry': {
        const term = body.term?.trim(), meaning = body.meaning?.trim();
        if (!body.id || !term || !meaning || !(await ownsEntry(workspace.id, body.id))) throw new Error('INVALID_ENTRY');
        await env.DB.prepare('UPDATE entries SET term = ?, meaning = ?, normalized_term = ?, updated_at = ? WHERE id = ?').bind(term, meaning, normalize(term), now, body.id).run(); break;
      }
      case 'deleteEntry': if (!body.id || !(await ownsEntry(workspace.id, body.id))) throw new Error('NOT_FOUND'); else { await env.DB.prepare('DELETE FROM entries WHERE id = ?').bind(body.id).run(); break; }
      case 'bulkDeleteEntries': {
        const ids = [...new Set(body.ids ?? [])].filter((id) => typeof id === 'string' && id.length > 0);
        if (!ids.length || ids.length > 2000) throw new Error('INVALID_BULK_DELETE');
        const placeholders = ids.map(() => '?').join(', ');
        await env.DB.prepare(`DELETE FROM entries WHERE id IN (${placeholders}) AND folder_id IN (SELECT f.id FROM folders f JOIN cards c ON f.card_id = c.id WHERE c.workspace_id = ?)`).bind(...ids, workspace.id).run();
        break;
      }
      case 'importEntries': {
        if (!body.folderId || !(await ownsFolder(workspace.id, body.folderId)) || !Array.isArray(body.entries) || body.entries.length > 2000) throw new Error('INVALID_IMPORT');
        const base = await env.DB.prepare('SELECT COUNT(*) AS count FROM entries WHERE folder_id = ?').bind(body.folderId).first<{ count: number }>();
        const valid = body.entries.map((entry) => ({ term: entry.term.trim(), meaning: entry.meaning.trim() })).filter((entry) => entry.term && entry.meaning && entry.term.length <= 200 && entry.meaning.length <= 2000);
        if (valid.length) await env.DB.batch(valid.map((entry, index) => env.DB.prepare('INSERT INTO entries (id, folder_id, term, meaning, normalized_term, sort_order, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), body.folderId, entry.term, entry.meaning, normalize(entry.term), (base?.count ?? 0) + index, now, now))); break;
      }
      case 'saveSession': {
        const s = body.session; if (!s) throw new Error('INVALID_SESSION');
        await env.DB.prepare('INSERT INTO practice_sessions (id, workspace_id, practice_type, content_mode, scope_key, scope_label, total_count, correct_count, accuracy, average_item_ms, items_per_minute, completed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(crypto.randomUUID(), workspace.id, s.practiceType, s.contentMode, s.scopeKey, s.scopeLabel, s.totalCount, s.correctCount, Math.max(0, Math.min(1, s.accuracy)), Math.max(0, Math.round(s.averageItemMs)), Math.max(0, s.itemsPerMinute), now).run(); break;
      }
      default: return withCookie({ error: '未知操作。' }, workspace.token, 400);
    }
    return withCookie(await loadState(workspace.id), workspace.token);
  } catch (error) { console.error('state-action-failed', error instanceof Error ? error.message : 'unknown'); return NextResponse.json({ error: '操作未完成，请检查内容后重试。' }, { status: 400 }); }
}
