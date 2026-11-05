/**
 * `GET /v1/core/inicio` (`core.inicio@1`; RN-CORE-26; desenho T-0073 §1.1). Traz só o que o aparelho NÃO tem no pull: o realizado de
 * vendas e a positivação "até ontem" × "hoje" (do Vendedor pela consulta `vendedor.pedidos_da_meta@1`, via `fontePorConsulta`; sem
 * Vendedor cai no read-model `indicador_diario`) e o nome da equipe. As metas do dia saem das MESMAS funções puras que o app roda.
 * Escopo `usuariosVisiveis()` (RN-CORE-04). Promotor sem meta de venda/positivação NUNCA chama o Vendedor (RN-PRO-01).
 */
import type { ClienteBanco, RotaModulo, TransacaoTenant } from '@macuxi/platform-sdk';
import { InicioQuerySchema, InicioSchema, type Inicio, type InicioUsuario, type MetaDoDia } from '../contracts';
import {
  calendarioDoTenant,
  dataLocal,
  indicadoresDoPeriodo,
  metaDoDia,
  metaDoDiaDaEquipe,
  realizadoPartido,
  type ItemEquipe,
  type CalendarioTenant,
  type IndicadorMeta,
  type TipoMeta,
} from '../domain';
import { fontePorConsulta, type FontePedidosDaMeta } from './metas';

const ORDEM: readonly IndicadorMeta[] = ['venda_cents', 'positivacao', 'visitas', 'cobertura_pct'];

interface LinhaUsuario {
  id: string;
  nome: string;
  perfil: 'vendedor' | 'promotor';
  equipe_id: string | null;
}
interface LinhaMeta {
  usuario_id: string;
  indicador: IndicadorMeta;
  valor: number;
  tipo: TipoMeta;
}

export interface EntradaInicio {
  usuarioId: string;
  perfil: string;
  visiveis: ReadonlySet<string> | 'tenant';
  agora: Date;
  fuso: string;
}

async function usuariosDoInicio(db: ClienteBanco, e: EntradaInicio, equipe: boolean): Promise<LinhaUsuario[]> {
  if (!equipe) {
    const r = await db.query<LinhaUsuario>("select id, nome, perfil, equipe_id from core.usuario where id = $1 and deleted_at is null and perfil in ('vendedor', 'promotor')", [e.usuarioId]);
    return r.rows;
  }
  const lista = e.visiveis === 'tenant' ? null : [...e.visiveis];
  const r = await db.query<LinhaUsuario>(
    "select id, nome, perfil, equipe_id from core.usuario where deleted_at is null and ativo and perfil in ('vendedor', 'promotor') and ($1::uuid[] is null or id = any($1::uuid[])) order by nome, id",
    [lista],
  );
  return r.rows;
}

/** T-0076: equipe de quem pede (a que ele responde ou, sem ela, a dele). */
async function nomeDaEquipe(db: ClienteBanco, usuarioId: string): Promise<string | null> {
  const r = await db.query<{ nome: string }>(
    "select nome from (select e.nome, 0 as ordem from core.equipe e where e.responsavel_id = $1 and e.deleted_at is null and e.ativo union all select e.nome, 1 from core.usuario u join core.equipe e on e.id = u.equipe_id where u.id = $1 and e.deleted_at is null) t order by ordem, nome limit 1",
    [usuarioId],
  );
  return r.rows[0]?.nome ?? null;
}

