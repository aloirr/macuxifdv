/**
 * Rotas `/v1/core` da T-0017 (desenho T-0016 §3.3; RN-CORE-04/05): lista de clientes, Cliente 360, carteira e
 * hierarquia da equipe. Todas por `ctx.comTenant` (RLS) e filtradas pelo escopo do usuário; cliente fora do escopo é
 * 404 (nunca 403: não revela que existe). A licença do módulo e o perfil são checados pela plataforma (`definirModuloApi`).
 */
import { ConsultaIndisponivel, ErroNaoEncontrado, ErroRegraNegocio, type ContextoBase, type RotaModulo } from '@macuxi/platform-sdk';
import { z } from 'zod';
import { CONSULTA_FORMAS_PAGAMENTO } from '../../vendedor/contracts';
import {
  Cliente360Schema,
  EVENTO_CLIENTE_ATUALIZADO,
  CarteiraItemPutSchema,
  ClientePagamentoPutSchema,
  ClienteListaQuerySchema,
  type Cliente360,
  type ClienteEnderecoSync,
  type ClienteListaResposta,
  type HierarquiaEquipe,
} from '../contracts';
import { dataLocal, enderecoPadrao, listarEnderecosDoCliente, montarHierarquia, papelCompativel, PERFIS_GESTAO, perfilRecebeHistoricoDeCompra, recortarHierarquia, resumoCompras, resumoFinanceiro } from '../domain';
import { auditar } from './auditoria';
import { lerHierarquiaDoTenant } from './hierarquia-leitura';
import { lerPromotorVePedidos } from './promotor-pedidos';
import { BASE, TABELAS_SYNC, comHoje } from './sync';

const Uuid = z.string().uuid();
const IdParam = z.object({ id: Uuid });
const LIMITE_PADRAO = 100;

const naCarteira = (visiveis: ReadonlySet<string> | 'tenant', clienteId: string) => visiveis === 'tenant' || visiveis.has(clienteId);
const naoEncontrado = () => new ErroNaoEncontrado('CLIENTE_NAO_ENCONTRADO', 'Cliente não encontrado na sua carteira. Atualize a lista e tente de novo.');

function hojeDoTenant(ctx: ContextoBase): string {
  return dataLocal(ctx.agora(), ctx.fuso());
}

const escaparLike = (s: string) => s.replace(/[\\%_]/g, (c) => `\\${c}`);

async function listarClientesOnline(ctx: ContextoBase, q: z.output<typeof ClienteListaQuerySchema>): Promise<ClienteListaResposta> {
  const visiveis = await ctx.carteira();
  const limite = q.limite ?? LIMITE_PADRAO;
  const deslocamento = Math.max(0, Number.parseInt(q.cursor ?? '0', 10) || 0);
  return ctx.comTenant(async (db) => {
    const hoje = hojeDoTenant(ctx);
    const valores: unknown[] = [hoje];
    const param = (v: unknown) => `$${valores.push(v)}`;
    const onde: string[] = ['c.deleted_at is null'];
    if (visiveis !== 'tenant') onde.push(`c.id = any(${param([...visiveis])}::uuid[])`);
    if (q.q?.trim()) {
      const texto = param(`%${escaparLike(q.q.trim())}%`);
      const digitos = q.q.replace(/\D/g, '');
      const doc = digitos.length >= 3 ? ` or regexp_replace(coalesce(c.documento, ''), '[^0-9]', '', 'g') like ${param(`%${digitos}%`)}` : '';
      onde.push(`(c.razao_social ilike ${texto} or c.nome_fantasia ilike ${texto} or c.cidade ilike ${texto}${doc})`);
    }
    if (q.cidade) onde.push(`lower(c.cidade) = lower(${param(q.cidade)})`);
    if (q.segmento) onde.push(`lower(c.segmento) = lower(${param(q.segmento)})`);
    if (q.bloqueado) onde.push(q.bloqueado === 'true' ? 'coalesce(f.bloqueado, false)' : 'not coalesce(f.bloqueado, false)');
    const vencidos = `(select count(*)::int from core.titulo t where t.cliente_id = c.id and t.deleted_at is null and t.situacao = 'aberto' and t.vencimento < $1::date)`;
    if (q.com_vencidos) onde.push(q.com_vencidos === 'true' ? `${vencidos} > 0` : `${vencidos} = 0`);
    const r = await db.query<Record<string, unknown>>(
      `select c.id, c.documento, c.razao_social, c.nome_fantasia, c.segmento, c.cidade, c.uf, c.ativo,
              coalesce(f.bloqueado, false) as bloqueado, ${vencidos} as vencidos_qtd
         from core.cliente c left join core.cliente_financeiro f on f.cliente_id = c.id and f.deleted_at is null
        where ${onde.join(' and ')}
        order by lower(coalesce(nullif(c.nome_fantasia, ''), c.razao_social)), c.id
        limit ${param(limite + 1)} offset ${param(deslocamento)}`,
      valores,
    );
    const itens = r.rows.slice(0, limite) as unknown as ClienteListaResposta['itens'];
    return { itens, proximo_cursor: r.rows.length > limite ? String(deslocamento + limite) : null };
  });
}

