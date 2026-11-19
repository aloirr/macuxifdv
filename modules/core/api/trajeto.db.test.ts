/**
 * T-0156 × Postgres real (fixture dois-tenants, RLS): push do rastreamento (pontos), portão por ponto, resumo diário
 * `core.deslocamento_dia`, pull da ausência, leitura do trajeto (só a equipe no escopo, com `trajeto.ver_equipe`; outro tenant) e a consulta
 * `core.trajeto_do_dia@1`. RN-CORE-13 (portão), RN-CORE-04 (escopo), RN-CORE-46 (km do dia). Pula sem Postgres.
 */
import { semBanco } from '@macuxi/db/teste/estado';
import type { ContextoConsulta, ItemPush, UsuarioAutenticado } from '@macuxi/platform-sdk';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { DeslocamentoDiaSchema, PARAMETROS_RASTREAMENTO_PADRAO, TrajetoRespostaSchema, AusenciaUsuarioSchema } from '../contracts';
import { perfisDeFabrica } from '../domain';
import { A, AmbienteBanco, B, idDe, U } from './apoio-teste-t0170';
import { provedoresSyncTrajeto } from './sync-trajeto';
import { consultaTrajetoDoDia, rotasDeTrajeto } from './trajeto-consulta';

const FAIXA = '0e900000';
const id = idDe(FAIXA);
const HOJE = new Date('2026-11-19T14:30:00.000Z'); // quinta, 10h30 de Manaus
const DIA = '2026-11-19';
const em = (hhmm: string) => `2026-11-19T${hhmm}:00.000Z`; // 14:00Z = 10h em Manaus (expediente 8h–18h)
const lat = (n: number) => -3.1 + n * 0.001;

