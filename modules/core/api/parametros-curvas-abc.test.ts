import { criarPermissoes, verificarAcao, PERFIS, type ClienteBanco, type ContextoBase } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { rotasDeParametrosCurvaAbc } from './parametros-curvas-abc';

const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const ADMIN = '0b000000-0000-4000-8000-000000000009';

type Linha = { modulo: string; chave: string; valor: unknown };
function fakeDb(linhas: Linha[]) {
  const chamadas: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const db: ClienteBanco = {
    query: async (sql, valores = []) => {
      chamadas.push({ sql, valores });
      const rows = (/^\s*select/i.test(sql) ? linhas : []) as never[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, chamadas };
}
const rota = (metodo: 'GET' | 'PUT') => rotasDeParametrosCurvaAbc.find((r) => r.metodo === metodo)!;
const chamar = (metodo: 'GET' | 'PUT', db: ClienteBanco, corpo?: unknown) => {
  const r = rota(metodo);
  const ctx = {
    usuario: { id: ADMIN, tenant_id: TENANT, perfil: 'admin' },
    requestId: 'req-1',
    comTenant: async (fn: (d: ClienteBanco) => Promise<unknown>) => fn(db),
    corpo: r.corpo ? r.corpo.parse(corpo) : {},
    query: {},
    params: {},
  } as unknown as ContextoBase;
  return r.executar(ctx as never) as Promise<unknown>;
};
const F = { a_min_pct: 20, b_min_pct: 0 };
const padrao = { faturamento: F, volume: F, frequencia: F };
const novo = { faturamento: { a_min_pct: 30, b_min_pct: 5 }, volume: F, frequencia: { a_min_pct: 10, b_min_pct: -20 } };
const ehAuditoria = (c: { sql: string }) => c.sql.includes('plataforma.auditoria');
const ehEscrita = (c: { sql: string }) => c.sql.includes('plataforma.parametro (tenant_id');

describe('RN-CORE-49: permissões de parametros/curvas-abc', () => {
  it('RN-CORE-49: só analista e admin têm a ação parametro.curva_abc; as duas rotas usam essa ação', () => {
    const permissoes = criarPermissoes([manifest]);
    const quem = PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos: ['core'] }, permissoes, 'parametro.curva_abc').ok);
    expect(quem).toEqual(['analista', 'admin']);
    expect(rotasDeParametrosCurvaAbc.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`)).toEqual(['GET parametros/curvas-abc parametro.curva_abc', 'PUT parametros/curvas-abc parametro.curva_abc']);
  });
  it('RN-CORE-49: sem o módulo core licenciado a ação é negada', () => {
    const permissoes = criarPermissoes([manifest]);
    expect(verificarAcao({ id: 'x', tenant_id: TENANT, perfil: 'admin', modulos: [] }, permissoes, 'parametro.curva_abc').ok).toBe(false);
  });
});

describe('RN-CORE-49: GET parametros/curvas-abc', () => {
  it('RN-CORE-49: sem linha devolve o padrão das 3 dimensões; consulta do tenant da transação', async () => {
    const { db, chamadas } = fakeDb([]);
    expect(await chamar('GET', db)).toEqual(padrao);
    expect(chamadas[0]!.sql).toContain('tenant_id = plataforma.tenant_atual()');
  });
  it('RN-CORE-49: devolve o valor gravado e cai no padrão só na dimensão inválida', async () => {
    const { db } = fakeDb([
      { modulo: 'core', chave: 'cliente.curva_abc.faturamento', valor: novo.faturamento },
      { modulo: 'core', chave: 'cliente.curva_abc.frequencia', valor: { a_min_pct: 1, b_min_pct: 1 } },
    ]);
    expect(await chamar('GET', db)).toEqual({ ...padrao, faturamento: novo.faturamento });
  });
});

describe('RN-CORE-49 / RN-AUD-01: PUT parametros/curvas-abc', () => {
  it('RN-AUD-01: grava as 3 chaves e audita antes/depois quando algo muda', async () => {
    const { db, chamadas } = fakeDb([]);
    expect(await chamar('PUT', db, novo)).toEqual(novo);
    expect(chamadas.filter(ehEscrita)).toHaveLength(3);
    expect(chamadas.filter(ehEscrita).every((c) => c.sql.includes('plataforma.tenant_atual()'))).toBe(true);
    const aud = chamadas.filter(ehAuditoria);
    expect(aud).toHaveLength(1);
    expect(aud[0]!.valores[1]).toBe('parametro.curva_abc');
    expect(JSON.parse(aud[0]!.valores[4] as string)).toEqual(padrao);
    expect(JSON.parse(aud[0]!.valores[5] as string)).toEqual(novo);
  });
  it('RN-AUD-01: repetir o mesmo valor não audita de novo (idempotente)', async () => {
    const { db, chamadas } = fakeDb([
      { modulo: 'core', chave: 'cliente.curva_abc.faturamento', valor: novo.faturamento },
      { modulo: 'core', chave: 'cliente.curva_abc.frequencia', valor: novo.frequencia },
    ]);
    await chamar('PUT', db, novo);
    expect(chamadas.filter(ehAuditoria)).toHaveLength(0);
  });
  it('RN-CORE-49: a API revalida: A ≤ B vira 422 em português com o campo e nada é gravado', async () => {
    const { db, chamadas } = fakeDb([]);
    await expect(chamar('PUT', db, { ...novo, volume: { a_min_pct: 0, b_min_pct: 10 } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-49', detalhes: { erros: [{ campo: 'volume.a_min_pct', mensagem: expect.stringContaining('Aumente') }] } });
    await expect(chamar('PUT', db, { ...novo, volume: { a_min_pct: 5000, b_min_pct: 0 } })).rejects.toMatchObject({ status: 422 });
    expect(chamadas).toHaveLength(0);
  });
  it('RN-CORE-49: corpo com campo extra ou dimensão faltando é recusado pelo schema', () => {
    const { db } = fakeDb([]);
    expect(() => chamar('PUT', db, { ...novo, extra: 1 })).toThrow();
    expect(() => chamar('PUT', db, { faturamento: F, volume: F })).toThrow();
  });
});
