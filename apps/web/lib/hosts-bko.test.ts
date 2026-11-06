/**
 * T-0038: o BKO aceita rodar atrás de `bko-demo.macuxifdv.com.br` (host e origem permitidos no Next) e, no modo de
 * reserva do túnel, da origem informada em `MACUXI_BKO_ORIGEM` pelo scripts/demo.
 * T-0086: produção em `bko.macuxifdv.com.br` e `config.macuxifdv.com.br` (fixos); `MACUXI_BKO_ORIGEM` aceita lista.
 */
import { describe, expect, it } from 'vitest';

import nextConfig, { hostDaOrigem, hostsDoBko } from '../next.config';

const FIXOS = ['bko-demo.macuxifdv.com.br', 'bko.macuxifdv.com.br', 'config.macuxifdv.com.br'];

describe('hosts do BKO atrás do túnel (T-0038, T-0086)', () => {
  it('demo e produção (bko. e config.) sempre permitidos', () => {
    expect(hostsDoBko(undefined)).toEqual(FIXOS);
    expect(hostsDoBko('https://bko-demo.macuxifdv.com.br')).toEqual(FIXOS);
    // build arg do workflow "producao — publicar"
    expect(hostsDoBko('https://bko.macuxifdv.com.br')).toEqual(FIXOS);
  });
  it('MACUXI_BKO_ORIGEM acrescenta o host da origem (ex.: túnel rápido de reserva)', () => {
    expect(hostsDoBko('https://abc-def.trycloudflare.com/')).toEqual([...FIXOS, 'abc-def.trycloudflare.com']);
    expect(hostDaOrigem(' HTTPS://Bko-Demo.MacuxiFDV.com.br:443/login ')).toBe('bko-demo.macuxifdv.com.br');
    expect(hostDaOrigem('http://192.168.0.10:3100')).toBe('192.168.0.10:3100');
    expect(hostDaOrigem('')).toBeNull();
    expect(hostDaOrigem('https://x .com')).toBeNull();
  });
  it('MACUXI_BKO_ORIGEM em lista separada por vírgula; item vazio ou inválido é ignorado', () => {
    expect(hostsDoBko('https://bko.macuxifdv.com.br, https://config.macuxifdv.com.br')).toEqual(FIXOS);
    expect(hostsDoBko('https://a.trycloudflare.com,, https://x .com ,http://192.168.0.10:3100')).toEqual([...FIXOS, 'a.trycloudflare.com', '192.168.0.10:3100']);
  });
  it('next.config: allowedDevOrigins e serverActions.allowedOrigins com demo e produção; /api-proxy segue para a API', async () => {
    for (const h of FIXOS) {
      expect(nextConfig.allowedDevOrigins).toContain(h);
      expect(nextConfig.experimental?.serverActions?.allowedOrigins).toContain(h);
    }
    const rewrites = await (nextConfig.rewrites as () => Promise<{ source: string; destination: string }[]>)();
    expect(rewrites[0]?.source).toBe('/api-proxy/:path*');
    expect(rewrites[0]?.destination).toMatch(/\/v1\/:path\*$/);
  });
});
