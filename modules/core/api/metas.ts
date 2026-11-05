/**
 * Metas e indicadores (`/v1/core/metas`, `/v1/core/indicadores`; RF-CORE-08, RN-CORE-20..22; desenho T-0016 §6).
 * Escopo de equipe (`usuariosVisiveis`): fora do escopo é 404, como em rotas. O cálculo é do domínio
 * (`painelDoUsuario`), a MESMA função que o app roda sobre as linhas locais: o BKO e o aparelho mostram os mesmos números.
 * Realizado de venda vem do read-model `core.indicador_diario` (o Core não lê `vendedor.*`); enquanto ele estiver
 * vazio, `realizado_cents` sai 0 e `positivados` nulo ("aguardando pedidos" no app).
 */
import type { Perfil } from '@macuxi/platform-sdk';
import { ConsultaIndisponivel, definirConsulta, ErroNaoEncontrado, ErroRegraNegocio, type ClienteBanco, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { z } from 'zod';
import {
  Cents,
  EVENTO_META_DEFINIDA,
  Id,
  IsoDateTime,
  IndicadoresListaSchema,
  CopiarMetasSchema,
  type CopiarMetas,
  type CopiarMetasResposta,
  MetaEquipeParamsSchema,
  MetaEquipeSchema,
  MetaParamsSchema,
  MetasListaSchema,
  MetasQuerySchema,
  PainelMetasBkoQuerySchema,
  PainelMetasBkoSchema,
  PutMetaSchema,
  INDICADORES_META,
  type IndicadoresLista,
  type LinhaMetaBko,
  type MetaEquipeResposta,
  type PainelMetasBko,
  type PutMeta,
  type MetasLista,
} from '../contracts';
import { copiarMetas, dataDoFechamento, dataLocal, expandirEquipe, painelDoUsuario, podeEditarMetaDe, situacaoDoPeriodo, type BaseApuracao, type FaturamentoApuravel, type IndicadorMeta, type PedidoDaMeta, type TipoMeta } from '../domain';
import { auditar } from './auditoria';
import { erroHttp } from './erros';
import { EQUIPES_DO_RESPONSAVEL } from './carteira';

const naoEncontrado = () => new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado na sua equipe. Atualize a lista e tente de novo.');

/**
 * Espelho mínimo (só os campos que a apuração usa) da consulta `vendedor.pedidos_da_meta@1`. O Core não importa o pacote do Vendedor
 * (evita ciclo de pacotes); o nome é a chave de ligação e o schema de saída é tolerante a campos extras.
 */
export const CONSULTA_PEDIDOS_DA_META = definirConsulta({
  nome: 'vendedor.pedidos_da_meta@1',
  entrada: z.object({ usuario_ids: z.array(Id).max(500), periodo: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/) }),
  saida: z.object({
    pedidos: z.array(
      z.object({
        vendedor_id: Id,
        criado_por: Id.nullable(),
        cliente_id: Id.nullable(),
        emitido_em: IsoDateTime,
        aprovado_em: IsoDateTime.nullable(),
        status: z.enum(['aprovado', 'integrado', 'faturado']),
        total_cents: Cents,
        frete_cents: Cents.nullable(),
        cancelado_cents: Cents.nullable(),
      }),
    ),
    faturamentos: z.array(
      z.object({
        vendedor_id: Id,
        cliente_id: Id.nullable(),
        faturado_em: IsoDateTime,
        valor_cents: Cents,
        cancelado_cents: Cents.nullable(),
        devolvido_cents: Cents.nullable(),
      }),
    ),
  }),
});

/** Parâmetro `metas.base_apuracao` (aprovado|faturado); ausente ou inválido = aprovado. */
export async function baseDeApuracao(db: ClienteBanco): Promise<BaseApuracao> {
  const r = await db.query<{ valor: unknown }>("select valor from plataforma.parametro where modulo = 'core' and chave = 'metas.base_apuracao' and deleted_at is null limit 1");
  return r.rows[0]?.valor === 'faturado' ? 'faturado' : 'aprovado';
}

