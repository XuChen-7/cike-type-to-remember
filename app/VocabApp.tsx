'use client';

import { FormEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';

type Card = { id: string; name: string; color: string; cover_type: 'COLOR' | 'IMAGE'; cover_value: string | null; folder_count: number; entry_count: number };
type Folder = { id: string; card_id: string; name: string };
type Entry = { id: string; folder_id: string; term: string; meaning: string };
type Session = { id: string; practice_type: 'TYPING' | 'DICTATION'; content_mode: 'TERM_ONLY' | 'TERM_WITH_MEANING'; scope_key: string; scope_label: string; total_count: number; correct_count: number; accuracy: number; average_item_ms: number; items_per_minute: number; completed_at: number };
type AppState = { cards: Card[]; folders: Folder[]; entries: Entry[]; sessions: Session[] };
type View = { type: 'library' } | { type: 'card'; id: string } | { type: 'folder'; id: string } | { type: 'history' };
type Scope = { key: string; label: string; entries: Entry[] };
type PracticeOptions = { type: 'TYPING' | 'DICTATION'; contentMode: 'TERM_ONLY' | 'TERM_WITH_MEANING'; random: boolean; caseSensitive: boolean };
type ActivePractice = { scope: Scope; options: PracticeOptions; nonce: number };
type PracticeResult = { accuracy: number; averageItemMs: number; itemsPerMinute: number; correctCount: number; totalCount: number; wrongItems: Entry[] };

const colors = ['#1d6b5b', '#d76745', '#475c95', '#9b6b16', '#6d5188', '#29738a'];
const keyRows = ['QWERTYUIOP', 'ASDFGHJKL', 'ZXCVBNM'];

function splitGraphemes(value: string) {
  if (typeof Intl !== 'undefined' && 'Segmenter' in Intl) {
    return Array.from(new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(value), (part) => part.segment);
  }
  return Array.from(value);
}

function normalizeAnswer(value: string, caseSensitive: boolean) {
  const normalized = value
    .normalize('NFKC')
    .replace(/[\u00AD\u200B\u2060\uFEFF]/g, '')
    .replace(/[‘’‛]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/[‐‑‒–—―]/g, '-')
    .trim()
    .replace(/\s+/g, ' ');
  return caseSensitive ? normalized : normalized.toLocaleLowerCase();
}

function describeAnswerDifference(answer: string, target: string, caseSensitive: boolean) {
  const actual = splitGraphemes(normalizeAnswer(answer, caseSensitive));
  const expected = splitGraphemes(normalizeAnswer(target, caseSensitive));
  const length = Math.max(actual.length, expected.length);
  for (let index = 0; index < length; index += 1) {
    if (actual[index] === expected[index]) continue;
    if (actual[index] === undefined) return `从第 ${index + 1} 个字符开始缺少内容`;
    if (expected[index] === undefined) return `从第 ${index + 1} 个字符开始多输入了内容`;
    const shownActual = actual[index] === ' ' ? '空格' : `“${actual[index]}”`;
    const shownExpected = expected[index] === ' ' ? '空格' : `“${expected[index]}”`;
    return `第 ${index + 1} 个字符不同：输入了${shownActual}，应为${shownExpected}`;
  }
  return '答案只存在可忽略的格式差异';
}

function filterDictationAnswer(value: string, target: string) {
  const targetChars = splitGraphemes(target);
  const accepted: string[] = [];
  for (const char of splitGraphemes(value)) {
    const expected = targetChars[accepted.length];
    const typedSpace = /\s/u.test(char);
    const expectedSpace = expected !== undefined && /\s/u.test(expected);
    if (typedSpace) {
      if (expectedSpace) accepted.push(' ');
      continue;
    }
    if (expectedSpace) continue;
    accepted.push(char);
  }
  return accepted.join('');
}

function shuffle<T>(values: T[]) {
  const copy = [...values];
  for (let i = copy.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

function tint(color: string, opacity = '18') { return `${color}${opacity}`; }
function seconds(ms: number) { return `${(ms / 1000).toFixed(1)} 秒`; }

export default function VocabApp() {
  const [data, setData] = useState<AppState | null>(null);
  const [view, setView] = useState<View>({ type: 'library' });
  const [modal, setModal] = useState<'card' | 'folder' | 'entry' | 'import' | 'practice' | 'settings' | null>(null);
  const [editing, setEditing] = useState<Card | Folder | Entry | null>(null);
  const [scope, setScope] = useState<Scope | null>(null);
  const [activePractice, setActivePractice] = useState<ActivePractice | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [search, setSearch] = useState('');

  useEffect(() => { void load(); }, []);

  async function load() {
    try {
      const response = await fetch('/api/data');
      const next = await response.json() as AppState & { error?: string };
      if (!response.ok) throw new Error(next.error);
      setData(next);
    } catch { setError('内容暂时没有载入，请刷新页面重试。'); }
  }

  async function mutate(payload: Record<string, unknown>) {
    setBusy(true); setError('');
    try {
      const response = await fetch('/api/data', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(payload) });
      const next = await response.json() as AppState & { error?: string };
      if (!response.ok) throw new Error(next.error);
      setData(next);
      return true;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '操作失败，请重试。');
      return false;
    } finally { setBusy(false); }
  }

  if (!data) return <LoadingState error={error} onRetry={load} />;

  const currentCard = view.type === 'card' ? data.cards.find((card) => card.id === view.id) : view.type === 'folder' ? data.cards.find((card) => card.id === data.folders.find((folder) => folder.id === view.id)?.card_id) : undefined;
  const currentFolder = view.type === 'folder' ? data.folders.find((folder) => folder.id === view.id) : undefined;

  function scopeFor(kind: 'all' | 'card' | 'folder', id?: string): Scope {
    if (kind === 'all') return { key: 'all', label: '全部内容', entries: data!.entries };
    if (kind === 'card') {
      const card = data!.cards.find((item) => item.id === id)!;
      const folderIds = new Set(data!.folders.filter((folder) => folder.card_id === id).map((folder) => folder.id));
      return { key: `card:${id}`, label: card.name, entries: data!.entries.filter((entry) => folderIds.has(entry.folder_id)) };
    }
    const folder = data!.folders.find((item) => item.id === id)!;
    return { key: `folder:${id}`, label: folder.name, entries: data!.entries.filter((entry) => entry.folder_id === id) };
  }

  function openPractice(nextScope: Scope) {
    if (!nextScope.entries.length) { setError('这个范围还没有词条，请先添加内容。'); return; }
    setScope(nextScope); setModal('practice');
  }

  function startPractice(options: PracticeOptions, customScope = scope) {
    if (!customScope) return;
    const entries = options.random ? shuffle(customScope.entries) : [...customScope.entries];
    setModal(null);
    setActivePractice({ scope: { ...customScope, entries }, options, nonce: Date.now() });
  }

  async function saveSession(active: ActivePractice, result: PracticeResult) {
    await mutate({ action: 'saveSession', session: { practiceType: active.options.type, contentMode: active.options.contentMode, scopeKey: active.scope.key, scopeLabel: active.scope.label, totalCount: result.totalCount, correctCount: result.correctCount, accuracy: result.accuracy, averageItemMs: result.averageItemMs, itemsPerMinute: result.itemsPerMinute } });
  }

  if (activePractice) {
    return <PracticeRun key={activePractice.nonce} active={activePractice} previousSessions={data.sessions} onExit={() => setActivePractice(null)} onSave={(result) => saveSession(activePractice, result)} onRetry={(items) => startPractice(activePractice.options, { ...activePractice.scope, key: `${activePractice.scope.key}:mistakes`, label: `${activePractice.scope.label} · 错词`, entries: items })} />;
  }

  return (
    <main className="library-shell">
      <AppHeader active={view.type === 'history' ? 'history' : 'library'} onLibrary={() => setView({ type: 'library' })} onHistory={() => setView({ type: 'history' })} onSettings={() => setModal('settings')} />
      {error && <div className="toast" role="alert">{error}<button onClick={() => setError('')} aria-label="关闭">×</button></div>}

      {view.type === 'library' && <LibraryView data={data} search={search} onSearch={setSearch} onCreate={() => { setEditing(null); setModal('card'); }} onOpen={(id) => setView({ type: 'card', id })} onEdit={(card) => { setEditing(card); setModal('card'); }} onDelete={async (card) => { if (confirm(`删除“${card.name}”及其全部文件夹和词条？`)) await mutate({ action: 'deleteCard', id: card.id }); }} onPractice={() => openPractice(scopeFor('all'))} />}
      {view.type === 'card' && currentCard && <CardView card={currentCard} folders={data.folders.filter((folder) => folder.card_id === currentCard.id)} entries={data.entries} onBack={() => setView({ type: 'library' })} onCreate={() => { setEditing(null); setModal('folder'); }} onOpen={(id) => setView({ type: 'folder', id })} onEdit={(folder) => { setEditing(folder); setModal('folder'); }} onDelete={async (folder) => { if (confirm(`删除“${folder.name}”和其中的全部词条？`)) await mutate({ action: 'deleteFolder', id: folder.id }); }} onPractice={() => openPractice(scopeFor('card', currentCard.id))} />}
      {view.type === 'folder' && currentCard && currentFolder && <FolderView card={currentCard} folder={currentFolder} entries={data.entries.filter((entry) => entry.folder_id === currentFolder.id)} onBack={() => setView({ type: 'card', id: currentCard.id })} onAdd={() => { setEditing(null); setModal('entry'); }} onEdit={(entry) => { setEditing(entry); setModal('entry'); }} onDelete={(entry) => void mutate({ action: 'deleteEntry', id: entry.id })} onBulkDelete={async (ids) => { if (confirm(`确定删除选中的 ${ids.length} 个词条吗？此操作无法撤销。`)) await mutate({ action: 'bulkDeleteEntries', ids }); }} onImport={() => setModal('import')} onPractice={() => openPractice(scopeFor('folder', currentFolder.id))} />}
      {view.type === 'history' && <HistoryView sessions={data.sessions} onStart={() => openPractice(scopeFor('all'))} />}

      {modal === 'card' && <CardModal card={editing && 'cover_type' in editing ? editing as Card : null} busy={busy} onClose={() => setModal(null)} onSubmit={async (payload, file) => {
        let coverValue = payload.coverValue;
        if (file) { const form = new FormData(); form.append('file', file); const response = await fetch('/api/files', { method: 'POST', body: form }); const uploaded = await response.json() as { url?: string; error?: string }; if (!response.ok || !uploaded.url) { setError(uploaded.error ?? '封面上传失败。'); return; } coverValue = uploaded.url; }
        const ok = await mutate({ action: payload.id ? 'updateCard' : 'createCard', ...payload, coverValue }); if (ok) setModal(null);
      }} />}
      {modal === 'folder' && currentCard && <NameModal title={editing ? '编辑文件夹' : '新建文件夹'} label="文件夹名称" placeholder="例如：Unit 2 · 概率分布" initial={editing && 'card_id' in editing ? (editing as Folder).name : ''} busy={busy} onClose={() => setModal(null)} onSubmit={async (name) => { const folder = editing && 'card_id' in editing ? editing as Folder : null; const ok = await mutate(folder ? { action: 'updateFolder', id: folder.id, name } : { action: 'createFolder', cardId: currentCard.id, name }); if (ok) setModal(null); }} />}
      {modal === 'entry' && currentFolder && <EntryModal entry={editing && 'term' in editing ? editing as Entry : null} busy={busy} onClose={() => setModal(null)} onSubmit={async (term, meaning) => { const entry = editing && 'term' in editing ? editing as Entry : null; const ok = await mutate(entry ? { action: 'updateEntry', id: entry.id, term, meaning } : { action: 'createEntry', folderId: currentFolder.id, term, meaning }); if (ok) { setModal(null); setEditing(null); } }} />}
      {modal === 'import' && currentFolder && <ImportModal busy={busy} onClose={() => setModal(null)} onSubmit={async (entries) => { const ok = await mutate({ action: 'importEntries', folderId: currentFolder.id, entries }); if (ok) setModal(null); }} />}
      {modal === 'practice' && scope && <PracticeModal scope={scope} onClose={() => setModal(null)} onStart={startPractice} />}
      {modal === 'settings' && <InfoModal onClose={() => setModal(null)} />}
    </main>
  );
}

function LoadingState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return <main className="loading-page"><div className="loading-logo">键</div><h1>正在打开你的知识库</h1>{error ? <><p>{error}</p><button className="button button-primary" onClick={onRetry}>重新载入</button></> : <div className="loading-bar"><span /></div>}</main>;
}

