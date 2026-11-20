/**
 * Rotas `/v1/core` da T-0018 (desenho T-0016 §4.4; RN-CORE-04/05/10/14): rotas (leitura e edição no BKO),
 * visitas, motivos e coordenadas sugeridas no 1º check-in. Todas por `ctx.comTenant` (RLS) e filtradas pelos
 * usuários visíveis (`usuariosVisiveis`); usuário fora do escopo é 404 (não revela que existe). Não há rota REST de
 * check-in/checkout: o app é offline-first e escreve só pela fila (`visita-push.ts`).
 */
import { ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type ContextoBase, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  AprovarCoordenadaSchema,
  CopiarRotaSchema,
  EVENTO_CLIENTE_ATUALIZADO,
  GerarRotasSchema,
  MotivoPutSchema,
  PutRotaSchema,
  RotasQuerySchema,
  UsuarioDataParamsSchema,
  VisitasQuerySchema,
  type CoordenadasSugeridas,
  type CopiarRotaResposta,
  type GerarRotasResposta,
  type RotaDia,
  type RotasLista,
  type VisitasLista,
} from '../contracts';
import { carteiraParaEvento, copiarRota, PERFIS_GESTAO, dataLocal, gerarParadasPorFrequencia, statusDasParadas, type LinhaCarteiraEvento } from '../domain';
import { somarDiasCivis as somarDias } from '@macuxi/comum/relogio';
import { auditar } from './auditoria';
import { BASE, TABELAS_SYNC } from './sync';

const Uuid = z.string().uuid();
const IdParam = z.object({ id: Uuid });
const DIA_MS = 86_400_000;

const usuarioNaoEncontrado = () => new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado na sua equipe. Atualize a lista e tente de novo.');

function visivel(visiveis: ReadonlySet<string> | 'tenant', id: string): boolean {
  return visiveis === 'tenant' || visiveis.has(id);
}

interface ParadaRow {
  id: string;
  updated_at: string;
  deleted_at: string | null;
  external_id: string | null;
  rota_id: string;
  usuario_id: string;
  data: string;
  cliente_id: string;
  sequencia: number;
  janela_inicio: string | null;
  janela_fim: string | null;
}
interface RotaRow {
  id: string;
  usuario_id: string;
  data: string;
}