/**
 * T-0065 B (RN-CORE-21): porta para os pedidos e faturamentos do Vendedor. A implementação real é a consulta pública
 * `vendedor.pedidos_da_meta@1` via `tx.consultar` (contrato pedido ao modulo-vendedor, R-20261103 T-0065); o Core não lê
 * `vendedor.*`. Devolve `null` quando a consulta está indisponível: o painel cai no read-model `indicador_diario`.
 * `periodo` é AAAA-MM; a fonte traz uma folga de 1 dia para cada lado (o domínio decide o mês pelo fuso do tenant).
 */
export type FontePedidosDaMeta = (q: { usuario_ids: string[]; periodo: string }) => Promise<{ pedidos: PedidoDaMeta[]; faturamentos: FaturamentoApuravel[] } | null>;

/** Tipo da meta de venda do usuário (RN-CORE-21): lê `core.meta.tipo` da meta `venda_cents`; sem meta vale 'pedido'. */
const tipoDaMeta = (metas: ReadonlyArray<{ usuario_id: string; indicador: string; tipo: string }>, usuarioId: string): TipoMeta =>
  metas.find((m) => m.usuario_id === usuarioId && m.indicador === 'venda_cents')?.tipo === 'faturamento' ? 'faturamento' : 'pedido';

/**
 * Liga a porta à consulta `vendedor.pedidos_da_meta@1` (`usaConsultas` no manifesto). Módulo Vendedor desligado ou não
 * instalado no tenant (`ConsultaIndisponivel`) = `null`: o painel cai no read-model `indicador_diario`.
 * Decidida pela licença do tenant (`{ licenca: 'tenant' }`, ADR 0025, RN-CORE-27): só leitura agregada de indicador, em rota GET;
 * o escopo continua o de quem consulta.
 */
export const fontePorConsulta =
  (tx: Partial<Pick<TransacaoTenant, 'consultar'>>): FontePedidosDaMeta =>
  async (q) => {
    // contexto sem `consultar` (testes, shells antigos): nem chama, cai no indicador_diario
    if (typeof tx?.consultar !== 'function') return null;
    try {
      return await tx.consultar(CONSULTA_PEDIDOS_DA_META, q, { licenca: 'tenant' });
    } catch (e) {
      if (e instanceof ConsultaIndisponivel) return null;
      throw e;
    }
  };

const periodoDe = (hoje: string, informado?: string): string => informado ?? hoje.slice(0, 7);

/** Usuários de campo do escopo (vendedor e promotor), ordenados por nome; `um` restringe a um usuário do escopo. */
async function usuariosDoPainel(db: ClienteBanco, visiveis: ReadonlySet<string> | 'tenant', um?: string) {
  if (um && visiveis !== 'tenant' && !visiveis.has(um)) throw naoEncontrado();
  const valores: unknown[] = [];
  let filtro = '';
  if (um) {
    valores.push(um);
    filtro = `and id = $${valores.length}`;
  } else if (visiveis !== 'tenant') {
    valores.push([...visiveis]);
    filtro = `and id = any($${valores.length}::uuid[])`;
  }
  const perfis = um ? '' : "and perfil in ('vendedor', 'promotor')";
  const r = await db.query<{ id: string; nome: string }>(`select id, nome from core.usuario where deleted_at is null and ativo ${perfis} ${filtro} order by nome, id`, valores);
  if (um && r.rows.length === 0) throw naoEncontrado();
  return r.rows;
}

