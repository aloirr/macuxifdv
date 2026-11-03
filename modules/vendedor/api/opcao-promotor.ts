/**
 * Ponto ÚNICO da opção `promotor_ve_pedidos` do perfil Promotor (O-3 do doc 03, decisão de 2026-11-02).
 * Lista, detalhe e pull de pedido/item/evento passam por `exigirLeituraDePedidos` / `leituraDePedidosLiberada`; ninguém
 * mais lê a opção. A regra em si é `podeLerPedidos` (domain, RN-PRO-01).
 *
 * A opção vem da consulta pública `core.promotor_ve_pedidos@1` (Core, ADR 0012), feita a CADA requisição, como a licença
 * (nunca em JWT/sessão/cache). Core inativo no tenant ou sem a consulta: padrão de fábrica LIGADA.
 */
import { ehConsultaIndisponivel, ErroHttpModulo, type ContextoBase } from '@macuxi/platform-sdk';
import { CONSULTA_PROMOTOR_VE_PEDIDOS, PROMOTOR_VE_PEDIDOS_PADRAO } from '@macuxi/core/contracts';
import { podeLerPedidos } from '../domain/leitura-pedido';

export type LeitorOpcaoPromotor = (ctx: ContextoBase) => boolean | Promise<boolean>;

/** Consulta o Core na transação do tenant; Core indisponível = padrão de fábrica (ligada). */
const padrao: LeitorOpcaoPromotor = async (ctx) => {
  const c = ctx as ContextoBase & { comTenant?: unknown };
  if (typeof c.comTenant !== 'function') return PROMOTOR_VE_PEDIDOS_PADRAO;
  try {
    return await ctx.comTenant(async (_db, tx) => (await tx.consultar(CONSULTA_PROMOTOR_VE_PEDIDOS, {})).ligado);
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

/** Só consulta a opção para o promotor; os demais perfis não mudam. */
async function decidir(ctx: ContextoBase) {
  const opcao = ctx.usuario.perfil === 'promotor' ? await promotorVePedidos(ctx) : true;
  return podeLerPedidos(ctx.usuario.perfil, opcao);
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