/** Cálculo do Início (puro sobre o banco da transação; exportado para teste). */
export async function calcularInicio(db: ClienteBanco, tx: Partial<Pick<TransacaoTenant, 'consultar'>>, e: EntradaInicio, fonteInjetada?: FontePedidosDaMeta): Promise<Inicio> {
  const dia = dataLocal(e.agora, e.fuso);
  const periodo = dia.slice(0, 7);
  const equipe = e.perfil === 'supervisor' || e.perfil === 'gerente';
  const usuarios = await usuariosDoInicio(db, e, equipe);
  const ids = usuarios.map((u) => u.id);
  const calculado_em = e.agora.toISOString();
  const equipe_nome = (await nomeDaEquipe(db, e.usuarioId)) ?? null;
  if (ids.length === 0) return InicioSchema.parse({ dia, periodo, calculado_em, equipe_nome, escopo: equipe ? 'equipe' : 'proprio', usuarios: [], metas_do_dia: [] });

  const parametros = await db.query<{ modulo: string; chave: string; valor: unknown; deleted_at: string | null }>(
    "select modulo, chave, valor, null::text as deleted_at from plataforma.parametro where modulo = 'core' and chave = 'metas.dias_uteis_semana' and deleted_at is null",
  );
  const calendario: CalendarioTenant = calendarioDoTenant(parametros.rows);
  const metas = (await db.query<LinhaMeta>('select usuario_id, indicador, valor::float8 as valor, tipo from core.meta where deleted_at is null and usuario_id = any($1::uuid[]) and periodo = $2', [ids, periodo])).rows;
  const metaDe = (uid: string, ind: IndicadorMeta) => metas.find((m) => m.usuario_id === uid && m.indicador === ind && m.valor > 0);
  const tipoDe = (uid: string): TipoMeta => (metas.find((m) => m.usuario_id === uid && m.indicador === 'venda_cents')?.tipo === 'faturamento' ? 'faturamento' : 'pedido');

  // RN-PRO-01: o promotor só entra na consulta do Vendedor se tiver meta de venda ou de positivação
  const paraConsultar = usuarios.filter((u) => u.perfil === 'vendedor' || metaDe(u.id, 'venda_cents') || metaDe(u.id, 'positivacao')).map((u) => u.id);
  const fonte = fonteInjetada ?? fontePorConsulta(tx);
  const vendas = paraConsultar.length > 0 ? await fonte({ usuario_ids: paraConsultar, periodo }) : null;
  const diarios =
    paraConsultar.length > 0 && !vendas
      ? (await db.query<{ usuario_id: string; data: string; vendido_cents: number; cancelado_cents: number }>(
          "select usuario_id, to_char(data, 'YYYY-MM-DD') as data, vendido_cents::float8 as vendido_cents, cancelado_cents::float8 as cancelado_cents from core.indicador_diario where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data, 'YYYY-MM') = $2",
          [paraConsultar, periodo],
        )).rows
      : [];
  const paradas = (await db.query<{ usuario_id: string; cliente_id: string; data: string }>("select usuario_id, cliente_id, to_char(data, 'YYYY-MM-DD') as data from core.rota_parada where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data, 'YYYY-MM') = $2", [ids, periodo])).rows;
  const visitas = (await db.query<{ usuario_id: string; cliente_id: string; data_local: string }>("select usuario_id, cliente_id, to_char(data_local, 'YYYY-MM-DD') as data_local from core.visita where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data_local, 'YYYY-MM') = $2", [ids, periodo])).rows;

  const saidaUsuarios: InicioUsuario[] = usuarios.map((u) => {
    const consultado = paraConsultar.includes(u.id);
    let venda_cents: InicioUsuario['venda_cents'] = null;
    let positivacao: InicioUsuario['positivacao'] = null;
    if (consultado && vendas) {
      const p = realizadoPartido(tipoDe(u.id), vendas, { usuario_id: u.id, periodo, fuso: e.fuso, hoje: dia });
      venda_cents = p.venda_cents;
      positivacao = p.positivacao;
    } else if (consultado) {
      // Vendedor desligado/ausente: o read-model diário só sabe vender; positivação fica sem fonte
      const meus = diarios.filter((d) => d.usuario_id === u.id);
      if (meus.length > 0) {
        const liquido = (d: { vendido_cents: number; cancelado_cents: number }) => Math.max(0, d.vendido_cents - d.cancelado_cents);
        venda_cents = { ate_ontem: meus.filter((d) => d.data < dia).reduce((s, d) => s + liquido(d), 0), hoje: meus.filter((d) => d.data === dia).reduce((s, d) => s + liquido(d), 0) };
      }
    }
    return { usuario_id: u.id, nome: u.nome, perfil: u.perfil, equipe_id: u.equipe_id, tipo_meta_venda: tipoDe(u.id), venda_cents, positivacao };
  });

  const doDia: MetaDoDia[] = [];
  const porIndicador = new Map<IndicadorMeta, ItemEquipe[]>();
  for (const u of saidaUsuarios) {
    const meus = { paradas: paradas.filter((p) => p.usuario_id === u.usuario_id).map((p) => ({ cliente_id: p.cliente_id, data: p.data })), visitas: visitas.filter((v) => v.usuario_id === u.usuario_id) };
    const ateOntem = indicadoresDoPeriodo({ periodo, usuario_id: u.usuario_id, hoje: dia, paradas: meus.paradas, visitas: meus.visitas.filter((v) => v.data_local < dia) });
    const total = indicadoresDoPeriodo({ periodo, usuario_id: u.usuario_id, hoje: dia, paradas: meus.paradas, visitas: meus.visitas.filter((v) => v.data_local <= dia) });
    // Decisão do Alexandre (T-0073): indicador sem fonte (null) não entra nas metas do dia nem como zero
    const realizado: Record<IndicadorMeta, [number, number] | null> = {
      venda_cents: u.venda_cents ? [u.venda_cents.ate_ontem, u.venda_cents.hoje] : null,
      positivacao: u.positivacao ? [u.positivacao.ate_ontem, u.positivacao.hoje] : null,
      visitas: [ateOntem.visitados, total.visitados - ateOntem.visitados],
      cobertura_pct: [ateOntem.cobertura_pct, Math.max(0, total.cobertura_pct - ateOntem.cobertura_pct)],
    };
    for (const ind of ORDEM) {
      const meta = metaDe(u.usuario_id, ind);
      if (!meta) continue;
      const r = realizado[ind];
      if (!r) continue;
      const [ate, hoje] = r;
      const m = metaDoDia({ indicador: ind, periodo, hoje: dia, calendario, meta_mes: Math.round(meta.valor), realizado_ate_ontem: ate, realizado_hoje: hoje });
      porIndicador.set(ind, [...(porIndicador.get(ind) ?? []), { ...m, paradas_planejadas: total.planejados }]);
    }
  }
  for (const ind of ORDEM) {
    const itens = porIndicador.get(ind) ?? [];
    if (equipe) {
      const soma = metaDoDiaDaEquipe(ind, itens);
      if (soma) doDia.push(soma);
    } else doDia.push(...itens.map(({ paradas_planejadas: _p, ...m }) => m));
  }
  return InicioSchema.parse({ dia, periodo, calculado_em, equipe_nome, escopo: equipe ? 'equipe' : 'proprio', usuarios: saidaUsuarios, metas_do_dia: doDia });
}

export const rotasDeInicio: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'inicio',
    acao: 'inicio.ver',
    carteira: 'filtrar_no_dominio',
    query: InicioQuerySchema,
    executar: async (ctx): Promise<Inicio> => {
      const visiveis = await ctx.usuariosVisiveis();
      return ctx.comTenant((db, tx) => calcularInicio(db, tx, { usuarioId: ctx.usuario.id, perfil: ctx.usuario.perfil, visiveis, agora: ctx.agora(), fuso: ctx.fuso() }));
    },
  },
];
