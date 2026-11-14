import { NextResponse } from 'next/server';
const attempts = new Map<string, { count: number; until: number }>();
export function guardRequest(request: Request, limit = 30) {
  const origin = request.headers.get('origin');
  if (origin) {
    try {
      const parsedOrigin = new URL(origin);
      const forwardedHost = request.headers.get('x-forwarded-host')?.split(',')[0].trim();
      const effectiveHost = (forwardedHost || request.headers.get('host') || new URL(request.url).host).toLowerCase();
      const forwardedProtocol = request.headers.get('x-forwarded-proto')?.split(',')[0].trim();
      const effectiveProtocol = forwardedProtocol ? `${forwardedProtocol.replace(/:$/, '')}:` : new URL(request.url).protocol;
      if (parsedOrigin.host.toLowerCase() !== effectiveHost || parsedOrigin.protocol !== effectiveProtocol) return NextResponse.json({error:'Cross-origin request rejected.'},{status:403});
    } catch { return NextResponse.json({error:'Cross-origin request rejected.'},{status:403}); }
  }
  if (request.headers.get('sec-fetch-site') === 'cross-site') return NextResponse.json({error:'Cross-site request rejected.'},{status:403});
  const size = Number(request.headers.get('content-length') || 0);
  if (size > 21 * 1024 * 1024) return NextResponse.json({error:'Request too large.'},{status:413});
  const key = new URL(request.url).pathname + ':' + (request.headers.get('x-nf-client-connection-ip') || request.headers.get('x-forwarded-for')?.split(',')[0] || 'local');
  const now = Date.now();
  if (attempts.size > 10000) for (const [k,v] of attempts) if(v.until < now) attempts.delete(k);
  const value = attempts.get(key);
  if (!value || value.until < now) attempts.set(key,{count:1,until:now+60000});
  else { value.count += 1; if(value.count > limit) return NextResponse.json({error:'Too many requests. Try again in a minute.'},{status:429,headers:{'Retry-After':'60'}}); }
  return null;
}