/** Rotas (com paradas e status) dos usuários e datas pedidos; status por `statusDasParadas` com as visitas do servidor. */
async function rotasDoPeriodo(ctx: ContextoBase, db: ClienteBanco, usuarios: string[] | 'tenant', de: string, ate: string, fuso: string) {
  const valores: unknown[] = [de, ate];
  const filtroUsuario = usuarios === 'tenant' ? '' : `and usuario_id = any($3::uuid[])`;
  if (usuarios !== 'tenant') valores.push(usuarios);
  const rotas = (
    await db.query<Record<string, unknown> & RotaRow>(
      `select ${BASE}, ${TABELAS_SYNC.rota.colunas} from core.rota where deleted_at is null and data between $1::date and $2::date ${filtroUsuario} order by data, usuario_id`,
      valores,
    )
  ).rows;
  if (rotas.length === 0) return [];
  const ids = rotas.map((r) => r.id);
  const paradas = (
    await db.query<ParadaRow>(`select ${BASE}, ${TABELAS_SYNC.rota_parada.colunas} from core.rota_parada where deleted_at is null and rota_id = any($1::uuid[]) order by sequencia`, [ids])
  ).rows;
  const visitas = (
    await db.query<{ id: string; usuario_id: string; cliente_id: string; rota_parada_id: string | null; data_local: string; checkin_em: Date; checkout_em: Date | null }>(
      `select id, usuario_id, cliente_id, rota_parada_id, to_char(data_local, 'YYYY-MM-DD') as data_local, checkin_em, checkout_em
         from core.visita where deleted_at is null and data_local between $1::date and $2::date and usuario_id = any($3::uuid[])`,
      [de, ate, [...new Set(rotas.map((r) => r.usuario_id))]],
    )
  ).rows;
  const nomes = new Map(
    (await db.query<{ id: string; nome: string }>('select id, nome from core.usuario where id = any($1::uuid[])', [[...new Set(rotas.map((r) => r.usuario_id))]])).rows.map((u) => [u.id, u.nome]),
  );
  const clientes = new Map(
    (
      await db.query<{ id: string; nome: string; cidade: string | null; bairro: string | null; lat: number | null; lng: number | null }>(
        "select id, coalesce(nullif(nome_fantasia, ''), razao_social) as nome, cidade, bairro, latitude::float8 as lat, longitude::float8 as lng from core.cliente where id = any($1::uuid[])",
        [[...new Set(paradas.map((p) => p.cliente_id))]],
      )
    ).rows.map((c) => [c.id, c]),
  );
  return rotas.map((r) => {
    const doDia = paradas.filter((p) => p.rota_id === r.id);
    const visitasDoDia = visitas
      .filter((v) => v.usuario_id === r.usuario_id && v.data_local === r.data)
      .map((v) => ({ id: v.id, cliente_id: v.cliente_id, rota_parada_id: v.rota_parada_id, data_local: v.data_local, checkin_em: v.checkin_em.toISOString(), checkout_em: v.checkout_em?.toISOString() ?? null }));
    const comStatus = statusDasParadas(doDia, visitasDoDia, ctx.agora(), fuso).map((p) => {
      const c = clientes.get(p.cliente_id);
      return { ...p, cliente_nome: c?.nome ?? '', cliente_cidade: c?.cidade ?? null, cliente_bairro: c?.bairro ?? null, lat: c?.lat ?? null, lng: c?.lng ?? null };
    });
    return {
      usuario_id: r.usuario_id,
      usuario_nome: nomes.get(r.usuario_id) ?? '',
      data: r.data,
      rota: r as unknown as RotaDia['rota'],
      paradas: comStatus as unknown as RotaDia['paradas'],
      feitas: comStatus.filter((p) => p.status === 'feita').length,
      total: comStatus.length,
    };
  });
}

/**
 * RN-CORE-04 (T-0187, P1 A): de quem é a carteira que vale para a rota do usuário `$1`: a dele; para o supervisor, também a da equipe
 * que ele responde (ele não tem carteira própria). Gerente não tem rota; o resto segue só com a própria.
 */
const DONOS_DA_CARTEIRA_DA_ROTA = `
  with recursive eq as (
    select id from core.equipe where responsavel_id = $1 and deleted_at is null and ativo
  ), donos as (
    select u.id from core.usuario u where u.id = $1
    union
    select m.id from core.usuario m join eq on eq.id = m.equipe_id
      where m.deleted_at is null and exists (select 1 from core.usuario s where s.id = $1 and s.perfil = 'supervisor' and s.deleted_at is null)
  )`;

async function checarUsuario(ctx: ContextoBase, db: ClienteBanco, usuarioId: string): Promise<void> {
  if (!visivel(await ctx.usuariosVisiveis(), usuarioId)) throw usuarioNaoEncontrado();
  const r = await db.query('select 1 from core.usuario where id = $1 and deleted_at is null', [usuarioId]);
  if (r.rowCount === 0) throw usuarioNaoEncontrado();
}

