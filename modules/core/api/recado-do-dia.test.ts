import { criarPermissoes, verificarAcao, PERFIS, ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type ContextoBase, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { RecadoDoDiaCorpoSchema } from '../contracts';
import { manifest } from '../manifest';
import { rotasDeNotificacoes } from './notificacoes';

const TENANT = '0a000000-0000-4000-8000-0000000000aa';
const SUP = '0b000000-0000-4000-8000-000000000003';
const V1 = '0b000000-0000-4000-8000-000000000001';
const V2 = '0b000000-0000-4000-8000-000000000002';
const ENVIO = '0e900000-0000-4000-8000-000000000001';
// 01h UTC de 11/11 = 21h de 10/11 em Manaus: o "hoje" do servidor é 2026-11-10
const AGORA = new Date('2026-11-11T01:00:00Z');

type Resposta = [RegExp, unknown[] | { rows?: unknown[]; rowCount: number }];
function fakeDb(respostas: Resposta[]) {
  const chamadas: Array<{ sql: string; valores: readonly unknown[] }> = [];
  const db: ClienteBanco = {
    query: async (sql, valores = []) => {
      chamadas.push({ sql, valores });
      const r = respostas.find(([re]) => re.test(sql));
      if (r && !Array.isArray(r[1])) return { rows: (r[1].rows ?? []) as never[], rowCount: r[1].rowCount };
      const rows = (r?.[1] ?? []) as never[];
      return { rows, rowCount: rows.length };
    },
  };
  return { db, chamadas };
}
const contexto = (db: ClienteBanco, visiveis: ReadonlySet<string> | 'tenant' = new Set([SUP, V1, V2])) =>
  ({
    usuario: { id: SUP, tenant_id: TENANT, perfil: 'supervisor', modulos: ['core'] },
    requestId: 'req',
    agora: () => AGORA,
    fuso: () => 'America/Manaus',
    comTenant: (fn: (d: ClienteBanco, t: TransacaoTenant) => Promise<unknown>) => fn(db, {} as TransacaoTenant),
    usuariosVisiveis: async () => visiveis,
  }) as unknown as ContextoBase;
const rota = (metodo: string): RotaModulo => rotasDeNotificacoes.find((r) => r.caminho === 'notificacoes/envios/:envioId/recado-do-dia' && r.metodo === metodo)!;
const chamar = (metodo: string, ctx: ContextoBase, params: unknown = { envioId: ENVIO }) => {
  const r = rota(metodo);
  return r.executar({ ...ctx, corpo: r.corpo ? r.corpo.parse({}) : {}, query: {}, params: r.params!.parse(params) } as never) as Promise<Record<string, unknown>>;
};
const linhas = (na_janela = true) => [{ id: '0e900000-0000-4000-8000-0000000000a1', usuario_id: V1, na_janela }, { id: '0e900000-0000-4000-8000-0000000000a2', usuario_id: V2, na_janela }];
const auditorias = (c: Array<{ sql: string; valores: readonly unknown[] }>) => c.filter((x) => /insert into plataforma.auditoria/.test(x.sql));

describe('RN-CORE-26: permissão de marcar o recado do dia', () => {
  it('RN-CORE-26: só supervisor e gerente marcam; vendedor, promotor, analista, assistente e admin recebem 403', () => {
    const permissoes = criarPermissoes([manifest]);
    const quem = PERFIS.filter((perfil) => verificarAcao({ id: 'x', tenant_id: TENANT, perfil, modulos: ['core'] }, permissoes, 'notificacao.recado_do_dia').ok);
    expect(quem).toEqual(['supervisor', 'gerente']);
    expect(['PUT', 'DELETE'].map((m) => rota(m).acao)).toEqual(['notificacao.recado_do_dia', 'notificacao.recado_do_dia']);
  });
  it('RN-CORE-26: o corpo é vazio; o servidor decide o dia', () => {
    expect(RecadoDoDiaCorpoSchema.safeParse({ dia: '2026-11-12' }).success).toBe(false);
  });
});

describe('RN-CORE-26: PUT marca o envio como recado do dia de hoje', () => {
  it('RN-CORE-26: grava a data de HOJE no fuso do tenant (10/11 às 21h de Manaus, 11/11 em UTC), a quem marcou, e audita sem texto', async () => {
    const { db, chamadas } = fakeDb([[/from core.notificacao\s+where envio_id/, linhas()], [/set recado_do_dia = null/, { rowCount: 0 }], [/set recado_do_dia = \$2::date/, { rowCount: 2 }]]);
    const r = await chamar('PUT', contexto(db));
    expect(r).toEqual({ envio_id: ENVIO, dia: '2026-11-10', marcadas: 2, desmarcadas_outras: 0 });
    const upd = chamadas.find((c) => /set recado_do_dia = \$2::date/.test(c.sql))!;
    expect(upd.valores).toEqual([linhas().map((l) => l.id), '2026-11-10', SUP]);
    const aud = auditorias(chamadas);
    expect(aud).toHaveLength(1);
    expect(aud[0]!.valores[1]).toBe('notificacao.recado_do_dia');
    expect(JSON.stringify(aud[0]!.valores)).not.toMatch(/titulo|corpo/);
  });
  it('RN-CORE-26: um por pessoa por dia: a marcação de hoje de outro envio sai dos mesmos destinatários ANTES de gravar a nova', async () => {
    const { db, chamadas } = fakeDb([[/from core.notificacao\s+where envio_id/, linhas()], [/set recado_do_dia = null/, { rowCount: 2 }], [/set recado_do_dia = \$2::date/, { rowCount: 2 }]]);
    const r = await chamar('PUT', contexto(db));
    expect(r.desmarcadas_outras).toBe(2);
    const ordem = chamadas.map((c) => (/set recado_do_dia = null/.test(c.sql) ? 'desmarca' : /set recado_do_dia = \$2::date/.test(c.sql) ? 'marca' : '')).filter(Boolean);
    expect(ordem).toEqual(['desmarca', 'marca']);
    const desmarca = chamadas.find((c) => /set recado_do_dia = null/.test(c.sql))!;
    expect(desmarca.valores).toEqual([[V1, V2], '2026-11-10', ENVIO]);
  });
  it('RN-CORE-26: marcar de novo no mesmo dia é idempotente (200, mesmas marcadas, sem nova auditoria)', async () => {
    const { db, chamadas } = fakeDb([[/from core.notificacao\s+where envio_id/, linhas()], [/set recado_do_dia = null/, { rowCount: 0 }], [/set recado_do_dia = \$2::date/, { rowCount: 0 }]]);
    expect(await chamar('PUT', contexto(db))).toEqual({ envio_id: ENVIO, dia: '2026-11-10', marcadas: 2, desmarcadas_outras: 0 });
    expect(auditorias(chamadas)).toHaveLength(0);
  });
  it('RN-CORE-04: o escopo usuariosVisiveis vai à consulta; supervisor não alcança destinatário de outra equipe', async () => {
    const { db, chamadas } = fakeDb([[/from core.notificacao\s+where envio_id/, [linhas()[0]]], [/set recado_do_dia = \$2::date/, { rowCount: 1 }]]);
    const r = await chamar('PUT', contexto(db, new Set([SUP, V1])));
    expect(r.marcadas).toBe(1);
    expect(chamadas[0]!.valores[1]).toEqual([SUP, V1]);
  });
  it('RN-CORE-04: envio fora do escopo (ou de outro tenant) responde 404 RECADO_NAO_ENCONTRADO e não grava nada', async () => {
    const { db, chamadas } = fakeDb([[/from core.notificacao\s+where envio_id/, []]]);
    await expect(chamar('PUT', contexto(db))).rejects.toMatchObject({ codigo: 'RECADO_NAO_ENCONTRADO' });
    await expect(chamar('PUT', contexto(db))).rejects.toBeInstanceOf(ErroNaoEncontrado);
    expect(chamadas.some((c) => /update core.notificacao/.test(c.sql))).toBe(false);
  });
  it('RN-CORE-26: recado criado há mais de 30 dias ou expirado = 422 com codigo RN-CORE-26 e nada é gravado', async () => {
    const { db, chamadas } = fakeDb([[/from core.notificacao\s+where envio_id/, linhas(false)]]);
    const erro = await chamar('PUT', contexto(db)).catch((e) => e);
    expect(erro).toBeInstanceOf(ErroRegraNegocio);
    expect(erro).toMatchObject({ status: 422, codigo: 'RN-CORE-26' });
    expect(erro.message).toContain('antigo demais');
    expect(chamadas.some((c) => /update core.notificacao/.test(c.sql))).toBe(false);
    // a janela é calculada com o relógio da requisição (ctx.agora), não com now()
    expect(chamadas[0]!.valores[2]).toBe(AGORA.toISOString());
  });
  it('RN-CORE-26: a consulta do envio só olha recado vivo (tipo recado, deleted_at nulo)', async () => {
    const { db, chamadas } = fakeDb([[/from core.notificacao\s+where envio_id/, linhas()], [/set recado_do_dia = \$2::date/, { rowCount: 2 }]]);
    await chamar('PUT', contexto(db));
    expect(chamadas[0]!.sql).toMatch(/tipo = 'recado' and deleted_at is null/);
  });
});

describe('RN-CORE-26: DELETE tira o recado do dia', () => {
  it('RN-CORE-26: desmarca as linhas do envio no escopo marcadas hoje e audita', async () => {
    const { db, chamadas } = fakeDb([[/from core.notificacao\s+where envio_id/, linhas()], [/set recado_do_dia = null/, { rowCount: 2 }]]);
    expect(await chamar('DELETE', contexto(db))).toEqual({ envio_id: ENVIO, desmarcadas: 2 });
    expect(chamadas.find((c) => /set recado_do_dia = null/.test(c.sql))!.valores[1]).toBe('2026-11-10');
    expect(auditorias(chamadas)).toHaveLength(1);
  });
  it('RN-CORE-26: desmarcar de novo é idempotente (200 com 0, sem auditoria) e fora do escopo é 404', async () => {
    const { db, chamadas } = fakeDb([[/from core.notificacao\s+where envio_id/, linhas()], [/set recado_do_dia = null/, { rowCount: 0 }]]);
    expect(await chamar('DELETE', contexto(db))).toEqual({ envio_id: ENVIO, desmarcadas: 0 });
    expect(auditorias(chamadas)).toHaveLength(0);
    const vazio = fakeDb([[/from core.notificacao\s+where envio_id/, []]]);
    await expect(chamar('DELETE', contexto(vazio.db))).rejects.toMatchObject({ codigo: 'RECADO_NAO_ENCONTRADO' });
  });
});

describe('RN-CORE-26: SQL do pull e da lista enviada', () => {
  it('RN-CORE-26: o pull de notificacao leva recado_do_dia, autor_nome e autor_perfil (subconsulta em core.usuario)', async () => {
    const { provedoresDeNotificacao } = await import('./notificacoes');
    const prov = provedoresDeNotificacao.find((p) => p.entidade.nome === 'notificacao')!;
    const { db, chamadas } = fakeDb([]);
    await prov.puxar!(contexto(db), { desde: null, ate: AGORA.toISOString(), limite: 10 } as never);
    expect(chamadas[0]!.sql).toMatch(/to_char\(recado_do_dia, 'YYYY-MM-DD'\) as recado_do_dia/);
    expect(chamadas[0]!.sql).toMatch(/as autor_nome/);
    expect(chamadas[0]!.sql).toMatch(/as autor_perfil/);
  });
});