function AppHeader({ active, onLibrary, onHistory, onSettings }: { active: 'library' | 'history'; onLibrary: () => void; onHistory: () => void; onSettings: () => void }) {
  return <header className="topbar"><button className="brand bare-button" onClick={onLibrary}><span className="brand-mark">W</span><span><strong>Word.html</strong><small>打出来，记得住</small></span></button><nav className="topnav" aria-label="主导航"><button className={active === 'library' ? 'active' : ''} onClick={onLibrary}>内容库</button><button className={active === 'history' ? 'active' : ''} onClick={onHistory}>练习记录</button></nav><button className="settings-button" type="button" onClick={onSettings}>设置</button></header>;
}

function LibraryView({ data, search, onSearch, onCreate, onOpen, onEdit, onDelete, onPractice }: { data: AppState; search: string; onSearch: (value: string) => void; onCreate: () => void; onOpen: (id: string) => void; onEdit: (card: Card) => void; onDelete: (card: Card) => void; onPractice: () => void }) {
  const cards = data.cards.filter((card) => card.name.toLocaleLowerCase().includes(search.toLocaleLowerCase()));
  return <><section className="hero"><div><p className="eyebrow">Word.html · 你的知识练习场</p><h1>打出来，<br />记得住。</h1><p className="hero-copy">把单词、术语和概念按科目整理，用连续打字与释义默写练到真正熟悉。</p></div><div className="hero-actions"><button className="button button-secondary" onClick={onCreate}>＋ 新建科目</button><button className="button button-primary" onClick={onPractice} disabled={!data.entries.length}>开始全部练习 <span>→</span></button></div></section><section className="library-section"><div className="section-heading"><div><h2>我的科目</h2><p>{data.cards.length} 个科目 · {data.entries.length} 个词条</p></div><label className="search-field"><span>⌕</span><input type="search" value={search} onChange={(event) => onSearch(event.target.value)} placeholder="搜索科目" aria-label="搜索科目" /></label></div><div className="subject-grid">{cards.map((card, index) => <SubjectCard key={card.id} card={card} index={index} onOpen={() => onOpen(card.id)} onEdit={() => onEdit(card)} onDelete={() => onDelete(card)} />)}<button className="new-card" onClick={onCreate}><span className="new-card-icon">＋</span><strong>新建科目卡片</strong><small>从一个新分类开始整理</small></button></div></section></>;
}