export async function calcularIndicadores(db: ClienteBanco, visiveis: ReadonlySet<string> | 'tenant', agora: Date, fuso: string, q: { periodo?: string; usuario_id?: string }, fonte?: FontePedidosDaMeta): Promise<IndicadoresLista> {
  const hoje = dataLocal(agora, fuso);
  const periodo = periodoDe(hoje, q.periodo);
  const usuarios = await usuariosDoPainel(db, visiveis, q.usuario_id);
  const ids = usuarios.map((u) => u.id);
  const base = await baseDeApuracao(db);
  const situacao = situacaoDoPeriodo(periodo, hoje);
  const fechamento_em = dataDoFechamento(periodo);
  if (ids.length === 0) return IndicadoresListaSchema.parse({ periodo, base_apuracao: base, situacao, fechamento_em, itens: [] });
  const paradas = await db.query<{ usuario_id: string; cliente_id: string; data: string }>(
    "select usuario_id, cliente_id, to_char(data, 'YYYY-MM-DD') as data from core.rota_parada where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data, 'YYYY-MM') = $2",
    [ids, periodo],
  );
  const visitas = await db.query<{ usuario_id: string; cliente_id: string; data_local: string }>(
    "select usuario_id, cliente_id, to_char(data_local, 'YYYY-MM-DD') as data_local from core.visita where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data_local, 'YYYY-MM') = $2",
    [ids, periodo],
  );
  const diarios = await db.query<{ usuario_id: string; data: string; pedidos: number; vendido_cents: number; cancelado_cents: number }>(
    "select usuario_id, to_char(data, 'YYYY-MM-DD') as data, pedidos, vendido_cents::float8 as vendido_cents, cancelado_cents::float8 as cancelado_cents from core.indicador_diario where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data, 'YYYY-MM') = $2",
    [ids, periodo],
  );
  const metas = await db.query<{ usuario_id: string; periodo: string; indicador: IndicadorMeta; valor: number; tipo: TipoMeta }>(
    'select usuario_id, periodo, indicador, valor::float8 as valor, tipo from core.meta where deleted_at is null and usuario_id = any($1::uuid[]) and periodo = $2',
    [ids, periodo],
  );
  const vendas = fonte ? await fonte({ usuario_ids: ids, periodo }) : null;
  const itens = usuarios.map((u) => {
    const p = painelDoUsuario({ periodo, usuario_id: u.id, hoje, base, paradas: paradas.rows, visitas: visitas.rows, diarios: diarios.rows, metas: metas.rows, apuracao: vendas ? { tipo: tipoDaMeta(metas.rows, u.id), fuso, pedidos: vendas.pedidos, faturamentos: vendas.faturamentos } : undefined });
    return { usuario_id: u.id, usuario_nome: u.nome, indicadores: p.indicadores, metas: p.metas };
  });
  return IndicadoresListaSchema.parse({ periodo, base_apuracao: base, situacao, fechamento_em, itens });
}

type Escopo = { equipe: Set<string>; equipesAbaixo: Set<string> };
type Contexto = Parameters<NonNullable<RotaModulo['executar']>>[0];

/** Usuários que o editor responde (equipe) e das equipes abaixo, para `podeEditarMetaDe` (RN-CORE-20). Admin não precisa. */
async function escopoDeEdicao(db: ClienteBanco, editorId: string, perfil: string): Promise<Escopo> {
  const vazio: Escopo = { equipe: new Set(), equipesAbaixo: new Set() };
  if (perfil !== 'supervisor' && perfil !== 'gerente') return vazio;
  const r = await db.query<{ usuario_id: string; nivel: number }>(
    `${EQUIPES_DO_RESPONSAVEL} select u.id as usuario_id, eq.nivel from core.usuario u join eq on eq.id = u.equipe_id where u.deleted_at is null`,
    [editorId],
  );
  return { equipe: new Set(r.rows.filter((l) => l.nivel === 0).map((l) => l.usuario_id)), equipesAbaixo: new Set(r.rows.filter((l) => l.nivel > 0).map((l) => l.usuario_id)) };
}

/** Guarda de edição: 403 fora do escopo de edição (RN-CORE-20). */
function exigirEdicao(ctx: Pick<Contexto, 'usuario'>, escopo: Escopo, alvoId: string): void {
  const d = podeEditarMetaDe({ perfil: ctx.usuario.perfil, alvoId, editorId: ctx.usuario.id, ...escopo });
  if (!d.ok) throw erroHttp(403, d.codigo, d.mensagem);
}

function validarMeta(c: PutMeta): void {
  if (c.indicador === 'cobertura_pct' && c.valor > 10000) throw new ErroRegraNegocio('RN-CORE-20', 'A meta de cobertura vai de 0 a 100%. Informe um valor até 100.');
  if (c.tipo === 'faturamento' && c.indicador !== 'venda_cents') throw new ErroRegraNegocio('RN-CORE-21', 'Só a meta de venda pode ser apurada por faturamento. Use o tipo pedido para este indicador.');
}

type TxPublicar = Pick<TransacaoTenant, 'publicar'>;

