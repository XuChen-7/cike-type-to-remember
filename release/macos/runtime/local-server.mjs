import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';
import { mkdir, readFile, stat, writeFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { dirname, extname, join, normalize, resolve, sep } from 'node:path';
import { Readable } from 'node:stream';
import { DatabaseSync } from 'node:sqlite';
import { env } from './cloudflare-shim.mjs';

process.env.NODE_ENV = 'production';

const defaultSupportDir = join(process.env.HOME ?? '', 'Library', 'Application Support', '词刻');
const supportDir = resolve(process.env.JIANJI_SUPPORT_DIR || defaultSupportDir);
const programDir = resolve(process.env.JIANJI_PROGRAM_DIR || join(supportDir, 'program'));
const dataDir = resolve(process.env.JIANJI_DATA_DIR || join(supportDir, 'data'));
const filesDir = join(dataDir, 'files');
const databasePath = join(dataDir, 'vocab.sqlite');
const workspacePath = join(dataDir, 'local-workspace-id');
const clientDir = join(programDir, 'dist', 'client');
const serverEntry = join(programDir, 'dist', 'server', 'index.js');
const host = process.env.JIANJI_HOST || '127.0.0.1';
const port = Number.parseInt(process.env.JIANJI_PORT || '3000', 10);

if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('JIANJI_PORT must be a valid TCP port.');
await mkdir(filesDir, { recursive: true });

class LocalD1Statement {
  constructor(database, sql) {
    this.database = database;
    this.sql = sql;
    this.values = [];
  }

  bind(...values) {
    this.values = values;
    return this;
  }

  async first() {
    return this.database.prepare(this.sql).get(...this.values) ?? null;
  }

  async all() {
    return { results: this.database.prepare(this.sql).all(...this.values) };
  }

  async run() {
    const result = this.database.prepare(this.sql).run(...this.values);
    return { success: true, meta: { changes: Number(result.changes), last_row_id: Number(result.lastInsertRowid) } };
  }
}

class LocalD1Database {
  constructor(path) {
    this.database = new DatabaseSync(path);
    this.database.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL;');
  }

  prepare(sql) {
    return new LocalD1Statement(this.database, sql);
  }

  async batch(statements) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      const results = [];
      for (const statement of statements) results.push(await statement.run());
      this.database.exec('COMMIT');
      return results;
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }
}

function safeObjectPath(root, key) {
  const decoded = decodeURIComponent(key).replaceAll('\\', '/');
  if (!decoded || decoded.startsWith('/') || decoded.split('/').includes('..')) return null;
  const candidate = resolve(root, normalize(decoded));
  return candidate.startsWith(`${resolve(root)}${sep}`) ? candidate : null;
}

function contentType(path) {
  return ({
    '.css': 'text/css; charset=utf-8', '.gif': 'image/gif', '.html': 'text/html; charset=utf-8',
    '.ico': 'image/x-icon', '.jpeg': 'image/jpeg', '.jpg': 'image/jpeg', '.js': 'text/javascript; charset=utf-8',
    '.json': 'application/json; charset=utf-8', '.png': 'image/png', '.svg': 'image/svg+xml', '.txt': 'text/plain; charset=utf-8',
    '.webp': 'image/webp', '.woff': 'font/woff', '.woff2': 'font/woff2',
  })[extname(path).toLowerCase()] || 'application/octet-stream';
}

class LocalR2Bucket {
  async put(key, value, options = {}) {
    const objectPath = safeObjectPath(filesDir, key);
    if (!objectPath) throw new Error('Invalid object key.');
    const body = Buffer.from(value);
    await mkdir(dirname(objectPath), { recursive: true });
    await writeFile(objectPath, body);
    await writeFile(`${objectPath}.metadata.json`, JSON.stringify(options.httpMetadata ?? {}));
    return { key };
  }

  async get(key) {
    const objectPath = safeObjectPath(filesDir, key);
    if (!objectPath) return null;
    try {
      const body = await readFile(objectPath);
      let metadata = {};
      try { metadata = JSON.parse(await readFile(`${objectPath}.metadata.json`, 'utf8')); } catch {}
      const etag = `\"${createHash('sha256').update(body).digest('hex')}\"`;
      return {
        body,
        httpEtag: etag,
        writeHttpMetadata(headers) {
          if (metadata.contentType) headers.set('content-type', metadata.contentType);
          if (metadata.cacheControl) headers.set('cache-control', metadata.cacheControl);
        },
      };
    } catch (error) {
      if (error?.code === 'ENOENT') return null;
      throw error;
    }
  }
}

