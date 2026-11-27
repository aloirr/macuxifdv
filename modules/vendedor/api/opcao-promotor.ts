/**
 * Ponto ÚNICO da opção `promotor_ve_pedidos` do perfil Promotor (O-3 do doc 03, decisão de 2026-11-02).
 * Lista, detalhe e pull de pedido/item/evento passam por `exigirLeituraDePedidos` / `leituraDePedidosLiberada`.
 * A decisão é `decidir` (abaixo); `podeLerPedidos` (domain) monta o 403. Em concessão (cargo com `perfil_acesso`)
 * vale a chave `pedido.ver` (ADR 0073 §2.4 E6); o legado consulta a opção do Core a CADA requisição, como a licença
 * (nunca em JWT/sessão/cache; Core inativo ou sem a consulta: padrão de fábrica LIGADA, ADR 0012).
 */
import { ehConsultaIndisponivel, ErroHttpModulo, podePeloCargo, promotorNaRequisicao, type ContextoBase } from '@macuxi/platform-sdk';
import { CONSULTA_PROMOTOR_VE_PEDIDOS, PROMOTOR_VE_PEDIDOS_PADRAO } from '@macuxi/core/contracts';
import { podeLerPedidos } from '../domain/leitura-pedido';

export type LeitorOpcaoPromotor = (ctx: ContextoBase) => boolean | Promise<boolean>;

/** Consulta o Core na transação do tenant; Core indisponível = padrão de fábrica (ligada). */
const padrao: LeitorOpcaoPromotor = async (ctx) => {
  const c = ctx as ContextoBase & { comTenant?: unknown };
  if (typeof c.comTenant !== 'function') return PROMOTOR_VE_PEDIDOS_PADRAO;
  try {
    return await ctx.comTenant(async (_db, tx) => {
      // Erro de montagem (não é "ligado silencioso"): o tx do comTenant, inclusive o do pull, sempre traz `consultar`.
      if (typeof tx?.consultar !== 'function') throw new Error('Montagem: o comTenant não entregou tx.consultar para a opção promotor_ve_pedidos.');
      return (await tx.consultar(CONSULTA_PROMOTOR_VE_PEDIDOS, {})).ligado;
    });
  } catch (e) {
    if (ehConsultaIndisponivel(e)) return PROMOTOR_VE_PEDIDOS_PADRAO;
    throw e;
  }
};
let leitor: LeitorOpcaoPromotor = padrao;

/** Opção `promotor_ve_pedidos` do tenant do usuário. Único ponto de leitura da opção no Vendedor. */
export async function promotorVePedidos(ctx: ContextoBase): Promise<boolean> {
  return leitor(ctx);
}

/** Troca o leitor (teste, ou a consulta do Core quando existir). Devolve a função que restaura o anterior. */
export function usarOpcaoPromotorVePedidos(novo: LeitorOpcaoPromotor): () => void {
  const anterior = leitor;
  leitor = novo;
  return () => {
    leitor = anterior;
  };
}

/** RN-PRO-01 (ADR 0073 §2.4 E6): cópia mínima da regra do core (tarefa seguinte da v1.0.42, R-20261127-165252, item 5: `usuarioLePedidos` no SDK); legado consulta o Core só quando preciso. */
async function decidir(ctx: ContextoBase) {
  const u = ctx.usuario;
  const ve = !promotorNaRequisicao(u) || (u.perfil_acesso ? podePeloCargo(u.perfil_acesso, 'pedido.ver') : await promotorVePedidos(ctx));
  return podeLerPedidos(ve);
}

/** Pull: false = o promotor com a opção desligada não recebe pedido, item nem evento. */
export async function leituraDePedidosLiberada(ctx: ContextoBase): Promise<boolean> {
  return (await decidir(ctx)).ok;
}

/** Rotas de leitura: promotor com a opção desligada recebe 403 (RN-PRO-01). */
export async function exigirLeituraDePedidos(ctx: ContextoBase): Promise<void> {
  const r = await decidir(ctx);
  if (!r.ok) throw new ErroHttpModulo(r.http, r.codigo, r.mensagem);
}
