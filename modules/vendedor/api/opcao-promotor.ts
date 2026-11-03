/**
 * Ponto ÚNICO da opção `promotor_ve_pedidos` do perfil Promotor (O-3 do doc 03, decisão de 2026-11-02).
 * Lista, detalhe e pull de pedido/item/evento passam por `exigirLeituraDePedidos` / `leituraDePedidosLiberada`; ninguém
 * mais lê a opção. A regra em si é `podeLerPedidos` (domain, RN-PRO-01).
 *
 * TODO(core): trocar o padrão de `promotorVePedidos` pela consulta pública do Core (modules/core/contracts) que o
 * modulo-core publicará para ler essa opção. Até lá, vale o padrão de fábrica: LIGADA.
 */
import { ErroHttpModulo, type ContextoBase } from '@macuxi/platform-sdk';
import { podeLerPedidos } from '../domain/leitura-pedido';

export type LeitorOpcaoPromotor = (ctx: ContextoBase) => boolean | Promise<boolean>;

/** Padrão de fábrica enquanto a consulta do Core não existe: opção ligada. */
const padrao: LeitorOpcaoPromotor = () => true;
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
