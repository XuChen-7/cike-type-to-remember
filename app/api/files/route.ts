import { env } from 'cloudflare:workers';
import { NextResponse } from 'next/server';

async function workspaceId(request: Request) {
  const localWorkspaceId = (env as unknown as { LOCAL_WORKSPACE_ID?: string }).LOCAL_WORKSPACE_ID?.trim();
  if (localWorkspaceId) return localWorkspaceId;
  const token = (request.headers.get('cookie') ?? '').split(';').map((part) => part.trim()).find((part) => part.startsWith('cike_workspace='))?.slice('cike_workspace='.length);
  if (!token) return null;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token));
  const hash = Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
  return (await env.DB.prepare('SELECT id FROM workspaces WHERE token_hash = ?').bind(hash).first<{ id: string }>())?.id ?? null;
}

export async function POST(request: Request) {
  const owner = await workspaceId(request);
  if (!owner) return NextResponse.json({ error: '工作区无效，请刷新页面后重试。' }, { status: 401 });
  const data = await request.formData();
  const file = data.get('file');
  if (!(file instanceof File)) return NextResponse.json({ error: '请选择图片。' }, { status: 400 });
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type) || file.size > 5 * 1024 * 1024) return NextResponse.json({ error: '仅支持 5MB 以内的 JPG、PNG 或 WebP。' }, { status: 400 });
  const extension = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : 'jpg';
  const key = `covers/${owner}/${crypto.randomUUID()}.${extension}`;
  await env.FILES.put(key, await file.arrayBuffer(), { httpMetadata: { contentType: file.type, cacheControl: 'public, max-age=31536000, immutable' } });
  return NextResponse.json({ url: `/api/files/${key}` });
}
