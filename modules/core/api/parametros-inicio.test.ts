import { criarPermissoes, verificarAcao, PERFIS, type ClienteBanco, type ContextoBase } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { manifest } from '../manifest';
import { rotasDeParametrosInicio } from './parametros-inicio';

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
const rota = (metodo: 'GET' | 'PUT') => rotasDeParametrosInicio.find((r) => r.metodo === metodo)!;
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
const valido = { dias_uteis_semana: [1, 2, 3, 4, 5], recado_do_dia_padrao: 'Vamos vender!', parado_min: 45 };
const ehAuditoria = (c: { sql: string }) => c.sql.includes('plataforma.auditoria');
const ehEscrita = (c: { sql: string }) => c.sql.includes('plataforma.parametro (tenant_id');

describe('RN-CORE-26: permissões de parametros/inicio', () => {
  it('RN-CORE-26: só analista e admin têm a ação parametro.inicio; as duas rotas usam essa ação', () => {
    const permissoes = criarPermissoes([manifest]);
    const quem = PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos: ['core'] }, permissoes, 'parametro.inicio').ok);
    expect(quem).toEqual(['analista', 'admin']);
    expect(rotasDeParametrosInicio.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`)).toEqual(['GET parametros/inicio parametro.inicio', 'PUT parametros/inicio parametro.inicio']);
  });
  it('RN-CORE-26: sem o módulo core licenciado a ação é negada', () => {
    const permissoes = criarPermissoes([manifest]);
    expect(verificarAcao({ id: 'x', tenant_id: TENANT, perfil: 'admin', modulos: [] }, permissoes, 'parametro.inicio').ok).toBe(false);
  });
});

describe('RN-CORE-26: GET parametros/inicio', () => {
  it('RN-CORE-26: sem linha devolve os padrões; a consulta é do tenant da transação', async () => {
    const { db, chamadas } = fakeDb([]);
    expect(await chamar('GET', db)).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5, 6], recado_do_dia_padrao: 'Bom trabalho hoje!', parado_min: 60 });
    expect(chamadas[0]!.sql).toContain('tenant_id = plataforma.tenant_atual()');
  });
  it('RN-CORE-26: devolve o valor gravado do tenant', async () => {
    const { db } = fakeDb([
      { modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1, 2, 3, 4, 5] },
      { modulo: 'core', chave: 'inicio.recado_do_dia_padrao', valor: 'Vamos vender!' },
      { modulo: 'core', chave: 'inicio.parado_min', valor: 45 },
    ]);
    expect(await chamar('GET', db)).toEqual(valido);
  });
});

describe('RN-CORE-26 / RN-AUD-01: PUT parametros/inicio', () => {
  it('RN-AUD-01: grava as três chaves e audita antes/depois quando algo muda', async () => {
    const { db, chamadas } = fakeDb([]);
    expect(await chamar('PUT', db, { ...valido, dias_uteis_semana: [5, 1, 2, 3, 4] })).toEqual(valido);
    expect(chamadas.filter(ehEscrita)).toHaveLength(3);
    expect(chamadas.filter(ehEscrita).every((c) => c.sql.includes('plataforma.tenant_atual()'))).toBe(true);
    const aud = chamadas.filter(ehAuditoria);
    expect(aud).toHaveLength(1);
    expect(aud[0]!.valores[1]).toBe('parametro.inicio');
    expect(JSON.parse(aud[0]!.valores[4] as string)).toMatchObject({ parado_min: 60 });
    expect(JSON.parse(aud[0]!.valores[5] as string)).toEqual(valido);
  });
  it('RN-AUD-01: repetir o mesmo valor não audita de novo (idempotente)', async () => {
    const { db, chamadas } = fakeDb([
      { modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1, 2, 3, 4, 5] },
      { modulo: 'core', chave: 'inicio.recado_do_dia_padrao', valor: 'Vamos vender!' },
      { modulo: 'core', chave: 'inicio.parado_min', valor: 45 },
    ]);
    await chamar('PUT', db, valido);
    expect(chamadas.filter(ehAuditoria)).toHaveLength(0);
  });
  it('RN-CORE-26: a API revalida: valor fora da faixa vira 422 em português e nada é gravado', async () => {
    const { db, chamadas } = fakeDb([]);
    await expect(chamar('PUT', db, { ...valido, parado_min: 5 })).rejects.toMatchObject({ status: 422, codigo: 'PARAMETROS_INICIO_INVALIDOS' });
    await expect(chamar('PUT', db, { ...valido, dias_uteis_semana: [] })).rejects.toMatchObject({ status: 422 });
    expect(chamadas).toHaveLength(0);
  });
  it('RN-CORE-26: corpo com campo extra é recusado pelo schema', () => {
    const { db } = fakeDb([]);
    expect(() => chamar('PUT', db, { ...valido, extra: 1 })).toThrow();
  });
});