async function cliente360(ctx: ContextoBase, id: string): Promise<Cliente360> {
  const visiveis = await ctx.carteira();
  if (!naCarteira(visiveis, id)) throw naoEncontrado();
  const usuarios = await ctx.usuariosVisiveis();
  return ctx.comTenant(async (db) => {
    const t = TABELAS_SYNC;
    const linhas = async (tabela: { tabela: string; colunas: string }, onde: string, ordem: string) =>
      (await db.query(`select ${BASE}, ${tabela.colunas} from ${tabela.tabela} where deleted_at is null and ${onde} order by ${ordem}`, [id])).rows;
    const [cliente] = await linhas(t.cliente, 'id = $1', 'id');
    if (!cliente) throw naoEncontrado();
    const hoje = hojeDoTenant(ctx);
    const contatos = await linhas(t.cliente_contato, 'cliente_id = $1', 'principal desc, nome, id');
    const [financeiro = null] = await linhas(t.cliente_financeiro, 'cliente_id = $1', 'id');
    const titulos = await linhas(t.titulo, `cliente_id = $1 and ${comHoje(t.titulo.janela, hoje)}`, 'vencimento, id');
    // RN-PRO-01 / T-0077 D2: promotor com `promotor_ve_pedidos` desligada não recebe o histórico (campo segue obrigatório: vazio e resumo zerado)
    const comHistorico = ctx.usuario.perfil !== 'promotor' || perfilRecebeHistoricoDeCompra('promotor', await lerPromotorVePedidos(db));
    const historico = comHistorico ? await linhas(t.historico_compra, `cliente_id = $1 and ${comHoje(t.historico_compra.janela, hoje)}`, 'ano_mes desc, id') : [];
    // T-0061 (RF-CORE-12, RN-VEN-17): endereços ativos do cliente, o padrão primeiro. O escopo de carteira já foi checado acima.
    const brutos = (await linhas(t.cliente_endereco, 'cliente_id = $1 and ativo', 'id')) as unknown as ClienteEnderecoSync[];
    const enderecos = listarEnderecosDoCliente(brutos, id).map(({ padrao: _padrao, resumo: _resumo, ...e }) => e);
    const filtroUsuarios = usuarios === 'tenant' ? '' : 'and usuario_id = any($2::uuid[])';
    const ultimas = (
      await db.query(
        `select ${BASE}, usuario_id, cliente_id, rota_parada_id, to_char(data_local, 'YYYY-MM-DD') as data_local,
                to_char(checkin_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as checkin_em,
                checkin_lat::text as checkin_lat, checkin_lng::text as checkin_lng, sem_gps, distancia_m, fora_do_raio,
                justificativa_fora_raio, sugere_coordenada, extra,
                to_char(checkout_em at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') as checkout_em,
                resultado, motivo_id, motivo_texto, pedido_id, foto_fachada_id, fechada_por
           from core.visita where deleted_at is null and cliente_id = $1 ${filtroUsuarios}
          order by checkin_em desc, id limit 5`,
        usuarios === 'tenant' ? [id] : [id, [...usuarios]],
      )
    ).rows;
    const fin = financeiro as unknown as { limite_cents: number; saldo_aberto_cents: number; credito_disponivel_cents: number | null; bloqueado: boolean; motivo_bloqueio: string | null } | null;
    const tit = titulos as unknown as Array<{ vencimento: string; saldo_cents: number; situacao: 'aberto' | 'liquidado' | 'cancelado' }>;
    const his = historico as unknown as Array<{ ano_mes: string; valor_cents: number; pedidos: number; ultima_compra_em: string | null }>;
    return Cliente360Schema.parse({
      cliente,
      contatos,
      financeiro,
      titulos,
      historico,
      resumo_compras: resumoCompras(his, hoje),
      resumo_financeiro: resumoFinanceiro(fin, tit, hoje),
      ultimas_visitas: ultimas,
      enderecos,
      endereco_padrao_id: enderecoPadrao(enderecos)?.id ?? null,
    });
  });
}

