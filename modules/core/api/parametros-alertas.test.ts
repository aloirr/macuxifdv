import { criarPermissoes, verificarAcao, PERFIS, type ClienteBanco, type ContextoBase } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO as PADRAO } from '../contracts';
import { manifest } from '../manifest';
import { rotasDeParametrosAlertas } from './parametros-alertas';
import { rotasDeParametrosJornada } from './parametros-jornada';

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
const achar = (rotas: typeof rotasDeParametrosAlertas, metodo: 'GET' | 'PUT', caminho: string) => rotas.find((r) => r.metodo === metodo && r.caminho === caminho)!;
const chamar = (rota: (typeof rotasDeParametrosAlertas)[number], db: ClienteBanco, corpo?: unknown) => {
  const ctx = {
    usuario: { id: ADMIN, tenant_id: TENANT, perfil: 'admin' },
    requestId: 'req-1',
    comTenant: async (fn: (d: ClienteBanco) => Promise<unknown>) => fn(db),
    corpo: rota.corpo ? rota.corpo.parse(corpo) : {},
    query: {},
    params: {},
  } as unknown as ContextoBase;
  return rota.executar(ctx as never) as Promise<unknown>;
};
const ehAuditoria = (c: { sql: string }) => c.sql.includes('plataforma.auditoria');
const ehEscrita = (c: { sql: string }) => c.sql.includes('plataforma.parametro (tenant_id');
const CAM = 'parametros/alertas-produtividade';
const PARADO = 'parametros/parado-min';
const alertasGet = achar(rotasDeParametrosAlertas, 'GET', CAM);
const alertasPut = achar(rotasDeParametrosAlertas, 'PUT', CAM);
const paradoGet = achar(rotasDeParametrosAlertas, 'GET', PARADO);
const paradoPut = achar(rotasDeParametrosAlertas, 'PUT', PARADO);

describe('RN-CORE-26 (T-0180): permissão e licença dos parâmetros de alertas', () => {
  it('RN-CORE-26: só analista e admin têm parametro.alertas_produtividade; as três rotas usam essa ação', () => {
    const permissoes = criarPermissoes([manifest]);
    const quem = PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos: ['core'] }, permissoes, 'parametro.alertas_produtividade').ok);
    expect(quem).toEqual(['analista', 'admin']);
    expect(rotasDeParametrosAlertas.map((r) => `${r.metodo} ${r.caminho} ${r.acao}`)).toEqual([
      `GET ${CAM} parametro.alertas_produtividade`,
      `PUT ${CAM} parametro.alertas_produtividade`,
      `GET ${PARADO} parametro.alertas_produtividade`,
      `PUT ${PARADO} parametro.alertas_produtividade`,
    ]);
  });
  it('RN-CORE-03: sem o módulo core licenciado a ação é negada', () => {
    const permissoes = criarPermissoes([manifest]);
    expect(verificarAcao({ id: 'x', tenant_id: TENANT, perfil: 'admin', modulos: [] }, permissoes, 'parametro.alertas_produtividade').ok).toBe(false);
    expect(verificarAcao({ id: 'x', tenant_id: TENANT, perfil: 'admin', modulos: [] }, permissoes, 'parametro.inicio').ok).toBe(false);
  });
});

describe('RN-CORE-26 (D6): GET e PUT alertas-produtividade', () => {
  it('RN-CORE-26: sem linha devolve os padrões D6; a consulta é do tenant da transação (RLS)', async () => {
    const { db, chamadas } = fakeDb([]);
    expect(await chamar(alertasGet, db)).toEqual(PADRAO);
    expect(chamadas[0]!.sql).toContain('tenant_id = plataforma.tenant_atual()');
    expect(chamadas[0]!.valores).toEqual([['alertas.produtividade']]);
  });
  it('RN-AUD-01: grava e audita antes/depois quando algo muda; repetir o mesmo valor não grava nem audita (idempotente)', async () => {
    const novo = { ...PADRAO, teto_lembretes_dia: 3 };
    const a = fakeDb([]);
    expect(await chamar(alertasPut, a.db, novo)).toEqual(novo);
    expect(a.chamadas.filter(ehEscrita)).toHaveLength(1);
    expect(a.chamadas.filter(ehEscrita)[0]!.sql).toContain('plataforma.tenant_atual()');
    const aud = a.chamadas.filter(ehAuditoria);
    expect(aud).toHaveLength(1);
    expect(aud[0]!.valores[1]).toBe('parametro.alertas_produtividade');
    expect(JSON.parse(aud[0]!.valores[4] as string)).toEqual(PADRAO);
    expect(JSON.parse(aud[0]!.valores[5] as string)).toEqual(novo);
    const b = fakeDb([{ modulo: 'core', chave: 'alertas.produtividade', valor: novo }]);
    await chamar(alertasPut, b.db, novo);
    expect(b.chamadas.filter(ehEscrita)).toHaveLength(0);
    expect(b.chamadas.filter(ehAuditoria)).toHaveLength(0);
  });
  it('RN-CORE-26: faixa fora do limite é recusada pela regra (com a mensagem dela, no campo certo) e nada é gravado', async () => {
    const { db, chamadas } = fakeDb([]);
    await expect(chamar(alertasPut, db, { ...PADRAO, envio_pendente: { ...PADRAO.envio_pendente, apos_h: 99 } })).rejects.toMatchObject({
      codigo: 'RN-CORE-26',
      detalhes: { erros: [{ campo: 'envio_pendente', mensagem: 'Envio pendente: informe de 1 a 48 horas.' }] },
    });
    expect(chamadas).toHaveLength(0);
  });
  it('RN-CORE-26: corpo com campo extra (o parado não mora aqui) é recusado pelo schema', () => {
    const { db } = fakeDb([]);
    expect(() => chamar(alertasPut, db, { ...PADRAO, parado_min: 60 })).toThrow();
  });
});