function SubjectCard({ card, index, onOpen, onEdit, onDelete }: { card: Card; index: number; onOpen: () => void; onEdit: () => void; onDelete: () => void }) {
  const [menu, setMenu] = useState(false);
  const titleLength = Array.from(card.name).length;
  const coverTitleSize = titleLength <= 6 ? 51 : titleLength <= 14 ? 38 : titleLength <= 28 ? 28 : titleLength <= 48 ? 22 : 17;
  return <article className="subject-card" style={{ '--accent': card.color, '--tint': tint(card.color) } as React.CSSProperties}><button className="card-main" onClick={onOpen}><div className={`cover cover-${index % 3 + 1}`} style={card.cover_type === 'IMAGE' && card.cover_value ? { backgroundImage: `linear-gradient(180deg, transparent, ${card.color}55), url(${card.cover_value})` } : undefined}><span className="cover-mark" style={{ fontSize: coverTitleSize }}>{card.name}</span><span className="cover-label">SUBJECT {String(index + 1).padStart(2, '0')}</span></div><div className="card-body"><div className="card-title-row"><h3>{card.name}</h3><span className="card-arrow">↗</span></div><p>{card.folder_count} 个文件夹 <span>·</span> {card.entry_count} 个词条</p><div className="card-meta"><span>{card.entry_count ? '可以开始练习' : '等待添加词条'}</span><span className="practice-link">打开科目 →</span></div></div></button><button className="card-menu" onClick={() => setMenu(!menu)} aria-label="更多操作">•••</button>{menu && <div className="mini-menu"><button onClick={onEdit}>编辑卡片</button><button className="danger" onClick={onDelete}>删除卡片</button></div>}</article>;
}

function CardView({ card, folders, entries, onBack, onCreate, onOpen, onEdit, onDelete, onPractice }: { card: Card; folders: Folder[]; entries: Entry[]; onBack: () => void; onCreate: () => void; onOpen: (id: string) => void; onEdit: (folder: Folder) => void; onDelete: (folder: Folder) => void; onPractice: () => void }) {
  return <section className="detail-page"><button className="back-button" onClick={onBack}>← 返回内容库</button><div className="detail-hero" style={{ '--accent': card.color, '--tint': tint(card.color) } as React.CSSProperties}><div><p className="eyebrow">科目卡片</p><h1>{card.name}</h1><p>{folders.length} 个文件夹 · {entries.filter((entry) => folders.some((folder) => folder.id === entry.folder_id)).length} 个词条</p></div><div className="hero-actions"><button className="button button-secondary" onClick={onCreate}>＋ 新建文件夹</button><button className="button button-primary" onClick={onPractice}>练习本科目 →</button></div></div><div className="folder-list-heading"><div><h2>文件夹</h2><p>按章节或单元继续整理</p></div></div><div className="folder-grid">{folders.map((folder, index) => { const count = entries.filter((entry) => entry.folder_id === folder.id).length; return <article className="folder-card" key={folder.id}><button className="folder-open" onClick={() => onOpen(folder.id)}><span className="folder-index">{String(index + 1).padStart(2, '0')}</span><h3>{folder.name}</h3><p>{count} 个词条</p><span className="folder-arrow">打开文件夹 →</span></button><div className="folder-actions"><button onClick={() => onEdit(folder)}>编辑</button><button onClick={() => onDelete(folder)}>删除</button></div></article>; })}<button className="new-folder" onClick={onCreate}>＋<span>新建文件夹</span></button></div></section>;
}