const CarteiraQuerySchema = z.object({ usuario_id: Uuid.optional(), cliente_id: Uuid.optional() });

export const rotasDeClientes: readonly RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'clientes',
    carteira: 'filtrar_no_dominio',
    query: ClienteListaQuerySchema,
    executar: (ctx) => listarClientesOnline(ctx, ctx.query),
  },
  {
    metodo: 'GET',
    caminho: 'clientes/:id',
    // 404 (e não 403) fora do escopo: o filtro e o erro são do próprio handler
    carteira: 'filtrar_no_dominio',
    params: IdParam,
    executar: (ctx) => cliente360(ctx, ctx.params.id),
  },
  {
    // T-0089 / RN-VEN-24: formas ativas do Vendedor (consulta opcional, ADR 0019/0012); Vendedor desligado = null (só leitura)
    metodo: 'GET',
    caminho: 'formas-pagamento',
    acao: 'cliente.pagamento_editar',
    carteira: 'nao_se_aplica',
    executar: (ctx) =>
      ctx.comTenant(async (_db, tx) => {
        try {
          const r = await tx.consultar(CONSULTA_FORMAS_PAGAMENTO, {}, { licenca: 'tenant' });
          return { formas: r.formas.filter((f) => f.ativo).map((f) => ({ codigo: f.codigo, nome: f.nome })) };
        } catch (e) {
          if (e instanceof ConsultaIndisponivel) return { formas: null };
          throw e;
        }
      }),
  },
  {
    // T-0089 / RN-VEN-25: formas permitidas (códigos) e prazo médio máximo do cliente
    metodo: 'PUT',
    caminho: 'clientes/:id/pagamento',
    acao: 'cliente.pagamento_editar',
    carteira: 'nao_se_aplica',
    params: IdParam,
    corpo: ClientePagamentoPutSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db, tx) => {
        const c = ctx.corpo;
        const formas = c.formas_pagamento && c.formas_pagamento.length > 0 ? [...new Set(c.formas_pagamento)] : null;
        const antes = (await db.query('select prazo_medio_max_dias, formas_pagamento from core.cliente where id = $1 and deleted_at is null', [ctx.params.id])).rows[0];
        if (!antes) throw naoEncontrado();
        await db.query('update core.cliente set prazo_medio_max_dias = $2, formas_pagamento = $3::text[] where id = $1', [ctx.params.id, c.prazo_medio_max_dias, formas]);
        await auditar(db, ctx, { acao: 'cliente.pagamento_editar', entidade: 'cliente', entidadeId: ctx.params.id, antes, depois: { prazo_medio_max_dias: c.prazo_medio_max_dias, formas_pagamento: formas } });
        await tx.publicar(EVENTO_CLIENTE_ATUALIZADO, { cliente_id: ctx.params.id, campos: ['prazo_medio_max_dias', 'formas_pagamento'], origem: 'bko' }, ctx.params.id);
        return { prazo_medio_max_dias: c.prazo_medio_max_dias, formas_pagamento: formas };
      }),
  },
  {
    metodo: 'GET',
    caminho: 'carteira',
    perfis: PERFIS_GESTAO,
    carteira: 'filtrar_no_dominio',
    query: CarteiraQuerySchema,
    executar: async (ctx) => {
      const visiveis = await ctx.carteira();
      const usuarios = await ctx.usuariosVisiveis();
      const valores: unknown[] = [];
      const onde: string[] = ['deleted_at is null'];
      const param = (v: unknown) => `$${valores.push(v)}`;
      if (visiveis !== 'tenant') onde.push(`cliente_id = any(${param([...visiveis])}::uuid[])`);
      if (usuarios !== 'tenant') onde.push(`usuario_id = any(${param([...usuarios])}::uuid[])`);
      if (ctx.query.usuario_id) onde.push(`usuario_id = ${param(ctx.query.usuario_id)}`);
      if (ctx.query.cliente_id) onde.push(`cliente_id = ${param(ctx.query.cliente_id)}`);
      const itens = await ctx.comTenant(
        async (db) =>
          (await db.query(`select ${BASE}, ${TABELAS_SYNC.carteira.colunas} from core.carteira where ${onde.join(' and ')} order by cliente_id, usuario_id, papel limit 5000`, valores)).rows,
      );
      return { itens };
    },
  },
  {
    metodo: 'PUT',
    caminho: 'carteira',
    acao: 'carteira.editar',
    carteira: 'nao_se_aplica',
    corpo: CarteiraItemPutSchema,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const c = ctx.corpo;
        const cliente = await db.query('select 1 from core.cliente where id = $1 and deleted_at is null', [c.cliente_id]);
        if (cliente.rowCount === 0) throw naoEncontrado();
        const usuario = await db.query<{ perfil: Parameters<typeof papelCompativel>[0] }>('select perfil from core.usuario where id = $1 and deleted_at is null', [c.usuario_id]);
        if (!usuario.rows[0]) throw new ErroNaoEncontrado('USUARIO_NAO_ENCONTRADO', 'Usuário não encontrado. Escolha um usuário da lista e tente de novo.');
        if (!papelCompativel(usuario.rows[0].perfil, c.papel))
          throw new ErroRegraNegocio('RN-CORE-04', `O papel "${c.papel}" não combina com o perfil do usuário (${usuario.rows[0].perfil}). Vincule vendedor a vendedor e promotor a promotor.`);
        const antes =
          (
            await db.query(
              'select inicio::text, fim::text, frequencia_semanas, dia_semana from core.carteira where cliente_id = $1 and usuario_id = $2 and papel = $3 and deleted_at is null',
              [c.cliente_id, c.usuario_id, c.papel],
            )
          ).rows[0] ?? null;
        const r = await db.query<{ id: string }>(
          `insert into core.carteira (tenant_id, cliente_id, usuario_id, papel, inicio, fim, frequencia_semanas, dia_semana)
           values (plataforma.tenant_atual(), $1, $2, $3, $4, $5, $6, $7)
           on conflict (tenant_id, cliente_id, usuario_id, papel) where deleted_at is null
           do update set inicio = excluded.inicio, fim = excluded.fim, frequencia_semanas = excluded.frequencia_semanas, dia_semana = excluded.dia_semana
           returning id`,
          [c.cliente_id, c.usuario_id, c.papel, c.inicio ?? null, c.fim ?? null, c.frequencia_semanas ?? null, c.dia_semana ?? null],
        );
        const id = r.rows[0]!.id;
        await auditar(db, ctx, { acao: 'carteira.vincular', entidade: 'carteira', entidadeId: id, antes, depois: c });
        return { id };
      }),
  },
  {
    metodo: 'DELETE',
    caminho: 'carteira/:id',
    acao: 'carteira.editar',
    carteira: 'nao_se_aplica',
    status: 204,
    params: IdParam,
    executar: (ctx) =>
      ctx.comTenant(async (db) => {
        const r = await db.query('update core.carteira set deleted_at = now() where id = $1 and deleted_at is null returning cliente_id, usuario_id, papel', [ctx.params.id]);
        if (r.rowCount === 0) throw new ErroNaoEncontrado('CARTEIRA_NAO_ENCONTRADA', 'Vínculo da carteira não encontrado. Atualize a lista e tente de novo.');
        await auditar(db, ctx, { acao: 'carteira.desvincular', entidade: 'carteira', entidadeId: ctx.params.id, antes: r.rows[0], depois: null });
        return null;
      }),
  },
  {
    metodo: 'GET',
    caminho: 'equipe/hierarquia',
    perfis: PERFIS_GESTAO,
    carteira: 'nao_se_aplica',
    executar: async (ctx): Promise<HierarquiaEquipe> => {
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant(async (db) => {
        const { equipes, usuarios } = await lerHierarquiaDoTenant(db);
        return { membros: recortarHierarquia(montarHierarquia(equipes, usuarios), visiveis) };
      });
    },
  },
];
