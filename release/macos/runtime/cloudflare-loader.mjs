const shimUrl = new URL('./cloudflare-shim.mjs', import.meta.url).href;

export async function resolve(specifier, context, nextResolve) {
  if (specifier === 'cloudflare:workers') return { url: shimUrl, shortCircuit: true };
  return nextResolve(specifier, context);
}