function FolderView({ card, folder, entries, onBack, onAdd, onEdit, onDelete, onBulkDelete, onImport, onPractice }: { card: Card; folder: Folder; entries: Entry[]; onBack: () => void; onAdd: () => void; onEdit: (entry: Entry) => void; onDelete: (entry: Entry) => void; onBulkDelete: (ids: string[]) => Promise<void>; onImport: () => void; onPractice: () => void }) {
  const [query, setQuery] = useState(''); const [selected, setSelected] = useState<Set<string>>(new Set());
  const visible = entries.filter((entry) => `${entry.term} ${entry.meaning}`.toLocaleLowerCase().includes(query.toLocaleLowerCase())); const entryIds = entries.map((entry) => entry.id).join('|'); const allVisibleSelected = visible.length > 0 && visible.every((entry) => selected.has(entry.id));
  useEffect(() => { const valid = new Set(entryIds ? entryIds.split('|') : []); setSelected((current) => new Set([...current].filter((id) => valid.has(id)))); }, [entryIds]);
  function toggle(id: string) { setSelected((current) => { const next = new Set(current); if (next.has(id)) next.delete(id); else next.add(id); return next; }); }
  function toggleVisible() { setSelected((current) => { const next = new Set(current); if (allVisibleSelected) visible.forEach((entry) => next.delete(entry.id)); else visible.forEach((entry) => next.add(entry.id)); return next; }); }
  return <section className="detail-page entry-page"><button className="back-button" onClick={onBack}>← 返回 {card.name}</button><div className="entry-heading"><div><p className="eyebrow">{card.name}</p><h1>{folder.name}</h1><p>{entries.length} 个词条</p></div><div className="hero-actions"><button className="button button-secondary" onClick={onImport}>批量导入</button><button className="button button-secondary" onClick={onAdd}>＋ 添加词条</button><button className="button button-primary" onClick={onPractice} disabled={!entries.length}>开始练习 →</button></div></div><div className="entry-toolbar"><label className="search-field"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索词条或释义" /></label><div className="selection-actions"><span>{selected.size ? `已选 ${selected.size} 条` : `${visible.length} 条`}</span>{selected.size > 0 && <button className="bulk-delete-button" onClick={() => void onBulkDelete([...selected])}>删除选中词条</button>}</div></div><div className="entry-table"><div className="entry-row entry-header"><label className="entry-select"><input type="checkbox" checked={allVisibleSelected} onChange={toggleVisible} aria-label="全选当前列表" /></label><span>词条</span><span>释义 / 概念</span><span>操作</span></div>{visible.map((entry) => <div className={`entry-row ${selected.has(entry.id) ? 'selected' : ''}`} key={entry.id}><label className="entry-select"><input type="checkbox" checked={selected.has(entry.id)} onChange={() => toggle(entry.id)} aria-label={`选择 ${entry.term}`} /></label><strong>{entry.term}</strong><span>{entry.meaning}</span><span className="row-actions"><button onClick={() => onEdit(entry)}>编辑</button><button onClick={() => { if (confirm(`删除“${entry.term}”？`)) onDelete(entry); }}>删除</button></span></div>)}{!visible.length && <div className="table-empty">{entries.length ? '没有匹配的词条' : '还没有词条，先添加一条或批量导入。'}</div>}</div></section>;
}

function HistoryView({ sessions, onStart }: { sessions: Session[]; onStart: () => void }) {
  return <section className="detail-page history-page"><div className="entry-heading"><div><p className="eyebrow">练习记录</p><h1>看见每一次进步</h1><p>只记录完整完成的练习</p></div><button className="button button-primary" onClick={onStart}>开始全部练习 →</button></div><div className="history-list">{sessions.map((session) => <article key={session.id}><div className={`history-kind ${session.practice_type === 'TYPING' ? 'typing' : 'dictation'}`}>{session.practice_type === 'TYPING' ? '打' : '默'}</div><div><strong>{session.scope_label}</strong><p>{session.practice_type === 'TYPING' ? '连续打字' : '默写拼写'} · {session.total_count} 个词条</p></div><div className="history-stat"><strong>{Math.round(session.accuracy * 100)}%</strong><span>正确率</span></div><div className="history-stat"><strong>{session.practice_type === 'TYPING' ? `${session.items_per_minute.toFixed(1)}/分` : seconds(session.average_item_ms)}</strong><span>{session.practice_type === 'TYPING' ? '平均速度' : '平均用时'}</span></div><time>{new Date(session.completed_at).toLocaleDateString('zh-CN')}</time></article>)}{!sessions.length && <div className="history-empty"><span>⌨</span><h2>还没有练习记录</h2><p>完成第一轮之后，正确率与速度趋势会出现在这里。</p></div>}</div></section>;
}

function ModalShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: React.ReactNode }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><button className="modal-close" onClick={onClose}>×</button><p className="eyebrow">Word.html</p><h2>{title}</h2>{subtitle && <p className="modal-subtitle">{subtitle}</p>}{children}</section></div>;
}