/** Upsert de uma meta + `core.meta.definida@1` (só se mudou). Devolve o estado anterior para a auditoria. */
async function gravarMeta(db: ClienteBanco, tx: TxPublicar, definidoPor: string, usuarioId: string, periodo: string, c: PutMeta) {
  const atual = (
    await db.query<{ id: string; valor: number; tipo: TipoMeta }>('select id, valor::float8 as valor, tipo from core.meta where usuario_id = $1 and periodo = $2 and indicador = $3 and deleted_at is null', [usuarioId, periodo, c.indicador])
  ).rows[0];
  const tipo: TipoMeta = c.indicador === 'venda_cents' ? (c.tipo ?? atual?.tipo ?? 'pedido') : 'pedido';
  const resposta = { usuario_id: usuarioId, periodo, indicador: c.indicador, valor: c.valor, tipo };
  if (atual && atual.valor === c.valor && atual.tipo === tipo) return { resposta, atual, alterado: false };
  if (atual) await db.query('update core.meta set valor = $2, tipo = $3 where id = $1', [atual.id, c.valor, tipo]);
  else await db.query('insert into core.meta (tenant_id, usuario_id, periodo, indicador, valor, tipo) values (plataforma.tenant_atual(), $1, $2, $3, $4, $5)', [usuarioId, periodo, c.indicador, c.valor, tipo]);
  await tx.publicar(EVENTO_META_DEFINIDA, { usuario_id: usuarioId, periodo, indicador: c.indicador, valor: c.valor, valor_anterior: atual?.valor ?? null, definido_por: definidoPor }, usuarioId);
  return { resposta, atual, alterado: true };
}