/** Substitui as paradas da rota do usuário na data (cria a rota se faltar). Mantém o id da parada do mesmo cliente (visita aponta para ele). */
async function gravarRota(
  db: ClienteBanco,
  usuarioId: string,
  data: string,
  paradas: ReadonlyArray<{ cliente_id: string; janela_inicio?: string | null; janela_fim?: string | null }>,
  origem: 'bko' | 'frequencia',
): Promise<string> {
  // RN-CORE-04: só clientes da carteira do usuário da rota, vigente na data; a do supervisor é a da equipe dele (T-0187)
  if (paradas.length > 0) {
    const ok = await db.query<{ cliente_id: string }>(
      `${DONOS_DA_CARTEIRA_DA_ROTA}
       select distinct cliente_id from core.carteira
        where usuario_id in (select id from donos) and deleted_at is null and cliente_id = any($2::uuid[])
          and (inicio is null or inicio <= $3::date) and (fim is null or fim >= $3::date)`,
      [usuarioId, paradas.map((p) => p.cliente_id), data],
    );
    const na = new Set(ok.rows.map((r) => r.cliente_id));
    const fora = paradas.filter((p) => !na.has(p.cliente_id));
    if (fora.length > 0)
      throw new ErroRegraNegocio('RN-CORE-04', `${fora.length} cliente(s) não estão na carteira deste usuário. Vincule-os na Carteira ou tire-os da rota.`, { clientes: fora.map((p) => p.cliente_id) });
  }
  const atual = (await db.query<{ id: string }>('select id from core.rota where usuario_id = $1 and data = $2::date and deleted_at is null', [usuarioId, data])).rows[0];
  const rotaId =
    atual?.id ??
    (
      await db.query<{ id: string }>(
        `insert into core.rota (tenant_id, usuario_id, data, situacao, origem) values (plataforma.tenant_atual(), $1, $2::date, 'planejada', $3) returning id`,
        [usuarioId, data, origem],
      )
    ).rows[0]!.id;
  const existentes = (await db.query<{ id: string; cliente_id: string }>('select id, cliente_id from core.rota_parada where rota_id = $1 and deleted_at is null', [rotaId])).rows;
  const novos = new Set(paradas.map((p) => p.cliente_id));
  const sairam = existentes.filter((e) => !novos.has(e.cliente_id)).map((e) => e.id);
  if (sairam.length > 0) await db.query('update core.rota_parada set deleted_at = now() where id = any($1::uuid[])', [sairam]);
  const porCliente = new Map(existentes.map((e) => [e.cliente_id, e.id]));
  let seq = 0;
  for (const p of paradas) {
    seq += 1;
    const id = porCliente.get(p.cliente_id);
    if (id) await db.query('update core.rota_parada set sequencia = $2, janela_inicio = $3, janela_fim = $4 where id = $1', [id, seq, p.janela_inicio ?? null, p.janela_fim ?? null]);
    else
      await db.query(
        `insert into core.rota_parada (tenant_id, rota_id, usuario_id, data, cliente_id, sequencia, janela_inicio, janela_fim)
         values (plataforma.tenant_atual(), $1, $2, $3::date, $4, $5, $6, $7)`,
        [rotaId, usuarioId, data, p.cliente_id, seq, p.janela_inicio ?? null, p.janela_fim ?? null],
      );
  }
  if (atual) await db.query('update core.rota set updated_at = now() where id = $1', [rotaId]); // o pull enxerga a rota mudada
  return rotaId;
}

async function rotaDoDia(ctx: ContextoBase, db: ClienteBanco, usuarioId: string, data: string): Promise<RotaDia> {
  const fuso = ctx.fuso();
  const [r] = await rotasDoPeriodo(ctx, db, [usuarioId], data, data, fuso);
  if (!r) return { rota: null, paradas: [], feitas: 0, total: 0 };
  const { usuario_id: _u, usuario_nome: _n, data: _d, ...resto } = r;
  return resto;
}

/** Carteira do cliente para o payload de `core.cliente.atualizado@1` (RN-CORE-04; lida dentro da transação do tenant). */
export async function carteiraDoEvento(db: ClienteBanco, clienteId: string) {
  const linhas = (
    await db.query<LinhaCarteiraEvento>(
      "select usuario_id, papel, frequencia_semanas, to_char(created_at at time zone 'UTC', 'YYYY-MM-DD\"T\"HH24:MI:SS.MS\"Z\"') as desde from core.carteira where cliente_id = $1 and deleted_at is null and (fim is null or fim >= current_date)",
      [clienteId],
    )
  ).rows;
  const ativo = (await db.query<{ ativo: boolean }>('select ativo from core.cliente where id = $1', [clienteId])).rows[0]?.ativo ?? true;
  return carteiraParaEvento(linhas, ativo);
}