function CardModal({ card, busy, onClose, onSubmit }: { card: Card | null; busy: boolean; onClose: () => void; onSubmit: (payload: { id?: string; name: string; color: string; coverType: 'COLOR' | 'IMAGE'; coverValue: string | null }, file: File | null) => void }) {
  const [name, setName] = useState(card?.name ?? ''); const [color, setColor] = useState(card?.color ?? colors[0]); const [file, setFile] = useState<File | null>(null);
  return <ModalShell title={card ? '编辑科目卡片' : '新建科目卡片'} subtitle="为一门课或一个主题建立独立空间" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onSubmit({ id: card?.id, name, color, coverType: file || card?.cover_type === 'IMAGE' ? 'IMAGE' : 'COLOR', coverValue: card?.cover_value ?? null }, file); }}><label className="field"><span>科目名称</span><input autoFocus required maxLength={80} value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：统计学" /></label><fieldset className="color-picker"><legend>主题色</legend>{colors.map((item) => <button type="button" key={item} className={color === item ? 'selected' : ''} style={{ background: item }} onClick={() => setColor(item)} aria-label={`选择颜色${item}`} />)}</fieldset><label className="file-field"><span>上传封面图（可选）</span><input type="file" accept="image/jpeg,image/png,image/webp" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /><small>{file ? file.name : 'JPG、PNG 或 WebP，不超过 5MB'}</small></label><button className="button button-primary modal-submit" disabled={busy || !name.trim()}>{busy ? '正在保存…' : '保存卡片'}</button></form></ModalShell>;
}

function NameModal({ title, label, placeholder, initial, busy, onClose, onSubmit }: { title: string; label: string; placeholder: string; initial: string; busy: boolean; onClose: () => void; onSubmit: (value: string) => void }) {
  const [value, setValue] = useState(initial);
  return <ModalShell title={title} onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onSubmit(value); }}><label className="field"><span>{label}</span><input autoFocus required value={value} onChange={(event) => setValue(event.target.value)} placeholder={placeholder} /></label><button className="button button-primary modal-submit" disabled={busy || !value.trim()}>{busy ? '正在保存…' : '保存'}</button></form></ModalShell>;
}

function EntryModal({ entry, busy, onClose, onSubmit }: { entry: Entry | null; busy: boolean; onClose: () => void; onSubmit: (term: string, meaning: string) => void }) {
  const [term, setTerm] = useState(entry?.term ?? ''); const [meaning, setMeaning] = useState(entry?.meaning ?? '');
  return <ModalShell title={entry ? '编辑词条' : '添加词条'} subtitle="两个字段都是普通文本，可以使用任意语言" onClose={onClose}><form onSubmit={(event) => { event.preventDefault(); onSubmit(term, meaning); }}><label className="field"><span>词条</span><input autoFocus required maxLength={200} value={term} onChange={(event) => setTerm(event.target.value)} placeholder="例如：standard deviation" /></label><label className="field"><span>释义 / 概念</span><textarea required maxLength={2000} value={meaning} onChange={(event) => setMeaning(event.target.value)} placeholder="例如：方差的算术平方根" /></label><button className="button button-primary modal-submit" disabled={busy || !term.trim() || !meaning.trim()}>{busy ? '正在保存…' : '保存词条'}</button></form></ModalShell>;
}

function ImportModal({ busy, onClose, onSubmit }: { busy: boolean; onClose: () => void; onSubmit: (entries: Array<{ term: string; meaning: string }>) => void }) {
  const [raw, setRaw] = useState('');
  const parsed = useMemo(() => raw.split(/\r?\n/).map((line) => { const parts = line.includes('\t') ? line.split('\t') : line.split(','); return { term: (parts.shift() ?? '').trim(), meaning: parts.join(line.includes('\t') ? '\t' : ',').trim() }; }).filter((entry) => entry.term && entry.meaning), [raw]);
  return <ModalShell title="批量导入词条" subtitle="每行两列：词条 + 释义。支持从表格直接粘贴，也支持 CSV。" onClose={onClose}><label className="field"><span>粘贴内容</span><textarea className="import-area" autoFocus value={raw} onChange={(event) => setRaw(event.target.value)} placeholder={'mean\t一组数值之和除以数值个数\nmedian\t排序后位于中间位置的数值'} /></label><div className="import-preview"><strong>预览：{parsed.length} 条有效内容</strong>{parsed.slice(0, 3).map((entry, index) => <p key={`${entry.term}-${index}`}><span>{entry.term}</span><small>{entry.meaning}</small></p>)}</div><button className="button button-primary modal-submit" disabled={busy || !parsed.length} onClick={() => onSubmit(parsed)}>{busy ? '正在导入…' : `导入 ${parsed.length} 条词条`}</button></ModalShell>;
}

function PracticeModal({ scope, onClose, onStart }: { scope: Scope; onClose: () => void; onStart: (options: PracticeOptions) => void }) {
  const [type, setType] = useState<'TYPING' | 'DICTATION'>('TYPING'); const [contentMode, setContentMode] = useState<'TERM_ONLY' | 'TERM_WITH_MEANING'>('TERM_WITH_MEANING'); const [random, setRandom] = useState(true); const [caseSensitive, setCaseSensitive] = useState(false);
  return <ModalShell title="准备开始练习" subtitle={`${scope.label} · ${scope.entries.length} 个词条`} onClose={onClose}><div className="choice-label">训练方式</div><div className="mode-grid"><button className={type === 'TYPING' ? 'selected' : ''} onClick={() => setType('TYPING')}><span>⌨</span><strong>连续打字</strong><small>完成一轮后自动继续，直到主动结束</small></button><button className={type === 'DICTATION' ? 'selected' : ''} onClick={() => setType('DICTATION')}><span>＿</span><strong>默写拼写</strong><small>根据释义回忆词条</small></button></div>{type === 'TYPING' && <><div className="choice-label">显示方式</div><div className="segmented"><button className={contentMode === 'TERM_ONLY' ? 'selected' : ''} onClick={() => setContentMode('TERM_ONLY')}>仅词条</button><button className={contentMode === 'TERM_WITH_MEANING' ? 'selected' : ''} onClick={() => setContentMode('TERM_WITH_MEANING')}>词条 + 释义</button></div></>}<label className="check-row"><span><strong>随机排列</strong><small>每轮使用不同顺序</small></span><input type="checkbox" checked={random} onChange={(event) => setRandom(event.target.checked)} /></label><label className="check-row"><span><strong>严格区分大小写</strong><small>关闭时 Apple 和 apple 都可通过</small></span><input type="checkbox" checked={caseSensitive} onChange={(event) => setCaseSensitive(event.target.checked)} /></label><button className="button button-primary modal-submit" onClick={() => onStart({ type, contentMode, random, caseSensitive })}>开始练习 →</button></ModalShell>;
}

