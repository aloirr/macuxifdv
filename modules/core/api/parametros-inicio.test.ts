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
const valido = { dias_uteis_semana: [1, 2, 3, 4, 5] };
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
    expect(await chamar('GET', db)).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5, 6], parado_min: 60 });
    expect(chamadas[0]!.sql).toContain('tenant_id = plataforma.tenant_atual()');
  });
  it('RN-CORE-26: devolve o valor gravado do tenant', async () => {
    const { db } = fakeDb([
      { modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1, 2, 3, 4, 5] },
      { modulo: 'core', chave: 'inicio.parado_min', valor: 45 },
    ]);
    expect(await chamar('GET', db)).toEqual({ ...valido, parado_min: 45 });
  });
});

describe('RN-CORE-26 / RN-AUD-01: PUT parametros/inicio', () => {
  it('RN-AUD-01: grava só os dias úteis, audita antes/depois e devolve o parado já salvo (RD-0334)', async () => {
    const { db, chamadas } = fakeDb([{ modulo: 'core', chave: 'inicio.parado_min', valor: 45 }]);
    expect(await chamar('PUT', db, { dias_uteis_semana: [5, 1, 2, 3, 4] })).toEqual({ ...valido, parado_min: 45 });
    const escritas = chamadas.filter(ehEscrita);
    expect(escritas).toHaveLength(1);
    expect(escritas[0]!.valores[0]).toBe('metas.dias_uteis_semana');
    expect(escritas[0]!.sql).toContain('plataforma.tenant_atual()');
    const aud = chamadas.filter(ehAuditoria);
    expect(aud).toHaveLength(1);
    expect(aud[0]!.valores[1]).toBe('parametro.inicio');
    expect(JSON.parse(aud[0]!.valores[4] as string)).toEqual({ dias_uteis_semana: [1, 2, 3, 4, 5, 6] });
    expect(JSON.parse(aud[0]!.valores[5] as string)).toEqual(valido);
  });
  it('RN-AUD-01: repetir o mesmo valor não grava nem audita de novo (idempotente)', async () => {
    const { db, chamadas } = fakeDb([{ modulo: 'core', chave: 'metas.dias_uteis_semana', valor: [1, 2, 3, 4, 5] }]);
    await chamar('PUT', db, valido);
    expect(chamadas.filter(ehEscrita)).toHaveLength(0);
    expect(chamadas.filter(ehAuditoria)).toHaveLength(0);
  });
  it('RN-CORE-26: a API revalida: dia fora de 0 a 6 vira 422 em português e nada é gravado', async () => {
    const { db, chamadas } = fakeDb([]);
    await expect(chamar('PUT', db, { dias_uteis_semana: [] })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-26', detalhes: { erros: [{ campo: 'dias_uteis_semana' }] } });
    expect(chamadas).toHaveLength(0);
  });
  it('RN-CORE-26 (RD-0334): o parado_min não é mais aceito aqui (só em PUT parametros/parado-min); campo extra também é recusado', () => {
    const { db } = fakeDb([]);
    expect(() => chamar('PUT', db, { ...valido, parado_min: 45 })).toThrow();
    expect(() => chamar('PUT', db, { ...valido, extra: 1 })).toThrow();
  });
  it('RN-CORE-26 (D2, 13/11): a frase padrão do recado do dia saiu; o campo recado_do_dia_padrao é recusado', () => {
    const { db } = fakeDb([]);
    expect(() => chamar('PUT', db, { ...valido, recado_do_dia_padrao: 'Vamos vender!' })).toThrow();
  });
});
