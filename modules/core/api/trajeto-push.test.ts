/**
 * Push do rastreamento sem banco (T-0156): o portão por ponto, o descarte que não trava a fila, a lista das entidades e o SQL do pull. O comportamento sobre dados reais está em `trajeto.db.test.ts`.
 * RN-CORE-13 (portão), RN-CORE-37 (permissão), RN-CORE-46 (km do dia).
 */
import type { ClienteBanco, ContextoBase, ItemPush } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../contracts';
import { sqlDoPull } from './sync';
import { provedoresSyncTrajeto, TABELAS_SYNC_TRAJETO } from './sync-trajeto';
import { receberPontosTrajeto } from './trajeto-push';

const U = '0e300000-0000-4000-8000-000000000001';
const idn = (n: number) => `0e300000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
// quinta-feira, 19/11/2026, 10h30 de Manaus
const AGORA = new Date('2026-11-19T14:30:00.000Z');

interface Cenario {
  ativo?: boolean;
  ausencias?: Array<{ de: string; ate: string }>;
}
function ctxFalso(c: Cenario = {}, perfil = 'vendedor') {
  const sqls: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const logs: unknown[] = [];
  const param = { ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: c.ativo ?? true };
  const db = {
    query: async (sql: string, valores: readonly unknown[] = []) => {
      sqls.push({ sql, valores });
      if (/from plataforma\.parametro/.test(sql)) return { rows: [{ modulo: 'core', chave: 'rastreamento', valor: param }], rowCount: 1 };
      if (/from core\.ausencia_usuario/.test(sql)) return { rows: c.ausencias ?? [], rowCount: (c.ausencias ?? []).length };
      if (/from core\.ponto_trajeto/.test(sql)) return { rows: [], rowCount: 0 };
      return { rows: [], rowCount: 1 };
    },
  } as unknown as ClienteBanco;
  const ctx = {
    usuario: { id: U, tenant_id: 't', perfil },
    agora: () => AGORA,
    fuso: () => 'America/Manaus',
    log: { info: (o: unknown) => logs.push(o), warn: () => undefined, error: () => undefined },
    comTenant: async (fn: (d: ClienteBanco, tx: unknown) => Promise<unknown>) => fn(db, {}),
  } as unknown as ContextoBase;
  return { ctx, sqls, logs };
}
const ponto = (n: number, extra: Record<string, unknown> = {}) => ({ id: idn(n), capturado_em: '2026-11-19T14:00:00.000Z', latitude: -3.1, longitude: -60.02, precisao_m: 12, velocidade_ms: null, ...extra });
const item = (p: { id: string } & Record<string, unknown>, operacao: 'criar' | 'remover' = 'criar'): ItemPush => ({ id: p.id, operacao, payload: p }) as unknown as ItemPush;
const inserts = (s: ReturnType<typeof ctxFalso>, tabela: string) => s.sqls.filter((x) => new RegExp(`^\\s*insert into core\\.${tabela}`).test(x.sql));

describe('RN-CORE-13: push de ponto_trajeto', () => {
  it('RN-CORE-13: dentro do portão, grava os pontos num insert só e recalcula o resumo do dia', async () => {
    const s = ctxFalso();
    const r = await receberPontosTrajeto(s.ctx, [item(ponto(1)), item(ponto(2, { capturado_em: '2026-11-19T14:10:00.000Z' }))]);
    expect(r).toEqual([{ id: idn(1), status: 'aceito' }, { id: idn(2), status: 'aceito' }]);
    const ins = inserts(s, 'ponto_trajeto');
    expect(ins).toHaveLength(1);
    expect(ins[0]!.sql).toContain('on conflict (id) do nothing');
    expect(ins[0]!.valores[0]).toBe(U);
    expect(ins[0]!.valores[1]).toEqual([idn(1), idn(2)]);
    const resumo = inserts(s, 'deslocamento_dia');
    expect(resumo).toHaveLength(1);
    expect(resumo[0]!.valores.slice(0, 2)).toEqual([U, '2026-11-19']);
    expect(resumo[0]!.sql).toContain("'rastreamento'");
  });

  it('RN-CORE-13: ponto fora do portão é descartado sem gravar e a fila segue (resposta aceito)', async () => {
    const casos: Array<[string, Cenario]> = [
      ['tracking desligado', { ativo: false }],
      ['ausência cadastrada', { ausencias: [{ de: '2026-11-19', ate: '2026-11-19' }] }],
    ];
    for (const [nome, c] of casos) {
      const s = ctxFalso(c);
      const r = await receberPontosTrajeto(s.ctx, [item(ponto(1))]);
      expect(r, nome).toEqual([{ id: idn(1), status: 'aceito' }]);
      expect(inserts(s, 'ponto_trajeto'), nome).toHaveLength(0);
      expect(inserts(s, 'deslocamento_dia'), nome).toHaveLength(0);
      expect(JSON.stringify(s.logs), nome).not.toContain('-3.1');
    }
  });

  it('RN-CORE-13: gerente (não é de campo), futuro > 5 min e mais de 90 dias são descartados; o resto do lote passa', async () => {
    const s = ctxFalso({}, 'gerente');
    await receberPontosTrajeto(s.ctx, [item(ponto(1))]);
    expect(inserts(s, 'ponto_trajeto')).toHaveLength(0);
    const v = ctxFalso();
    await receberPontosTrajeto(v.ctx, [item(ponto(1, { capturado_em: '2026-11-19T14:40:00.000Z' })), item(ponto(2, { capturado_em: '2026-08-01T14:00:00.000Z' })), item(ponto(3))]);
    expect(inserts(v, 'ponto_trajeto')[0]!.valores[1]).toEqual([idn(3)]);
  });

  it('RN-CORE-13: payload inválido ou remoção é rejeitado só naquele item; sem coordenada na mensagem', async () => {
    const s = ctxFalso();
    const r = await receberPontosTrajeto(s.ctx, [item(ponto(1, { latitude: 200 })), item(ponto(2), 'remover'), item(ponto(3))]);
    expect(r[0]).toMatchObject({ id: idn(1), status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO' });
    expect(r[1]).toMatchObject({ id: idn(2), status: 'rejeitado', codigo: 'OPERACAO_NAO_SUPORTADA' });
    expect(r[2]).toEqual({ id: idn(3), status: 'aceito' });
    expect(JSON.stringify(r)).not.toContain('200');
  });
});

describe('entidades e pull do rastreamento', () => {
  const por = (n: string) => provedoresSyncTrajeto.find((p) => p.entidade.nome === n)!;
  it('RN-CORE-13: ponto só de envio e ausência só de leitura, no padrão do motor', () => {
    expect(provedoresSyncTrajeto.map((p) => p.entidade.nome)).toEqual(['ponto_trajeto', 'ausencia_usuario']);
    expect(por('ponto_trajeto').entidade).toMatchObject({ direcao: 'push', conflito: 'somente_insercao', modulo: 'core' });
    expect(por('ponto_trajeto').puxar).toBeUndefined();
    expect(por('ausencia_usuario')).toMatchObject({ escopo: 'proprio', entidade: { direcao: 'pull' } });
  });
  it('RN-CORE-13: o pull da ausência filtra o usuário', () => {
    const pedido = { desde: null, ate: '2026-11-19T15:00:00.000Z', limite: 100 };
    expect(sqlDoPull(TABELAS_SYNC_TRAJETO.ausencia_usuario, pedido, new Set([U]), '2026-11-19').sql).toContain('and usuario_id = any($5::uuid[])');
  });
});