function InfoModal({ onClose }: { onClose: () => void }) {
  return <ModalShell title="关于你的数据" onClose={onClose}><div className="info-block"><span>✓</span><div><strong>无需注册</strong><p>内容保存在这个浏览器对应的匿名空间中，刷新或再次访问仍会保留。</p></div></div><div className="info-block warning"><span>!</span><div><strong>请不要清除网站 Cookie</strong><p>首版暂不支持账号或跨设备同步，清除 Cookie 后将无法找回原来的匿名空间。</p></div></div><button className="button button-primary modal-submit" onClick={onClose}>我知道了</button></ModalShell>;
}

function PracticeRun({ active, previousSessions, onExit, onSave, onRetry }: { active: ActivePractice; previousSessions: Session[]; onExit: () => void; onSave: (result: PracticeResult) => Promise<void>; onRetry: (items: Entry[]) => void }) {
  const [result, setResult] = useState<PracticeResult | null>(null);
  const previous = previousSessions.find((session) => session.scope_key === active.scope.key && session.practice_type === active.options.type && session.content_mode === active.options.contentMode);
  async function finish(next: PracticeResult) { setResult(next); await onSave(next); }
  if (result) return <ResultView active={active} result={result} previous={previous} onExit={onExit} onRetry={onRetry} />;
  return active.options.type === 'TYPING' ? <TypingPractice active={active} onExit={onExit} onFinish={finish} /> : <DictationPractice active={active} onExit={onExit} onFinish={finish} />;
}

function PracticeHeader({ label, index, total, accuracy, metric, onExit, round }: { label: string; index: number; total: number; accuracy: number; metric: string; onExit: () => void; round?: number }) {
  return <header className="practice-header"><button className="practice-brand" onClick={() => { if (confirm('结束当前练习？')) onExit(); }}>键</button><div className="practice-scope"><small>正在练习</small><strong>{label}</strong></div><div className="metrics"><div><span>{round ? '循环进度' : '进度'}</span><strong>{round ? `第 ${round} 轮` : index}<small>{round ? ` · ${index}/${total}` : ` / ${total}`}</small></strong></div><div><span>正确率</span><strong>{Math.round(accuracy * 100)}<small>%</small></strong></div><div><span>平均速度</span><strong>{metric}</strong></div></div><button className="practice-exit" onClick={() => { if (confirm('结束当前练习？')) onExit(); }}>{round ? '结束' : '退出'}</button></header>;
}

