/**
 * Ponto ÚNICO da opção `promotor_ve_pedidos` do perfil Promotor (O-3 do doc 03, decisão de 2026-11-02).
 * Lista, detalhe e pull de pedido/item/evento passam por `exigirLeituraDePedidos` / `leituraDePedidosLiberada`; ninguém
 * mais lê a opção. A regra em si é `podeLerPedidos` (domain, RN-PRO-01).
 *
 * Fonte: consulta pública `core.promotor_ve_pedidos@1` (modules/core/contracts), avaliada a cada requisição (nunca em
 * cache, JWT ou sessão). Consulta indisponível (Core inativo/não registrado) ou com falha = padrão do contrato: LIGADA.
 */
import { CONSULTA_PROMOTOR_VE_PEDIDOS, PROMOTOR_VE_PEDIDOS_PADRAO } from '@macuxi/core/contracts';
import { ErroHttpModulo, type ContextoBase } from '@macuxi/platform-sdk';
import { podeLerPedidos } from '../domain/leitura-pedido';

export type LeitorOpcaoPromotor = (ctx: ContextoBase) => boolean | Promise<boolean>;

/** Lê `core.promotor_ve_pedidos@1` numa transação do tenant; indisponível ou falha = padrão do contrato (ligada). */
const daConsultaDoCore: LeitorOpcaoPromotor = async (ctx) => {
  try {
    const r = await ctx.comTenant((_db, tx) => tx.consultar(CONSULTA_PROMOTOR_VE_PEDIDOS, {}));
    return r.ligado;
  } catch {
    return PROMOTOR_VE_PEDIDOS_PADRAO;
  }
};
let leitor: LeitorOpcaoPromotor = daConsultaDoCore;

/** Opção `promotor_ve_pedidos` do tenant do usuário. Único ponto de leitura da opção no Vendedor. */
export async function promotorVePedidos(ctx: ContextoBase): Promise<boolean> {
  return leitor(ctx);
}

/** Troca o leitor (só teste); o padrão é a consulta do Core. Devolve a função que restaura o anterior. */
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
