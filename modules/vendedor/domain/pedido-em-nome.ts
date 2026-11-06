/**
 * Pedido em nome do vendedor (RF-GES-05, RN-VEN-35). Funções puras; a API revalida com elas (nunca confia no app).
 * `vendedor_id` = dono (conta na meta e no ranking, RN-CORE-21); `autor_id` = quem digitou, sempre o usuário do token.
 * RN-VEN-10: o pedido feito pelo gestor usa a alçada do gestor. RN-PRO-01: o promotor nunca cria pedido.
 */
import type { Recusa } from './aprovacao';
import type { DiscountPolicy } from './order';

export const PERFIS_EM_NOME = ['supervisor', 'gerente'] as const;

/** Só é "em nome" quando o dono informado é outra pessoa; igual ao autor (ou ausente) segue o fluxo comum. */
export function ehPedidoEmNome(autorId: string, vendedorId: string | null | undefined): boolean {
  return Boolean(vendedorId) && vendedorId !== autorId;
}

export interface EntradaPedidoEmNome {
  autor: { id: string; perfil: string };
  vendedor_id: string;
  /** cadastro do dono (`core.cadastro_resumo@1`); `null` = não existe neste tenant */
  vendedor: { id: string; perfil: string } | null;
  /** usuários que o autor vê (`ctx.usuariosVisiveis()`): equipe do supervisor, equipes abaixo do gerente */
  visiveis: ReadonlySet<string> | 'tenant';
}

/** `null` = pode. Ordem: promotor → perfil do autor → escopo → dono válido. */
export function verificarPedidoEmNome(e: EntradaPedidoEmNome): Recusa | null {
  if (e.autor.perfil === 'promotor') return { codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não cria nem altera pedido.' };
  if (!(PERFIS_EM_NOME as readonly string[]).includes(e.autor.perfil)) {
    return { codigo: 'PERFIL_SEM_ACESSO', http: 403, mensagem: 'Seu perfil não faz pedido em nome de vendedor.' };
  }
  if (e.visiveis !== 'tenant' && !e.visiveis.has(e.vendedor_id)) {
    const lugar = e.autor.perfil === 'gerente' ? 'da sua área' : 'da sua equipe';
    return { codigo: 'FORA_DA_EQUIPE', http: 403, mensagem: `Este vendedor não é ${lugar}. Escolha um vendedor ${lugar} para fazer o pedido.` };
  }
  if (e.vendedor?.perfil === 'promotor') {
    return { codigo: 'RN-PRO-01', http: 403, mensagem: 'RN-PRO-01: o promotor não faz pedido. Escolha um vendedor.' };
  }
  if (!e.vendedor || e.vendedor.perfil !== 'vendedor') {
    return { codigo: 'VENDEDOR_INVALIDO', http: 422, mensagem: 'Vendedor não encontrado ou inativo. Escolha outro vendedor da equipe.' };
  }
  return null;
}

/** RN-VEN-10: % de desconto que o autor aprova sozinho. Supervisor e gerente usam a própria alçada; o resto, a do vendedor. */
export function alcadaDoAutorPct(perfil: string, p: { seller_pct: number; supervisor_pct: number; manager_pct: number }): number {
  if (perfil === 'supervisor') return p.supervisor_pct;
  if (perfil === 'gerente') return p.manager_pct;
  return p.seller_pct;
}

/**
 * RN-VEN-10: política para validar o pedido do gestor. A "alçada do vendedor" vira a do autor e as exceções individuais
 * saem (são do vendedor, não do gestor). Acima dela o pedido sobe ao nível seguinte, como em qualquer pedido.
 */
export function politicaDoAutor(policy: DiscountPolicy, perfil: string): DiscountPolicy {
  return { ...policy, seller_pct: alcadaDoAutorPct(perfil, policy), exceptions: {} };
}

/** RN-VEN-35: rótulo do voltar do Novo pedido; em nome ele é aberto pela ficha do vendedor (Gestão). */
export function rotuloVoltarNovoPedido(vendedorId: string | null | undefined): string {
  return vendedorId ? 'Ficha' : 'Pedidos';
}

/**
 * RN-VEN-35: quem aparece como vendedor no PDF. Em nome, é o dono (nunca o gestor) e o gestor sai em "feito por".
 * Sem o nome do dono no aparelho fica vazio até o pull trazer o pedido do servidor.
 */
export function vendedorDoPdf(e: { dono_nome: string; autor_nome: string; em_nome: boolean }): { seller_name: string; made_by?: string } {
  if (!e.em_nome) return { seller_name: e.autor_nome };
  return { seller_name: e.dono_nome, ...(e.autor_nome ? { made_by: e.autor_nome } : {}) };
}