function TypingPractice({ active, onExit, onFinish }: { active: ActivePractice; onExit: () => void; onFinish: (result: PracticeResult) => void }) {
  const baseItems = active.scope.entries; const [roundItems, setRoundItems] = useState(baseItems); const [round, setRound] = useState(1); const [index, setIndex] = useState(0); const [pageStart, setPageStart] = useState(0); const [completedCount, setCompletedCount] = useState(0); const [failedAttempts, setFailedAttempts] = useState(0); const [typed, setTyped] = useState(''); const [totalKeys, setTotalKeys] = useState(0); const [correctKeys, setCorrectKeys] = useState(0); const [durations, setDurations] = useState<number[]>([]); const [wrongItems, setWrongItems] = useState<Entry[]>([]); const [flashError, setFlashError] = useState(false); const started = useRef(Date.now()); const itemHadError = useRef(false); const input = useRef<HTMLInputElement>(null); const stream = useRef<HTMLDivElement>(null); const currentWord = useRef<HTMLSpanElement>(null); const composing = useRef(false);
  const item = roundItems[index]; const activeMs = durations.reduce((sum, value) => sum + value, 0) + (item ? Date.now() - started.current : 0); const speed = completedCount && activeMs ? completedCount / (activeMs / 60000) : 0; const accuracy = totalKeys ? correctKeys / totalKeys : 1;

  function sameCharacter(actual: string, expected: string) {
    const left = actual.normalize('NFC'); const right = expected.normalize('NFC');
    return active.options.caseSensitive ? left === right : left.toLocaleLowerCase() === right.toLocaleLowerCase();
  }

  function processCharacters(value: string) {
    if (!item || !value) return;
    const target = splitGraphemes(item.term); const accepted = splitGraphemes(typed); const incoming = splitGraphemes(value);
    let addedCorrect = 0; let addedErrors = 0;
    for (const character of incoming) {
      const expected = target[accepted.length];
      if (expected !== undefined && sameCharacter(character, expected)) { accepted.push(character); addedCorrect += 1; }
      else { addedErrors += 1; itemHadError.current = true; }
    }
    const nextTotalKeys = totalKeys + incoming.length; const nextCorrectKeys = correctKeys + addedCorrect; const nextTyped = accepted.join('');
    setTotalKeys(nextTotalKeys); setCorrectKeys(nextCorrectKeys); setTyped(nextTyped);
    if (addedErrors) { setFlashError(true); window.setTimeout(() => setFlashError(false), 180); }
    if (accepted.length !== target.length) return;

    const attemptFailed = itemHadError.current, duration = Math.max(200, Date.now() - started.current), nextDurations = [...durations, duration], nextWrong = attemptFailed && !wrongItems.some((entry) => entry.id === item.id) ? [...wrongItems, item] : wrongItems, nextIndex = index + 1, nextCompletedCount = completedCount + 1, nextFailedAttempts = failedAttempts + (attemptFailed ? 1 : 0);
    setDurations(nextDurations); setWrongItems(nextWrong); setCompletedCount(nextCompletedCount); setFailedAttempts(nextFailedAttempts); setTyped(''); itemHadError.current = false;
    if (nextIndex >= roundItems.length) { setIndex(0); setPageStart(0); setRound((value) => value + 1); setRoundItems(active.options.random ? shuffle(baseItems) : [...baseItems]); started.current = Date.now(); }
    else { setIndex(nextIndex); started.current = Date.now(); }
  }

  function removeLastCharacter() { setTyped((value) => splitGraphemes(value).slice(0, -1).join('')); }

  const processCharactersRef = useRef(processCharacters); processCharactersRef.current = processCharacters;
  useEffect(() => { input.current?.focus(); }, [index, round]);
  useLayoutEffect(() => {
    const streamElement = stream.current, currentElement = currentWord.current;
    if (!streamElement || !currentElement) return;
    const streamRect = streamElement.getBoundingClientRect(), currentRect = currentElement.getBoundingClientRect();
    if (currentRect.top < streamRect.top - 1 || currentRect.bottom > streamRect.bottom + 1) setPageStart(index);
  }, [index, pageStart, round, roundItems]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.defaultPrevented || event.isComposing || event.key === 'Process' || event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === 'Backspace') { event.preventDefault(); setTyped((value) => splitGraphemes(value).slice(0, -1).join('')); return; }
      if (splitGraphemes(event.key).length === 1) { event.preventDefault(); processCharactersRef.current(event.key); }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, []);

  function handleInput(value: string) {
    if (composing.current) return;
    if (value.length < typed.length) { removeLastCharacter(); return; }
    processCharacters(value.slice(typed.length));
  }
  function stopPractice() {
    if (!completedCount) { onExit(); return; }
    const sum = durations.reduce((a, b) => a + b, 0);
    void onFinish({ accuracy: totalKeys ? correctKeys / totalKeys : 1, averageItemMs: sum / completedCount, itemsPerMinute: completedCount / (sum / 60000), correctCount: completedCount - failedAttempts, totalCount: completedCount, wrongItems });
  }
  const targetChars = splitGraphemes(item.term), typedLength = splitGraphemes(typed).length, currentKey = targetChars[typedLength]?.toUpperCase();
  const pageItems = roundItems.slice(pageStart);
  return <main className="practice-page typing-page" onClick={() => input.current?.focus()}><PracticeHeader label={active.scope.label} index={index} total={roundItems.length} round={round} accuracy={accuracy} metric={speed ? `${speed.toFixed(1)}/分` : '—'} onExit={stopPractice} /><div className="practice-progress"><span style={{ width: `${(index / roundItems.length) * 100}%` }} /></div><section className="typing-stage"><div className="word-stream" ref={stream} key={`${round}-${pageStart}`}>{pageItems.map((entry, pageIndex) => { const wordIndex = pageStart + pageIndex; return <span ref={wordIndex === index ? currentWord : undefined} key={`${entry.id}-${wordIndex}`} className={wordIndex < index ? 'done' : wordIndex === index ? `current ${flashError ? 'error' : ''}` : ''}>{entry.term}</span>; })}</div>{active.options.contentMode === 'TERM_WITH_MEANING' && <p className="typing-meaning">{item.meaning}</p>}<div className={`type-input-wrap ${flashError ? 'error' : ''}`}><span aria-hidden="true">{targetChars.map((char, charIndex) => <i key={`${char}-${charIndex}`} className={charIndex < typedLength ? 'typed' : charIndex === typedLength ? 'cursor' : ''}>{char === ' ' ? '·' : char}</i>)}</span><input ref={input} value={typed} onChange={(event) => handleInput(event.target.value)} onCompositionStart={() => { composing.current = true; }} onCompositionEnd={(event) => { composing.current = false; processCharacters(event.data); }} autoCapitalize="off" autoComplete="off" spellCheck={false} inputMode="text" aria-label={`输入 ${item.term}`} /></div><p className="typing-hint">第 {round} 轮 · 已完成 {completedCount} 次 · 本轮完成后自动继续</p><div className="keyboard" aria-label="屏幕键盘">{keyRows.map((row) => <div key={row}>{Array.from(row).map((key) => <button type="button" key={key} className={key === currentKey ? 'active' : ''} onMouseDown={(event) => event.preventDefault()} onClick={() => processCharacters(key)} aria-label={`输入字母 ${key}`}>{key}</button>)}</div>)}<div><button type="button" className={`space-key ${currentKey === ' ' ? 'active' : ''}`} onMouseDown={(event) => event.preventDefault()} onClick={() => processCharacters(' ')} aria-label="输入空格">SPACE</button></div></div></section></main>;
}