describe('RN-CORE-26 (D1): GET parametros/parado-min lê pela mesma ação da gravação', () => {
  it('RN-CORE-26: sem linha devolve 60; com linha devolve o valor do tenant da transação (RLS)', async () => {
    const a = fakeDb([]);
    expect(await chamar(paradoGet, a.db)).toEqual({ parado_min: 60 });
    expect(a.chamadas[0]!.sql).toContain('tenant_id = plataforma.tenant_atual()');
    const b = fakeDb([{ modulo: 'core', chave: 'inicio.parado_min', valor: 45 }]);
    expect(await chamar(paradoGet, b.db)).toEqual({ parado_min: 45 });
  });
  it('RN-CORE-26: perfil sem parametro.alertas_produtividade recebe 403, mesmo com parametro.inicio', () => {
    const permissoes = criarPermissoes([manifest]);
    const sem = PERFIS.find((p) => !verificarAcao({ id: 'x', tenant_id: TENANT, perfil: p, modulos: ['core'] }, permissoes, 'parametro.alertas_produtividade').ok)!;
    const r = verificarAcao({ id: 'x', tenant_id: TENANT, perfil: sem, modulos: ['core'] }, permissoes, paradoGet.acao!);
    expect(r.ok).toBe(false);
    expect(r).toMatchObject({ status: 403 });
  });
  it('RN-CORE-03: sem o módulo core licenciado a leitura é negada', () => {
    const permissoes = criarPermissoes([manifest]);
    expect(verificarAcao({ id: 'x', tenant_id: TENANT, perfil: 'admin', modulos: [] }, permissoes, paradoGet.acao!).ok).toBe(false);
  });
});

describe('RN-CORE-26 (D1): PUT parametros/parado-min grava inicio.parado_min', () => {
  it('RN-CORE-26: grava no mesmo lugar do Início (inicio.parado_min) e audita; valor igual não audita', async () => {
    const a = fakeDb([]);
    expect(await chamar(paradoPut, a.db, { parado_min: 45 })).toEqual({ parado_min: 45 });
    expect(a.chamadas.filter(ehEscrita)[0]!.valores).toEqual(['inicio.parado_min', '45']);
    expect(a.chamadas.filter(ehAuditoria)).toHaveLength(1);
    const b = fakeDb([{ modulo: 'core', chave: 'inicio.parado_min', valor: 45 }]);
    await chamar(paradoPut, b.db, { parado_min: 45 });
    expect(b.chamadas.filter(ehEscrita)).toHaveLength(0);
    expect(b.chamadas.filter(ehAuditoria)).toHaveLength(0);
  });
  it('RN-CORE-26: fora de 15 a 480 é 422 e nada é gravado', async () => {
    const { db, chamadas } = fakeDb([]);
    await expect(chamar(paradoPut, db, { parado_min: 10 })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-26' });
    expect(chamadas).toHaveLength(0);
  });
});

describe('RN-CORE-44 (D5): GET e PUT parametros/jornada (almoço padrão da empresa)', () => {
  const get = achar(rotasDeParametrosJornada, 'GET', 'parametros/jornada');
  const put = achar(rotasDeParametrosJornada, 'PUT', 'parametros/jornada');
  it('RN-CORE-44: sem linha o padrão é 12:00 às 13:00 (720 e 780), do tenant da transação', async () => {
    const { db, chamadas } = fakeDb([]);
    expect(await chamar(get, db)).toEqual({ almoco_padrao: { inicio_min: 720, fim_min: 780 } });
    expect(chamadas[0]!.sql).toContain('tenant_id = plataforma.tenant_atual()');
  });
  it('RN-AUD-01: grava e audita; idempotente', async () => {
    const corpo = { almoco_padrao: { inicio_min: 690, fim_min: 750 } };
    const a = fakeDb([]);
    expect(await chamar(put, a.db, corpo)).toEqual(corpo);
    expect(a.chamadas.filter(ehEscrita)[0]!.valores).toEqual(['jornada.almoco_padrao', JSON.stringify(corpo.almoco_padrao)]);
    expect(a.chamadas.filter(ehAuditoria)).toHaveLength(1);
    const b = fakeDb([{ modulo: 'core', chave: 'jornada.almoco_padrao', valor: corpo.almoco_padrao }]);
    await chamar(put, b.db, corpo);
    expect(b.chamadas.filter(ehEscrita)).toHaveLength(0);
  });
  it('RN-CORE-44: fim antes do início ou duração fora de 15 min a 3 h é 422 no campo certo', async () => {
    const { db, chamadas } = fakeDb([]);
    await expect(chamar(put, db, { almoco_padrao: { inicio_min: 780, fim_min: 720 } })).rejects.toMatchObject({ status: 422, codigo: 'RN-CORE-44', detalhes: { erros: [{ campo: 'almoco_fim' }] } });
    await expect(chamar(put, db, { almoco_padrao: { inicio_min: 720, fim_min: 725 } })).rejects.toMatchObject({ status: 422 });
    expect(chamadas).toHaveLength(0);
  });
});