async function chooseWorkspace(database) {
  try {
    const stored = (await readFile(workspacePath, 'utf8')).trim();
    if (stored) return stored;
  } catch {}

  let selected = 'local-default';
  try {
    const row = database.prepare(`
      SELECT w.id
      FROM workspaces w
      LEFT JOIN cards c ON c.workspace_id = w.id
      LEFT JOIN folders f ON f.card_id = c.id
      LEFT JOIN entries e ON e.folder_id = f.id
      GROUP BY w.id
      ORDER BY COUNT(DISTINCT e.id) DESC,
               MAX(COALESCE(e.updated_at, f.updated_at, c.updated_at, w.updated_at)) DESC
      LIMIT 1
    `).get();
    if (row?.id) selected = row.id;
  } catch {}

  await writeFile(workspacePath, `${selected}\n`);
  return selected;
}

async function staticResponse(pathname, method = 'GET') {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return null; }
  const relative = decoded.replace(/^\/+/, '');
  if (!relative) return null;
  const filePath = safeObjectPath(clientDir, relative);
  if (!filePath) return null;
  try {
    const info = await stat(filePath);
    if (!info.isFile()) return null;
    const headers = new Headers({
      'content-type': contentType(filePath),
      'content-length': String(info.size),
      'cache-control': relative.startsWith('_next/static/') ? 'public, max-age=31536000, immutable' : 'public, max-age=3600',
    });
    return new Response(method === 'HEAD' ? null : Readable.toWeb(createReadStream(filePath)), { headers });
  } catch (error) {
    if (error?.code === 'ENOENT') return null;
    throw error;
  }
}

const d1 = new LocalD1Database(databasePath);
env.DB = d1;
env.FILES = new LocalR2Bucket();
env.LOCAL_WORKSPACE_ID = await chooseWorkspace(d1.database);
env.ASSETS = {
  async fetch(request) {
    return await staticResponse(new URL(request.url).pathname, request.method) ?? new Response('Not found', { status: 404 });
  },
};

const worker = (await import(serverEntry)).default;
if (!worker || typeof worker.fetch !== 'function') throw new Error('The packaged website server is incomplete.');

const pending = new Set();
const server = createServer(async (incoming, outgoing) => {
  try {
    const origin = `http://${incoming.headers.host || `${host}:${port}`}`;
    const url = new URL(incoming.url || '/', origin);
    const directAsset = await staticResponse(url.pathname, incoming.method);
    let response = directAsset;
    if (!response) {
      const init = { method: incoming.method, headers: incoming.headers };
      if (incoming.method !== 'GET' && incoming.method !== 'HEAD') {
        init.body = Readable.toWeb(incoming);
        init.duplex = 'half';
      }
      const request = new Request(url, init);
      response = await worker.fetch(request, env, {
        waitUntil(promise) {
          const task = Promise.resolve(promise).catch((error) => console.error('background-task-failed', error)).finally(() => pending.delete(task));
          pending.add(task);
        },
      });
    }

    outgoing.statusCode = response.status;
    outgoing.statusMessage = response.statusText;
    for (const [name, value] of response.headers) outgoing.setHeader(name, value);
    if (typeof response.headers.getSetCookie === 'function') {
      const cookies = response.headers.getSetCookie();
      if (cookies.length) outgoing.setHeader('set-cookie', cookies);
    }
    if (!response.body || incoming.method === 'HEAD') outgoing.end();
    else Readable.fromWeb(response.body).pipe(outgoing);
  } catch (error) {
    console.error('request-failed', error);
    if (!outgoing.headersSent) outgoing.writeHead(500, { 'content-type': 'text/plain; charset=utf-8' });
    outgoing.end('键记暂时无法处理这个请求。');
  }
});

server.listen(port, host, () => {
  console.log(`键记本地服务已启动：http://${host}:${port}/`);
  console.log(`数据目录：${dataDir}`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    server.close();
    await Promise.allSettled([...pending]);
    process.exit(0);
  });
}
