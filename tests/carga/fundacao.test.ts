/**
 * Carga leve da fundação (cenários S0-110 e S0-111 do plano) — linha de base para a Sprint 9, sem ferramenta extra
 * (autocannon/k6 não estão instalados): a API real escuta numa porta local (HTTP de verdade, não `inject`) e N clientes
 * `fetch` concorrentes alternam tokens de A e de B por `MACUXI_CARGA_SEGUNDOS` (padrão 5 s).
 *
 * - S0-111 (o que REPROVA): toda resposta pertence ao tenant do token (vazamento de contexto no pool sob concorrência)
 *   e nenhuma resposta 5xx.
 * - S0-110 (medida): p95 de `GET /v1/me/modulos` e do pull; a meta do plano é p95 < 300 ms em 50 conexões. O teste só
 *   reprova acima de um teto folgado (8 s: o Postgres no Docker do Windows tem ~3 ms por ida e volta e a suíte inteira
 *   roda em paralelo); os números saem no
 *   console e vão para o relatório. O login fica fora da carga HTTP: o limite de 5/5 min por IP + código da empresa
 *   (desenho T-0004 §3) recusa rajadas do mesmo IP por projeto; a latência do login é medida em série, à parte.
 */
import type { AddressInfo } from 'node:net';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, subirApi, type ApiDeTeste } from '../integracao/apoio/api';

const SEGUNDOS = Number(process.env.MACUXI_CARGA_SEGUNDOS ?? 5);
const CONEXOES = Number(process.env.MACUXI_CARGA_CONEXOES ?? 50);
const TETO_P95_MS = Number(process.env.MACUXI_CARGA_TETO_P95_MS ?? 8000);

const p = (xs: number[], q: number) => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor(q * s.length))] ?? NaN;
};

describe.skipIf(semBanco())('S0-110/S0-111 — carga leve com tokens de A e B alternados (HTTP real, Postgres)', () => {
  let api: ApiDeTeste;
  let base: string;
  const tokens: { tenant: 'A' | 'B'; token: string; prefixo: string }[] = [];

  beforeAll(async () => {
    api = await subirApi({ poolMax: 10 });
    await api.app.listen({ port: 0, host: '127.0.0.1' });
    base = `http://127.0.0.1:${(api.app.server.address() as AddressInfo).port}`;
    tokens.push({ tenant: 'A', token: (await api.sessao('vendedor@exemplo.com.br', A)).access_token, prefixo: 'aaaaaaaa' });
    tokens.push({ tenant: 'B', token: (await api.sessao('vendedor@exemplo.com.br', B)).access_token, prefixo: 'bbbbbbbb' });
    tokens.push({ tenant: 'A', token: (await api.sessao('admin@exemplo.com.br', A)).access_token, prefixo: 'aaaaaaaa' });
    tokens.push({ tenant: 'B', token: (await api.sessao('admin.b@exemplo.com.br', B)).access_token, prefixo: 'bbbbbbbb' });
    await new Promise((r) => setTimeout(r, 2_500)); // horizonte do pull
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it(`${CONEXOES} conexões × ${SEGUNDOS} s: toda resposta é do tenant do token, nenhuma 5xx; p95 medido`, async () => {
    const lat: Record<string, number[]> = { me: [], pull: [], licencas: [] };
    let total = 0;
    const erros: string[] = [];
    const vazamentos: string[] = [];
    const fim = Date.now() + SEGUNDOS * 1000;
    let seq = 0;

    const umaChamada = async () => {
      const n = seq++;
      const t = tokens[n % tokens.length]!;
      const ehAdmin = n % tokens.length >= 2;
      const tipo = ehAdmin ? 'licencas' : n % 3 === 0 ? 'me' : 'pull';
      const url = tipo === 'me' ? '/v1/me/modulos' : tipo === 'pull' ? '/v1/sync/pull?entidade=cliente' : '/v1/core/licencas';
      const t0 = performance.now();
      const r = await fetch(base + url, { headers: { authorization: `Bearer ${t.token}`, 'x-tenant-id': t.tenant === 'A' ? B.tenantId : A.tenantId } });
      const corpo = await r.text();
      lat[tipo]!.push(performance.now() - t0);
      total++;
      if (r.status >= 500 || r.status !== 200) {
        erros.push(`${r.status} ${url}`);
        return;
      }
      const outro = t.prefixo === 'aaaaaaaa' ? 'bbbbbbbb' : 'aaaaaaaa';
      if (tipo === 'pull') {
        const itens = (JSON.parse(corpo) as { itens: { id: string }[] }).itens;
        if (itens.length === 0 || itens.some((i) => !i.id.startsWith(t.prefixo))) vazamentos.push(`${t.tenant} pull: ${itens.map((i) => i.id).join(',')}`);
      } else if (corpo.includes(outro)) {
        vazamentos.push(`${t.tenant} ${url}`);
      }
    };

    await Promise.all(
      Array.from({ length: CONEXOES }, async () => {
        while (Date.now() < fim) await umaChamada();
      }),
    );

    const resumo = Object.fromEntries(Object.entries(lat).map(([k, v]) => [k, { n: v.length, p50: Math.round(p(v, 0.5)), p95: Math.round(p(v, 0.95)), max: Math.round(Math.max(...v)) }]));
    console.info(`[carga] ${total} requisições em ${SEGUNDOS} s (${Math.round(total / SEGUNDOS)} req/s), ${CONEXOES} conexões`, JSON.stringify(resumo));
    expect(vazamentos, 'resposta de outro tenant').toEqual([]);
    expect(erros.slice(0, 5), 'respostas não-200').toEqual([]);
    expect(total).toBeGreaterThan(CONEXOES);
    for (const [k, v] of Object.entries(resumo)) expect(v.p95, `p95 de ${k}`).toBeLessThan(TETO_P95_MS);
  });

  it('S0-110: latência do login (argon2id) em série, 5 logins de IPs distintos', async () => {
    const tempos: number[] = [];
    for (let i = 0; i < 5; i++) {
      const t0 = performance.now();
      const r = await api.entrar('gerente@exemplo.com.br');
      tempos.push(performance.now() - t0);
      expect(r.statusCode).toBe(200);
    }
    console.info(`[carga] login: p50 ${Math.round(p(tempos, 0.5))} ms, max ${Math.round(Math.max(...tempos))} ms`);
    expect(Math.max(...tempos)).toBeLessThan(5_000);
  });
});