const rotasDeRotas: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'rotas',
    perfis: PERFIS_GESTAO,
    carteira: 'filtrar_no_dominio',
    query: RotasQuerySchema,
    executar: async (ctx): Promise<RotasLista> => {
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant(async (db) => {
        const fuso = ctx.fuso();
        const de = ctx.query.de ?? dataLocal(ctx.agora(), fuso);
        const ate = ctx.query.ate ?? somarDias(de, 6);
        if (ate < de || Date.parse(ate) - Date.parse(de) > 62 * DIA_MS) throw new ErroRegraNegocio('PERIODO_INVALIDO', 'Escolha um período de até 62 dias, com a data final depois da inicial.');
        let usuarios: string[] | 'tenant' = visiveis === 'tenant' ? 'tenant' : [...visiveis];
        if (ctx.query.usuario_id) {
          if (!visivel(visiveis, ctx.query.usuario_id)) return { itens: [] };
          usuarios = [ctx.query.usuario_id];
        }
        return { itens: (await rotasDoPeriodo(ctx, db, usuarios, de, ate, fuso)) as RotasLista['itens'] };
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'rotas/:usuarioId/:data',
    perfis: PERFIS_GESTAO,
    carteira: 'filtrar_no_dominio',
    params: UsuarioDataParamsSchema,
    executar: async (ctx): Promise<RotaDia> =>
      ctx.comTenant(async (db) => {
        await checarUsuario(ctx, db, ctx.params.usuarioId);
        return rotaDoDia(ctx, db, ctx.params.usuarioId, ctx.params.data);
      }),
  },
  {
    metodo: 'PUT',
    caminho: 'rotas/:usuarioId/:data',
    acao: 'rota.editar',
    carteira: 'filtrar_no_dominio',
    params: UsuarioDataParamsSchema,
    corpo: PutRotaSchema,
    executar: async (ctx): Promise<RotaDia> =>
      ctx.comTenant(async (db) => {
        const { usuarioId, data } = ctx.params;
        await checarUsuario(ctx, db, usuarioId);
        const antes = (await db.query('select cliente_id, sequencia from core.rota_parada p join core.rota r on r.id = p.rota_id and r.deleted_at is null where r.usuario_id = $1 and r.data = $2::date and p.deleted_at is null order by sequencia', [usuarioId, data])).rows;
        const rotaId = await gravarRota(db, usuarioId, data, ctx.corpo.paradas, 'bko');
        await auditar(db, ctx, { acao: 'rota.editar', entidade: 'rota', entidadeId: rotaId, antes, depois: { usuario_id: usuarioId, data, paradas: ctx.corpo.paradas.map((p: { cliente_id: string }) => p.cliente_id) } });
        return rotaDoDia(ctx, db, usuarioId, data);
      }),
  },
  {
    metodo: 'POST',
    caminho: 'rotas/:usuarioId/:data/copiar',
    acao: 'rota.editar',
    carteira: 'filtrar_no_dominio',
    status: 200,
    params: UsuarioDataParamsSchema,
    corpo: CopiarRotaSchema,
    executar: async (ctx): Promise<CopiarRotaResposta> =>
      ctx.comTenant(async (db) => {
        const { usuarioId, data } = ctx.params;
        await checarUsuario(ctx, db, usuarioId);
        const origem = (
          await db.query<{ cliente_id: string; sequencia: number; janela_inicio: string | null; janela_fim: string | null }>(
            `select p.cliente_id, p.sequencia, to_char(p.janela_inicio, 'HH24:MI') as janela_inicio, to_char(p.janela_fim, 'HH24:MI') as janela_fim
               from core.rota_parada p join core.rota r on r.id = p.rota_id and r.deleted_at is null
              where r.usuario_id = $1 and r.data = $2::date and p.deleted_at is null order by p.sequencia`,
            [usuarioId, data],
          )
        ).rows;
        if (origem.length === 0) throw new ErroRegraNegocio('ROTA_VAZIA', 'A rota deste dia não tem paradas para copiar. Monte a rota e tente de novo.');
        const comVisita = new Set(
          (await db.query<{ d: string }>("select distinct to_char(data_local, 'YYYY-MM-DD') as d from core.visita where usuario_id = $1 and deleted_at is null and data_local = any($2::date[])", [usuarioId, ctx.corpo.para])).rows.map((r) => r.d),
        );
        const { copiadas, ignoradas } = copiarRota(origem, ctx.corpo.para, comVisita);
        for (const c of copiadas) await gravarRota(db, usuarioId, c.data, c.paradas, 'bko');
        await auditar(db, ctx, { acao: 'rota.copiar', entidade: 'rota', entidadeId: null, antes: null, depois: { usuario_id: usuarioId, de: data, copiadas: copiadas.map((c) => c.data), ignoradas } });
        return { copiadas: copiadas.map((c) => c.data), ignoradas };
      }),
  },
  {
    metodo: 'POST',
    caminho: 'rotas/gerar',
    acao: 'rota.editar',
    carteira: 'filtrar_no_dominio',
    status: 200,
    corpo: GerarRotasSchema,
    executar: async (ctx): Promise<GerarRotasResposta> => {
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant(async (db) => {
        const carteira = (
          await db.query<{ cliente_id: string; usuario_id: string; inicio: string | null; fim: string | null; frequencia_semanas: number | null; dia_semana: number | null }>(
            `select cliente_id, usuario_id, to_char(inicio, 'YYYY-MM-DD') as inicio, to_char(fim, 'YYYY-MM-DD') as fim, frequencia_semanas, dia_semana
               from core.carteira where deleted_at is null and frequencia_semanas is not null and dia_semana is not null order by usuario_id, cliente_id`,
          )
        ).rows.filter((c) => visivel(visiveis, c.usuario_id) && (!ctx.corpo.usuario_ids || ctx.corpo.usuario_ids.includes(c.usuario_id)));
        const paradas = gerarParadasPorFrequencia(carteira, ctx.corpo.semana);
        const grupos = new Map<string, { usuario_id: string; data: string; clientes: string[] }>();
        for (const p of paradas) {
          const k = `${p.usuario_id}|${p.data}`;
          const g = grupos.get(k) ?? { usuario_id: p.usuario_id, data: p.data, clientes: [] };
          g.clientes.push(p.cliente_id);
          grupos.set(k, g);
        }
        let criadas = 0;
        let ignoradas = 0;
        for (const g of grupos.values()) {
          const ja = await db.query('select 1 from core.rota where usuario_id = $1 and data = $2::date and deleted_at is null', [g.usuario_id, g.data]);
          if ((ja.rowCount ?? 0) > 0) {
            ignoradas += 1; // idempotente: nunca sobrescreve rota existente
            continue;
          }
          await gravarRota(db, g.usuario_id, g.data, g.clientes.map((cliente_id) => ({ cliente_id })), 'frequencia');
          criadas += 1;
        }
        await auditar(db, ctx, { acao: 'rota.gerar', entidade: 'rota', entidadeId: null, antes: null, depois: { semana: ctx.corpo.semana, criadas, ignoradas } });
        return { criadas, ignoradas };
      });
    },
  },
];

const rotasDeCarteiraDoUsuario: RotaModulo[] = [
  {
    // Carteira do usuário para montar a rota no BKO ("adicionar da carteira"): só vínculos vigentes, com o que o editor mostra
    metodo: 'GET',
    caminho: 'usuarios/:id/clientes',
    perfis: PERFIS_GESTAO,
    carteira: 'filtrar_no_dominio',
    params: IdParam,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        await checarUsuario(ctx, db, ctx.params.id);
        const itens = (
          await db.query(
            `${DONOS_DA_CARTEIRA_DA_ROTA}
             select distinct on (lower(coalesce(nullif(c.nome_fantasia, ''), c.razao_social)), c.id) c.id, coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as nome, c.razao_social, c.cidade, c.bairro, c.latitude::float8 as lat, c.longitude::float8 as lng, c.cadastro_incompleto,
                    to_char((select max(h.ultima_compra_em) from core.historico_compra h where h.cliente_id = c.id and h.deleted_at is null), 'YYYY-MM-DD') as ultima_compra_em,
                    k.id as carteira_id, k.papel, k.frequencia_semanas, k.dia_semana
               from core.carteira k join core.cliente c on c.id = k.cliente_id and c.deleted_at is null and c.ativo
              where k.usuario_id in (select id from donos) and k.deleted_at is null and (k.fim is null or k.fim >= $2::date) and (k.inicio is null or k.inicio <= $2::date)
              order by lower(coalesce(nullif(c.nome_fantasia, ''), c.razao_social)), c.id
              limit 5000`,
            [ctx.params.id, dataLocal(ctx.agora(), ctx.fuso())],
          )
        ).rows;
        return { itens };
      }),
  },
];