function DictationPractice({ active, onExit, onFinish }: { active: ActivePractice; onExit: () => void; onFinish: (result: PracticeResult) => void }) {
  const items = active.scope.entries; const [index, setIndex] = useState(0); const [answer, setAnswer] = useState(''); const [submittedAnswer, setSubmittedAnswer] = useState(''); const [submitted, setSubmitted] = useState(false); const [wasCorrect, setWasCorrect] = useState(false); const [correctCount, setCorrectCount] = useState(0); const [durations, setDurations] = useState<number[]>([]); const [wrongItems, setWrongItems] = useState<Entry[]>([]); const started = useRef(Date.now()); const input = useRef<HTMLInputElement>(null); const nextButton = useRef<HTMLButtonElement>(null); const item = items[index]; const chars = splitGraphemes(item.term); const answerChars = splitGraphemes(answer); const hasGuidedCharacters = chars.some((char) => /\s/u.test(char) || /[\p{P}\p{S}]/u.test(char)); const average = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
  useEffect(() => {
    if (submitted) nextButton.current?.focus();
    else input.current?.focus();
  }, [index, submitted]);
  function submit(event?: FormEvent) {
    event?.preventDefault();
    const currentAnswer = input.current?.value ?? answer;
    if (!normalizeAnswer(currentAnswer, active.options.caseSensitive) || submitted) return;
    const correct = normalizeAnswer(currentAnswer, active.options.caseSensitive) === normalizeAnswer(item.term, active.options.caseSensitive);
    setAnswer(currentAnswer); setSubmittedAnswer(currentAnswer); setWasCorrect(correct); setSubmitted(true); if (correct) setCorrectCount((count) => count + 1); else setWrongItems((items) => [...items, item]);
  }
  function next() {
    const duration = Math.max(200, Date.now() - started.current), nextDurations = [...durations, duration], nextWrong = wasCorrect ? wrongItems : [...wrongItems], nextCorrect = correctCount;
    if (index + 1 >= items.length) { const sum = nextDurations.reduce((a, b) => a + b, 0); void onFinish({ accuracy: nextCorrect / items.length, averageItemMs: sum / items.length, itemsPerMinute: items.length / (sum / 60000), correctCount: nextCorrect, totalCount: items.length, wrongItems: nextWrong }); return; }
    setDurations(nextDurations); setIndex(index + 1); setAnswer(''); setSubmittedAnswer(''); setSubmitted(false); setWasCorrect(false); started.current = Date.now();
  }
  return <main className="practice-page dictation-page"><PracticeHeader label={active.scope.label} index={index} total={items.length} accuracy={index ? correctCount / index : 1} metric={average ? seconds(average) : '—'} onExit={onExit} /><div className="practice-progress"><span style={{ width: `${(index / items.length) * 100}%` }} /></div><section className="dictation-stage"><p className="dictation-label">根据释义写出词条</p><h1>{item.meaning}</h1>{hasGuidedCharacters && <p className="dictation-format-hint"><b>·</b> 代表空格，敲到这里时按下空格键即可点亮</p>}<form onSubmit={submit}><div className={`answer-slots ${submitted ? (wasCorrect ? 'correct' : 'wrong') : ''}`} onClick={() => input.current?.focus()} aria-hidden="true">{chars.map((char, charIndex) => /\s/u.test(char) ? <span className={`slot space-marker ${/\s/u.test(answerChars[charIndex] ?? '') ? 'typed' : ''}`} key={charIndex}>·</span> : /[\p{P}\p{S}]/u.test(char) ? <span className={`slot punctuation ${answerChars[charIndex] === char ? 'typed' : ''}`} key={charIndex}>{char}</span> : <span className="slot" key={charIndex}>{submitted && !wasCorrect ? char : answerChars[charIndex] ?? ''}</span>)}</div><input ref={input} className="dictation-input" value={answer} onChange={(event) => setAnswer(filterDictationAnswer(event.target.value, item.term))} disabled={submitted} autoCapitalize="off" autoComplete="off" spellCheck={false} aria-label="默写答案；点号代表空格，只有输入到点号位置时空格键才会生效" />{submitted ? <div className={`answer-feedback ${wasCorrect ? 'correct' : 'wrong'}`}><strong>{wasCorrect ? '回答正确' : '再记一次'}</strong>{!wasCorrect && <div className="answer-comparison"><p>你的答案：<b>{submittedAnswer}</b></p><p>正确答案：<b>{item.term}</b></p><small>{describeAnswerDifference(submittedAnswer, item.term, active.options.caseSensitive)}</small></div>}<button ref={nextButton} className="button button-primary" type="button" onClick={next}>{index + 1 === items.length ? '查看结果' : '下一题 →'}</button><p className="answer-next-hint">按 Enter {index + 1 === items.length ? '查看结果' : '进入下一题'}</p></div> : <><button className="button button-primary dictation-submit" type="submit" disabled={!normalizeAnswer(answer, active.options.caseSensitive)}>提交答案</button><p className="typing-hint">输入后按 Enter 提交</p></>}</form></section></main>;
}

function ResultView({ active, result, previous, onExit, onRetry }: { active: ActivePractice; result: PracticeResult; previous?: Session; onExit: () => void; onRetry: (items: Entry[]) => void }) {
  const accuracyTrend = previous ? (result.accuracy - previous.accuracy) * 100 : null; const speedTrend = previous ? active.options.type === 'TYPING' ? result.itemsPerMinute - previous.items_per_minute : previous.average_item_ms - result.averageItemMs : null;
  return <main className="result-page"><div className="result-mark">✓</div><p className="eyebrow">本轮完成</p><h1>{result.wrongItems.length ? '记忆正在变得更清晰' : '漂亮，全都记住了'}</h1><p className="result-subtitle">{active.scope.label} · {result.totalCount} 个词条</p><div className="result-stats"><article><span>正确率</span><strong>{Math.round(result.accuracy * 100)}%</strong><small>{accuracyTrend === null ? '首次练习' : `${accuracyTrend >= 0 ? '↑' : '↓'} ${Math.abs(accuracyTrend).toFixed(1)}%`}</small></article><article><span>{active.options.type === 'TYPING' ? '平均速度' : '平均每题用时'}</span><strong>{active.options.type === 'TYPING' ? `${result.itemsPerMinute.toFixed(1)}/分` : seconds(result.averageItemMs)}</strong><small>{speedTrend === null ? '暂无趋势' : `${speedTrend >= 0 ? '↑' : '↓'} ${active.options.type === 'TYPING' ? Math.abs(speedTrend).toFixed(1) : seconds(Math.abs(speedTrend))}`}</small></article><article><span>一次通过</span><strong>{result.correctCount}<small> / {result.totalCount}</small></strong><small>{result.wrongItems.length ? `${result.wrongItems.length} 个待巩固` : '全部通过'}</small></article></div>{result.wrongItems.length > 0 && <section className="mistake-list"><div><h2>本轮待巩固</h2><p>再看一眼，然后只练这些词条</p></div>{result.wrongItems.slice(0, 6).map((entry) => <p key={entry.id}><strong>{entry.term}</strong><span>{entry.meaning}</span></p>)}</section>}<div className="result-actions">{result.wrongItems.length > 0 && <button className="button button-secondary" onClick={() => onRetry(result.wrongItems)}>只练错词</button>}<button className="button button-primary" onClick={onExit}>返回内容库</button></div></main>;
}
