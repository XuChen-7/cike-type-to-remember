import { env } from 'cloudflare:workers';

async function workspaceId(request: Request) {
  const localWorkspaceId = (env as unknown as { LOCAL_WORKSPACE_ID?: string }).LOCAL_WORKSPACE_ID?.trim();
  if (localWorkspaceId) return localWorkspaceId;
  const token = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('cike_workspace='))?.slice('cike_workspace='.length);
  if (!token) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return (await env.DB.prepare('SELECT id FROM workspaces WHERE token_hash = ?').bind(hash).first<{ id: string }>())?.id ?? null;
}

export async function GET(request: Request, context: { params: Promise<{ key: string[] }> }) {
  const owner = await workspaceId(request);
  if (!owner) return new Response('Not found', { status: 404 });
  const { key: parts } = await context.params;
  const key = parts.join('/');
  if (!key.startsWith(`covers/${owner}/`)) return new Response('Not found', { status: 404 });
  const object = await env.FILES.get(key);
  if (!object) return new Response('Not found', { status: 404 });
  const headers = new Headers();
  object.writeHttpMetadata(headers);
  headers.set('etag', object.httpEtag);
  return new Response(object.body, { headers });
}