const rotasDeVisitas: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'visitas',
    perfis: PERFIS_GESTAO,
    carteira: 'filtrar_no_dominio',
    query: VisitasQuerySchema,
    executar: async (ctx): Promise<VisitasLista> => {
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant(async (db) => {
        const q = ctx.query;
        const fuso = ctx.fuso();
        const ate = q.ate ?? dataLocal(ctx.agora(), fuso);
        const de = q.de ?? somarDias(ate, -6);
        const valores: unknown[] = [de, ate];
        const param = (v: unknown) => `$${valores.push(v)}`;
        const onde = ['v.deleted_at is null', 'v.data_local between $1::date and $2::date'];
        if (visiveis !== 'tenant') onde.push(`v.usuario_id = any(${param([...visiveis])}::uuid[])`);
        if (q.usuario_id) onde.push(`v.usuario_id = ${param(q.usuario_id)}`);
        if (q.cliente_id) onde.push(`v.cliente_id = ${param(q.cliente_id)}`);
        if (q.fora_do_raio) onde.push(`v.fora_do_raio = ${q.fora_do_raio === 'true' ? 'true' : 'false'}`);
        const rows = (
          await db.query<Record<string, unknown> & { id: string }>(
            `select v.id, v.usuario_id, u.nome as usuario_nome, v.cliente_id, coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as cliente_nome,
                    to_char(v.data_local, 'YYYY-MM-DD') as data_local,
                    to_char(v.checkin_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as checkin_em,
                    to_char(v.checkout_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as checkout_em,
                    v.fora_do_raio, v.distancia_m, v.justificativa_fora_raio, v.sem_gps, v.sugere_coordenada, v.extra, v.resultado, v.fechada_por,
                    m.codigo as motivo_codigo, m.descricao as motivo_descricao, v.motivo_texto, v.foto_fachada_id
               from core.visita v
               join core.usuario u on u.id = v.usuario_id
               join core.cliente c on c.id = v.cliente_id
               left join core.motivo m on m.id = v.motivo_id
              where ${onde.join(' and ')}
              order by v.checkin_em desc, v.id
              limit ${param(q.limite ?? 500)}`,
            valores,
          )
        ).rows;
        const etapas = rows.length
          ? (await db.query<{ visita_id: string; modulo: string; etapa: string; situacao: string }>('select visita_id, modulo, etapa, situacao from core.visita_etapa where deleted_at is null and visita_id = any($1::uuid[]) order by modulo, etapa', [rows.map((r) => r.id)])).rows
          : [];
        return { itens: rows.map((r) => ({ ...r, etapas: etapas.filter((e) => e.visita_id === r.id).map(({ modulo, etapa, situacao }) => ({ modulo, etapa, situacao })) })) as unknown as VisitasLista['itens'] };
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'coordenadas-sugeridas',
    acao: 'cliente.aprovar_coordenada',
    carteira: 'filtrar_no_dominio',
    executar: async (ctx): Promise<CoordenadasSugeridas> => {
      const visiveis = await ctx.carteira();
      return ctx.comTenant(async (db) => {
        const valores: unknown[] = [];
        const filtro = visiveis === 'tenant' ? '' : `and c.id = any($1::uuid[])`;
        if (visiveis !== 'tenant') valores.push([...visiveis]);
        const rows = (
          await db.query<{ cliente_id: string; cliente_nome: string; cidade: string | null; visita_id: string; usuario_nome: string; checkin_em: string; lat: number; lng: number; precisao_m: number | null }>(
            `select c.id as cliente_id, coalesce(nullif(c.nome_fantasia, ''), c.razao_social) as cliente_nome, c.cidade, v.id as visita_id, u.nome as usuario_nome,
                    to_char(v.checkin_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') as checkin_em,
                    v.checkin_lat::float8 as lat, v.checkin_lng::float8 as lng, v.checkin_precisao_m as precisao_m
               from core.visita v
               join core.cliente c on c.id = v.cliente_id and c.deleted_at is null and c.latitude is null and c.longitude is null
               join core.usuario u on u.id = v.usuario_id
              where v.deleted_at is null and v.sugere_coordenada and v.checkin_lat is not null ${filtro}
              order by cliente_nome, c.id, v.checkin_em desc
              limit 2000`,
            valores,
          )
        ).rows;
        const porCliente = new Map<string, CoordenadasSugeridas['itens'][number]>();
        for (const r of rows) {
          const item = porCliente.get(r.cliente_id) ?? { cliente_id: r.cliente_id, cliente_nome: r.cliente_nome, cidade: r.cidade, visitas: [] };
          if (item.visitas.length < 5) item.visitas.push({ visita_id: r.visita_id, usuario_nome: r.usuario_nome, checkin_em: r.checkin_em, lat: r.lat, lng: r.lng, precisao_m: r.precisao_m });
          porCliente.set(r.cliente_id, item);
        }
        return { itens: [...porCliente.values()] };
      });
    },
  },
  {
    metodo: 'PUT',
    caminho: 'clientes/:id/coordenada',
    acao: 'cliente.aprovar_coordenada',
    carteira: (e) => (e.params as { id?: string } | null)?.id,
    params: IdParam,
    corpo: AprovarCoordenadaSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db, tx) => {
        const v = (
          await db.query<{ lat: number | null; lng: number | null; cliente_id: string }>(
            'select checkin_lat::float8 as lat, checkin_lng::float8 as lng, cliente_id from core.visita where id = $1 and cliente_id = $2 and deleted_at is null and sugere_coordenada',
            [ctx.corpo.visita_id, ctx.params.id],
          )
        ).rows[0];
        if (!v || v.lat == null || v.lng == null) throw new ErroNaoEncontrado('COORDENADA_NAO_ENCONTRADA', 'Esta coordenada sugerida não existe mais. Atualize a lista e escolha de novo.');
        const antes = (await db.query<{ latitude: string | null; longitude: string | null }>('select latitude::text, longitude::text from core.cliente where id = $1 and deleted_at is null', [ctx.params.id])).rows[0];
        if (!antes) throw new ErroNaoEncontrado('CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado. Atualize a lista e tente de novo.');
        if (antes.latitude !== null || antes.longitude !== null) throw new ErroRegraNegocio('RN-CORE-10', 'Este cliente já tem coordenada cadastrada. Só clientes sem coordenada recebem a sugerida.');
        await db.query('update core.cliente set latitude = $2, longitude = $3 where id = $1', [ctx.params.id, v.lat, v.lng]);
        await db.query('update core.visita set sugere_coordenada = false where cliente_id = $1 and sugere_coordenada and deleted_at is null', [ctx.params.id]);
        await auditar(db, ctx, { acao: 'cliente.aprovar_coordenada', entidade: 'cliente', entidadeId: ctx.params.id, antes, depois: { latitude: v.lat, longitude: v.lng, visita_id: ctx.corpo.visita_id } });
        await tx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: ctx.params.id, campos: ['latitude', 'longitude'], origem: 'bko', ...(await carteiraDoEvento(db, ctx.params.id)) }, ctx.params.id);
        return { cliente_id: ctx.params.id, latitude: v.lat, longitude: v.lng };
      }),
  },
];