export const rotasDeMetas: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'metas',
    carteira: 'filtrar_no_dominio',
    query: MetasQuerySchema,
    executar: async (ctx): Promise<MetasLista> => {
      const visiveis = await ctx.usuariosVisiveis();
      const q = ctx.query as z.infer<typeof MetasQuerySchema>;
      return ctx.comTenant(async (db) => {
        const hoje = dataLocal(ctx.agora(), ctx.fuso());
        const periodo = periodoDe(hoje, q.periodo);
        const usuarios = await usuariosDoPainel(db, visiveis, q.usuario_id);
        const r = await db.query<{ usuario_id: string; indicador: IndicadorMeta; valor: number; tipo: TipoMeta }>(
          'select usuario_id, indicador, valor::float8 as valor, tipo from core.meta where deleted_at is null and periodo = $1 and usuario_id = any($2::uuid[]) order by usuario_id, indicador',
          [periodo, usuarios.map((u) => u.id)],
        );
        return MetasListaSchema.parse({ periodo, itens: r.rows });
      });
    },
  },
  {
    metodo: 'PUT',
    caminho: 'metas/:usuarioId/:periodo',
    acao: 'meta.editar',
    carteira: 'filtrar_no_dominio',
    params: MetaParamsSchema,
    corpo: PutMetaSchema,
    executar: async (ctx) => {
      const { usuarioId, periodo } = ctx.params as z.infer<typeof MetaParamsSchema>;
      const c = ctx.corpo as z.infer<typeof PutMetaSchema>;
      // o escopo de EDIÇÃO (domínio) é mais estreito que o de leitura e já cobre o de leitura: fora dele é 403 (RN-CORE-20)
      validarMeta(c);
      return ctx.comTenant(async (db, tx) => {
        const existe = await db.query('select 1 from core.usuario where id = $1 and deleted_at is null', [usuarioId]);
        if (existe.rowCount === 0) throw naoEncontrado();
        exigirEdicao(ctx, await escopoDeEdicao(db, ctx.usuario.id, ctx.usuario.perfil), usuarioId);
        const { resposta, atual, alterado } = await gravarMeta(db, tx, ctx.usuario.id, usuarioId, periodo, c);
        if (alterado)
          await auditar(db, ctx, {
            acao: 'meta.editar',
            entidade: 'meta',
            entidadeId: usuarioId,
            antes: atual ? { indicador: c.indicador, valor: atual.valor, tipo: atual.tipo } : null,
            depois: { periodo, indicador: c.indicador, valor: resposta.valor, tipo: resposta.tipo },
          });
        return resposta;
      });
    },
  },
  {
    metodo: 'PUT',
    caminho: 'metas/equipe/:equipeId/:periodo',
    acao: 'meta.editar',
    carteira: 'filtrar_no_dominio',
    params: MetaEquipeParamsSchema,
    corpo: MetaEquipeSchema,
    executar: async (ctx): Promise<MetaEquipeResposta> => {
      const { equipeId, periodo } = ctx.params as z.infer<typeof MetaEquipeParamsSchema>;
      const c = ctx.corpo as PutMeta;
      validarMeta(c);
      return ctx.comTenant(async (db, tx) => {
        const eq = await db.query('select 1 from core.equipe where id = $1 and deleted_at is null', [equipeId]);
        if (eq.rowCount === 0) throw new ErroNaoEncontrado('EQUIPE_NAO_ENCONTRADA', 'Equipe não encontrada. Atualize a lista e tente de novo.');
        const membros = await db.query<{ id: string; perfil: Perfil; ativo: boolean }>('select id, perfil, ativo from core.usuario where equipe_id = $1 and deleted_at is null order by id', [equipeId]);
        const alvos = expandirEquipe(membros.rows);
        const escopo = await escopoDeEdicao(db, ctx.usuario.id, ctx.usuario.perfil);
        // tudo ou nada: um alvo fora do escopo recusa o lote inteiro (403)
        for (const alvo of alvos) exigirEdicao(ctx, escopo, alvo);
        if (alvos.length === 0) exigirEdicao(ctx, escopo, ctx.usuario.id);
        const antes: Array<{ usuario_id: string; valor: number | null; tipo: TipoMeta | null }> = [];
        let alterados = 0;
        let tipoFinal: TipoMeta = c.indicador === 'venda_cents' ? (c.tipo ?? 'pedido') : 'pedido';
        for (const alvo of alvos) {
          const g = await gravarMeta(db, tx, ctx.usuario.id, alvo, periodo, c);
          tipoFinal = g.resposta.tipo;
          antes.push({ usuario_id: alvo, valor: g.atual?.valor ?? null, tipo: g.atual?.tipo ?? null });
          if (g.alterado) alterados += 1;
        }
        await auditar(db, ctx, {
          acao: 'meta.editar_equipe',
          entidade: 'equipe',
          entidadeId: equipeId,
          antes: { indicador: c.indicador, usuarios: antes },
          depois: { periodo, indicador: c.indicador, valor: c.valor, tipo: tipoFinal, usuarios: alvos },
        });
        return { equipe_id: equipeId, periodo, indicador: c.indicador, valor: c.valor, tipo: tipoFinal, usuarios: alvos, alterados };
      });
    },
  },
  {
    metodo: 'POST',
    caminho: 'metas/copiar',
    acao: 'meta.editar',
    carteira: 'filtrar_no_dominio',
    corpo: CopiarMetasSchema,
    executar: async (ctx): Promise<CopiarMetasResposta> => {
      const c = ctx.corpo as CopiarMetas;
      if (c.de === c.para) throw new ErroRegraNegocio('RN-CORE-20', 'O mês de origem e o de destino são o mesmo. Escolha o mês anterior como origem.');
      return ctx.comTenant(async (db, tx) => {
        const escopo = await escopoDeEdicao(db, ctx.usuario.id, ctx.usuario.perfil);
        const filtroEquipe = c.equipe_id ? 'and u.equipe_id = $2' : '';
        const lidas = async (periodo: string) =>
          (
            await db.query<{ usuario_id: string; indicador: IndicadorMeta; valor: number; tipo: TipoMeta }>(
              `select m.usuario_id, m.indicador, m.valor::float8 as valor, m.tipo from core.meta m join core.usuario u on u.id = m.usuario_id
                where m.deleted_at is null and u.deleted_at is null and u.ativo and u.perfil in ('vendedor', 'promotor') and m.periodo = $1 ${filtroEquipe}`,
              c.equipe_id ? [periodo, c.equipe_id] : [periodo],
            )
          ).rows;
        const anterior = (await lidas(c.de)).filter((m) => podeEditarMetaDe({ perfil: ctx.usuario.perfil, alvoId: m.usuario_id, editorId: ctx.usuario.id, ...escopo }).ok);
        const novas = copiarMetas(anterior, await lidas(c.para));
        for (const m of novas) await gravarMeta(db, tx, ctx.usuario.id, m.usuario_id, c.para, { indicador: m.indicador, valor: m.valor, tipo: m.tipo });
        await auditar(db, ctx, {
          acao: 'meta.copiar',
          entidade: 'meta',
          entidadeId: c.equipe_id ?? ctx.usuario.id,
          antes: { periodo: c.de },
          depois: { periodo: c.para, equipe_id: c.equipe_id ?? null, copiadas: novas.length, usuarios: [...new Set(novas.map((m) => m.usuario_id))] },
        });
        return { de: c.de, para: c.para, copiadas: novas.length, ignoradas: anterior.length - novas.length };
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'metas/painel',
    carteira: 'filtrar_no_dominio',
    query: PainelMetasBkoQuerySchema,
    executar: async (ctx): Promise<PainelMetasBko> => {
      const visiveis = await ctx.usuariosVisiveis();
      const q = ctx.query as z.infer<typeof PainelMetasBkoQuerySchema>;
      return ctx.comTenant(async (db, tx) => {
        const hoje = dataLocal(ctx.agora(), ctx.fuso());
        const periodo = periodoDe(hoje, q.periodo);
        let escopo: ReadonlySet<string> | 'tenant' = visiveis;
        if (q.equipe_id) {
          const m = await db.query<{ id: string }>("select id from core.usuario where equipe_id = $1 and deleted_at is null and ativo and perfil in ('vendedor', 'promotor')", [q.equipe_id]);
          escopo = new Set(m.rows.map((r) => r.id).filter((i) => visiveis === 'tenant' || visiveis.has(i)));
        }
        const ind = await calcularIndicadores(db, escopo, ctx.agora(), ctx.fuso(), { periodo, usuario_id: q.usuario_id }, fontePorConsulta(tx));
        const ids = ind.itens.map((i) => i.usuario_id);
        const info = await db.query<{ id: string; equipe_id: string | null }>('select id, equipe_id from core.usuario where id = any($1::uuid[])', [ids]);
        const equipeDe = new Map(info.rows.map((r) => [r.id, r.equipe_id]));
        const metas = await db.query<{ usuario_id: string; indicador: IndicadorMeta; tipo: TipoMeta }>('select usuario_id, indicador, tipo from core.meta where deleted_at is null and periodo = $1 and usuario_id = any($2::uuid[])', [periodo, ids]);
        const edicao = await escopoDeEdicao(db, ctx.usuario.id, ctx.usuario.perfil);
        const editavel = (alvoId: string) => podeEditarMetaDe({ perfil: ctx.usuario.perfil, alvoId, editorId: ctx.usuario.id, ...edicao }).ok;
        const linhas: LinhaMetaBko[] = [];
        for (const item of ind.itens) {
          const realizadoDe: Record<IndicadorMeta, number | null> = {
            venda_cents: item.indicadores.realizado_cents ?? null,
            visitas: item.indicadores.visitados,
            cobertura_pct: item.indicadores.cobertura_pct,
            positivacao: item.indicadores.positivados ?? null,
          };
          const tipoVenda = tipoDaMeta(metas.rows, item.usuario_id);
          for (const indicador of INDICADORES_META) {
            const linha = item.metas.find((m) => m.indicador === indicador);
            linhas.push({
              usuario_id: item.usuario_id,
              usuario_nome: item.usuario_nome,
              equipe_id: equipeDe.get(item.usuario_id) ?? null,
              indicador,
              tipo: indicador === 'venda_cents' ? tipoVenda : 'pedido',
              meta: linha?.meta ?? 0,
              realizado: linha ? linha.realizado : realizadoDe[indicador],
              atingimento_pct: linha?.atingimento_pct ?? null,
              editavel: editavel(item.usuario_id),
            });
          }
        }
        return PainelMetasBkoSchema.parse({ periodo, base_apuracao: ind.base_apuracao, situacao: ind.situacao, fechamento_em: ind.fechamento_em, linhas });
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'indicadores',
    carteira: 'filtrar_no_dominio',
    query: MetasQuerySchema,
    executar: async (ctx): Promise<IndicadoresLista> => {
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant((db, tx) => calcularIndicadores(db, visiveis, ctx.agora(), ctx.fuso(), ctx.query as z.infer<typeof MetasQuerySchema>, fontePorConsulta(tx)));
    },
  },
];