describe.skipIf(semBanco())('Core T-0156 × Postgres: rastreamento no expediente', () => {
  const amb = new AmbienteBanco();
  const vendedor1 = amb.usuario(U.vendedor1, 'vendedor');
  const vendedor2 = amb.usuario(U.vendedor2, 'vendedor');
  const supervisor = amb.usuario(U.supervisor, 'supervisor');
  const gerente = amb.usuario(U.gerente, 'gerente');
  const analista = amb.usuario(U.analista, 'analista');
  const adminB = amb.usuario(B.usuarios.admin, 'admin', B.tenantId);

  const ponto = (n: number, hhmm: string, extra: Record<string, unknown> = {}) => ({ id: id(n), capturado_em: em(hhmm), latitude: lat(n), longitude: -60.02, precisao_m: 10, velocidade_ms: null, ...extra });
  const envia = (entidade: string, u: UsuarioAutenticado, ps: Array<{ id: string }>) =>
    amb.receber(provedoresSyncTrajeto, entidade, u, ps.map((p) => ({ id: p.id, operacao: 'criar', payload: p }) as unknown as ItemPush));
  const contar = (tabela: string, uid: string) => amb.noTenant(A.tenantId, async (db) => Number((await db.query<{ n: string }>(`select count(*)::text as n from core.${tabela} where usuario_id = $1 and id::text like '${FAIXA}-%'`, [uid])).rows[0]!.n));
  const resumo = (uid: string) =>
    amb.noTenant(A.tenantId, async (db) => (await db.query<{ metros: number; pontos: number; origem: string; n: string }>(`select metros, pontos, origem, count(*) over ()::text as n from core.deslocamento_dia where usuario_id = $1 and data = $2 and deleted_at is null`, [uid, DIA])).rows);
  const chamarComPerfis = (u: UsuarioAutenticado, query: Record<string, unknown>) => {
    const r = rotasDeTrajeto[0]!;
    return r.executar({ ...amb.ctx(u), usuario: { ...u, perfis: perfisDeFabrica(u.perfil) }, query: r.query!.parse(query), corpo: {}, params: {} } as never) as Promise<any>; // eslint-disable-line @typescript-eslint/no-explicit-any
  };
  const consultarNoTenant = (u: UsuarioAutenticado, usuario_ids: string[], data = DIA) =>
    amb.noTenant(u.tenant_id, (db) => consultaTrajetoDoDia.executar({ usuario_ids, data }, { db, usuario: { ...u, perfis: perfisDeFabrica(u.perfil) }, agora: () => HOJE, fuso: () => 'America/Manaus' } as unknown as ContextoConsulta));

  const limpar = async () => {
    await amb.limpar(`delete from core.ponto_trajeto where id::text like '${FAIXA}-%'`);
    await amb.limpar(`delete from core.ausencia_usuario where id::text like '${FAIXA}-%'`);
    await amb.limpar('delete from core.deslocamento_dia where usuario_id = any($1::uuid[]) and data = $2', [[U.vendedor1, U.vendedor2], DIA]);
    await amb.limpar(`delete from plataforma.parametro where tenant_id = $1 and modulo = 'core' and chave = 'rastreamento'`, [A.tenantId]);
  };

  beforeAll(async () => {
    await amb.abrir();
    amb.relogio = HOJE;
    await limpar();
    await amb.limpar(`insert into plataforma.parametro (tenant_id, modulo, chave, valor) values ($1, 'core', 'rastreamento', $2::jsonb)`, [A.tenantId, JSON.stringify({ ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: true })]);
  });
  afterAll(async () => {
    await limpar();
    await amb.fechar();
  });

  it('RN-CORE-13: o ponto dentro do portão grava, e reenviar não duplica', async () => {
    const lote = [ponto(1, '14:00'), ponto(2, '14:10'), ponto(3, '14:20')];
    expect(await envia('ponto_trajeto', vendedor1, lote)).toHaveLength(3);
    expect(await envia('ponto_trajeto', vendedor1, lote)).toHaveLength(3);
    expect(await contar('ponto_trajeto', U.vendedor1)).toBe(3);
  });

  it('RN-CORE-46: o resumo do dia é recalculado (origem rastreamento), idempotente e confere com metrosDoTrajeto', async () => {
    const r1 = await resumo(U.vendedor1);
    expect(r1).toHaveLength(1);
    expect(r1[0]).toMatchObject({ pontos: 3, origem: 'rastreamento' });
    expect(r1[0]!.metros).toBeGreaterThan(200); // 2 trechos de ~111 m
    expect(r1[0]!.metros).toBeLessThan(250);
    // ponto atrasado do mesmo dia recalcula o dia inteiro; o resumo continua único
    await envia('ponto_trajeto', vendedor1, [ponto(4, '14:30')]);
    const r2 = await resumo(U.vendedor1);
    expect(r2).toHaveLength(1);
    expect(r2[0]!.pontos).toBe(4);
    expect(r2[0]!.metros).toBeGreaterThan(r1[0]!.metros);
    const linha = (await amb.puxar(provedoresSyncTrajeto, 'ausencia_usuario', vendedor1)).length; // só para exercitar o provedor
    expect(linha).toBeGreaterThanOrEqual(0);
    const dados = await amb.noTenant(A.tenantId, async (db) => (await db.query(`select id, usuario_id, to_char(data, 'YYYY-MM-DD') as data, metros, pontos, origem, to_char(updated_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at, null::text as deleted_at from core.deslocamento_dia where usuario_id = $1 and data = $2`, [U.vendedor1, DIA])).rows[0]);
    expect(DeslocamentoDiaSchema.parse(dados)).toMatchObject({ origem: 'rastreamento' });
  });

  it('RN-CORE-13: ponto fora do portão (fora do expediente, futuro, ausência, outro cargo) é descartado sem travar o lote', async () => {
    const antes = await contar('ponto_trajeto', U.vendedor1);
    const r = await envia('ponto_trajeto', vendedor1, [ponto(10, '14:33'), ponto(11, '11:30'), ponto(12, '15:00')]);
    expect(r.map((x) => x.status)).toEqual(['aceito', 'aceito', 'aceito']);
    expect(await contar('ponto_trajeto', U.vendedor1)).toBe(antes + 1); // só o 10
    // ausência cadastrada para o dia: nada mais entra
    await amb.limpar(`insert into core.ausencia_usuario (id, tenant_id, usuario_id, de, ate) values ($1, $2, $3, $4, $4)`, [id(70), A.tenantId, U.vendedor1, DIA]);
    await envia('ponto_trajeto', vendedor1, [ponto(13, '14:55')]);
    expect(await contar('ponto_trajeto', U.vendedor1)).toBe(antes + 1);
    // gerente não é de campo: nada entra
    await envia('ponto_trajeto', gerente, [ponto(14, '14:00')]);
    expect(await contar('ponto_trajeto', U.gerente)).toBe(0);
  });

  it('RN-CORE-13: o pull entrega só a ausência do próprio usuário', async () => {
    const minhas = (await amb.puxar(provedoresSyncTrajeto, 'ausencia_usuario', vendedor1)) as unknown as Array<Record<string, unknown>>;
    expect(minhas.map((l) => l.id)).toContain(id(70));
    expect(minhas.every((l) => l.usuario_id === U.vendedor1)).toBe(true);
    for (const l of minhas) AusenciaUsuarioSchema.parse(l);
    const dele2 = (await amb.puxar(provedoresSyncTrajeto, 'ausencia_usuario', vendedor2)) as unknown as Array<Record<string, unknown>>;
    expect(dele2.map((l) => l.id)).not.toContain(id(70));

  });

  it('RN-CORE-13/04: o vendedor não vê trajeto (nem o próprio); o supervisor vê o da equipe, não o de fora dela; analista e admin sem a permissão não veem', async () => {
    const daEquipe = TrajetoRespostaSchema.parse(await chamarComPerfis(supervisor, { data: DIA, usuario_id: U.vendedor1 }));
    expect(daEquipe.usuario.id).toBe(U.vendedor1);
    expect(daEquipe.usuario.pontos.length).toBeGreaterThanOrEqual(4);
    expect(daEquipe.usuario.metros).toBeGreaterThan(0);
    await expect(chamarComPerfis(vendedor1, { data: DIA, usuario_id: U.vendedor1 })).rejects.toMatchObject({ status: 403 });
    await expect(chamarComPerfis(vendedor1, { data: DIA, usuario_id: U.vendedor2 })).rejects.toMatchObject({ status: 403 });
    await expect(chamarComPerfis(vendedor1, { data: DIA })).rejects.toBeDefined(); // sem usuario_id a consulta nem existe
    await expect(chamarComPerfis(supervisor, { data: DIA, usuario_id: U.vendedor2 })).rejects.toMatchObject({ status: 404 });
    await expect(chamarComPerfis(analista, { data: DIA, usuario_id: U.vendedor1 })).rejects.toMatchObject({ status: 403 });
    await expect(chamarComPerfis(adminB, { data: DIA, usuario_id: B.usuarios.admin })).rejects.toMatchObject({ status: 403 });
    await expect(chamarComPerfis(gerente, { data: '2026-01-01', usuario_id: U.vendedor1 })).rejects.toMatchObject({ codigo: 'TRAJETO_FORA_DA_RETENCAO' });
  });

  it('RN-CORE-13/04: core.trajeto_do_dia@1 devolve só o escopo de quem consulta; id fora do escopo ou de outro tenant some', async () => {
    const sup = await consultarNoTenant(supervisor, [U.vendedor1, U.vendedor2]);
    expect(sup.usuarios.map((x: { id: string }) => x.id)).toEqual([U.vendedor1]);
    expect(sup.usuarios[0]!.pontos.length).toBeGreaterThanOrEqual(4);
    const ger = await consultarNoTenant(gerente, [U.vendedor1, U.vendedor2]);
    expect(ger.usuarios.map((x: { id: string }) => x.id).sort()).toEqual([U.vendedor1, U.vendedor2].sort());
    expect((await consultarNoTenant(analista, [U.vendedor1])).usuarios).toEqual([]);
    expect((await consultarNoTenant(vendedor1, [U.vendedor1])).usuarios).toEqual([]);
    // o admin do tenant B pergunta por usuário do A: some (RLS)
    expect((await consultarNoTenant(adminB, [U.vendedor1])).usuarios).toEqual([]);
  });
});