const rotasDeMotivos: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'motivos',
    carteira: 'nao_se_aplica',
    executar: (ctx) =>
      ctx.comTenant(async (db) => ({
        itens: (await db.query(`select ${BASE}, ${TABELAS_SYNC.motivo.colunas} from core.motivo where deleted_at is null order by tipo, ordem, descricao, id`)).rows,
      })),
  },
  {
    metodo: 'PUT',
    caminho: 'motivos/:id',
    acao: 'motivo.editar',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: MotivoPutSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo;
        const atual = (await db.query<{ tipo: string; codigo: string; sistema: boolean }>('select tipo, codigo, sistema from core.motivo where id = $1 and deleted_at is null', [ctx.params.id])).rows[0];
        const exigeFoto = c.tipo === 'cliente_fechado' ? true : c.exige_foto;
        if (atual) {
          if (atual.sistema) throw new ErroRegraNegocio('RN-CORE-14', 'Os motivos de sistema (loja fechada e acesso negado) não podem ser alterados.');
          if (atual.tipo !== c.tipo || atual.codigo !== c.codigo) throw new ErroRegraNegocio('MOTIVO_CODIGO_FIXO', 'O tipo e o código do motivo não mudam depois de criado. Crie outro motivo e desative este.');
          await db.query('update core.motivo set descricao = $2, exige_foto = $3, ativo = $4, ordem = $5 where id = $1', [ctx.params.id, c.descricao, exigeFoto, c.ativo, c.ordem]);
        } else {
          const igual = await db.query('select 1 from core.motivo where tipo = $1 and codigo = $2 and deleted_at is null', [c.tipo, c.codigo]);
          if ((igual.rowCount ?? 0) > 0) throw new ErroRegraNegocio('MOTIVO_DUPLICADO', 'Já existe um motivo com este código para este tipo. Use outro código.');
          await db.query(
            'insert into core.motivo (id, tenant_id, tipo, codigo, descricao, exige_foto, sistema, ativo, ordem) values ($1, plataforma.tenant_atual(), $2, $3, $4, $5, false, $6, $7)',
            [ctx.params.id, c.tipo, c.codigo, c.descricao, exigeFoto, c.ativo, c.ordem],
          );
        }
        await auditar(db, ctx, { acao: atual ? 'motivo.editar' : 'motivo.criar', entidade: 'motivo', entidadeId: ctx.params.id, antes: atual ?? null, depois: c });
        return { id: ctx.params.id };
      }),
  },
  {
    metodo: 'DELETE',
    caminho: 'motivos/:id',
    acao: 'motivo.editar',
    carteira: 'nao_se_aplica',
    status: 204,
    params: IdParam,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const atual = (await db.query<{ tipo: string; codigo: string; sistema: boolean }>('select tipo, codigo, sistema from core.motivo where id = $1 and deleted_at is null', [ctx.params.id])).rows[0];
        if (!atual) throw new ErroNaoEncontrado('MOTIVO_NAO_ENCONTRADO', 'Motivo não encontrado. Atualize a lista e tente de novo.');
        if (atual.sistema) throw new ErroRegraNegocio('RN-CORE-14', 'Os motivos de sistema (loja fechada e acesso negado) não podem ser removidos.');
        await db.query('update core.motivo set deleted_at = now() where id = $1', [ctx.params.id]);
        await auditar(db, ctx, { acao: 'motivo.remover', entidade: 'motivo', entidadeId: ctx.params.id, antes: atual, depois: null });
        return null;
      }),
  },
];

export const rotasDeRotasEVisitas: RotaModulo[] = [...rotasDeRotas, ...rotasDeCarteiraDoUsuario, ...rotasDeVisitas, ...rotasDeMotivos];
