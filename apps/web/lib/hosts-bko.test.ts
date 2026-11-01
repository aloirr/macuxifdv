/**
 * T-0038: o BKO aceita rodar atrás de `bko-demo.macuxifdv.com.br` (host e origem permitidos no Next) e, no modo de
 * reserva do túnel, da origem informada em `MACUXI_BKO_ORIGEM` pelo scripts/demo.
 */
import { describe, expect, it } from 'vitest';

import nextConfig, { hostDaOrigem, hostsDoBko } from '../next.config';

describe('hosts do BKO atrás do túnel (T-0038)', () => {
  it('bko-demo.macuxifdv.com.br sempre permitido', () => {
    expect(hostsDoBko(undefined)).toEqual(['bko-demo.macuxifdv.com.br']);
    expect(hostsDoBko('https://bko-demo.macuxifdv.com.br')).toEqual(['bko-demo.macuxifdv.com.br']);
  });
  it('MACUXI_BKO_ORIGEM acrescenta o host da origem (ex.: túnel rápido de reserva)', () => {
    expect(hostsDoBko('https://abc-def.trycloudflare.com/')).toEqual(['bko-demo.macuxifdv.com.br', 'abc-def.trycloudflare.com']);
    expect(hostDaOrigem(' HTTPS://Bko-Demo.MacuxiFDV.com.br:443/login ')).toBe('bko-demo.macuxifdv.com.br');
    expect(hostDaOrigem('http://192.168.0.10:3100')).toBe('192.168.0.10:3100');
    expect(hostDaOrigem('')).toBeNull();
    expect(hostDaOrigem('https://x .com')).toBeNull();
  });
  it('next.config: allowedDevOrigins e serverActions.allowedOrigins com o bko-demo; /api-proxy segue para a API', async () => {
    expect(nextConfig.allowedDevOrigins).toContain('bko-demo.macuxifdv.com.br');
    expect(nextConfig.experimental?.serverActions?.allowedOrigins).toContain('bko-demo.macuxifdv.com.br');
    const rewrites = await (nextConfig.rewrites as () => Promise<{ source: string; destination: string }[]>)();
    expect(rewrites[0]?.source).toBe('/api-proxy/:path*');
    expect(rewrites[0]?.destination).toMatch(/\/v1\/:path\*$/);
  });
});
