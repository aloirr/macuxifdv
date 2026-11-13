/**
 * Pedido em nome do vendedor (RF-GES-05, RN-VEN-35). O MOTOR do pedido é do Vendedor (extensão `pedido.criar_em_nome`
 * e ação de mesmo nome para supervisor e gerente, ver manifesto do Vendedor); o Gestor decide só se a função
 * APARECE e para QUEM (escopo, RN-CORE-04), e monta o contexto: `vendedor_id` = vendedor, `autor_id` = gestor.
 * A API do Vendedor revalida tudo (perfil, escopo e alçada do gestor, RN-VEN-10).
 */
import { LIMITE_DESCONTO_PADRAO, type LimiteDesconto } from '@macuxi/core/contracts';
import { ContextoPedidoEmNome, type DisponibilidadeEmNome, type MembroEquipe } from '../contracts';
import { escopoDoUsuario, podeVer } from './equipe';

const PERFIS_EM_NOME: ReadonlySet<MembroEquipe['perfil']> = new Set<MembroEquipe['perfil']>(['supervisor', 'gerente']);

export interface EntradaDisponibilidade {
  autor: { id: string; perfil: MembroEquipe['perfil'] };
  vendedor_id: string;
  membros: readonly MembroEquipe[];
  modulos: ReadonlySet<string>;
}

export function disponibilidadePedidoEmNome(e: EntradaDisponibilidade): DisponibilidadeEmNome {
  // RN-CORE-03: sem o Vendedor a função some, sem erro
  if (!e.modulos.has('vendedor')) return { visivel: false, permitido: false, codigo: 'MODULO_VENDEDOR_INATIVO', mensagem: null };
  // matriz do doc 03: só supervisor/gerente criam pedido em nome do vendedor
  if (!PERFIS_EM_NOME.has(e.autor.perfil)) return { visivel: false, permitido: false, codigo: 'PERFIL_SEM_ACESSO', mensagem: null };
  if (!podeVer(escopoDoUsuario(e.autor, e.membros), e.vendedor_id)) {
    return { visivel: true, permitido: false, codigo: 'FORA_DO_ESCOPO', mensagem: 'Este vendedor não é da sua equipe. Escolha um vendedor da sua equipe para fazer o pedido.' };
  }
  const alvo = e.membros.find((x) => x.id === e.vendedor_id);
  if (alvo?.perfil === 'promotor') {
    return { visivel: true, permitido: false, codigo: 'VENDEDOR_INVALIDO', mensagem: 'O promotor não faz pedido (RN-PRO-01). Escolha um vendedor.' };
  }
  if (!alvo || alvo.perfil !== 'vendedor' || !alvo.ativo) {
    return { visivel: true, permitido: false, codigo: 'VENDEDOR_INVALIDO', mensagem: 'Este vendedor está inativo. Escolha outro vendedor da equipe.' };
  }
  return { visivel: true, permitido: true, codigo: null, mensagem: null };
}

/** Contexto entregue à extensão do Vendedor (RN-VEN-35). Autor igual ao vendedor não é "em nome". */
export function contextoPedidoEmNome(entrada: unknown): { ok: true; contexto: ContextoPedidoEmNome } | { ok: false; erros: string[] } {
  const r = ContextoPedidoEmNome.safeParse(entrada);
  if (!r.success) return { ok: false, erros: r.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`) };
  if (r.data.autor_id === r.data.vendedor_id) return { ok: false, erros: ['O pedido do próprio vendedor segue o fluxo normal do Vendedor; "em nome" é só para o gestor.'] };
  return { ok: true, contexto: r.data };
}

/**
 * RN-VEN-11a (T-0168, casos 19 e 20): as funções e o limite de desconto que valem no pedido em nome são os do AUTOR
 * (o gestor), nunca os do vendedor. A linha vem do `usuario` do sync (app) ou da consulta do Core (API); sem linha,
 * vale o padrão. A trava em si é do Vendedor (`decisaoDoDesconto`), que recebe este limite.
 */
export function limiteDoPedidoEmNome(contexto: Pick<ContextoPedidoEmNome, 'autor_id' | 'vendedor_id'>, limites: ReadonlyMap<string, Partial<LimiteDesconto>>): LimiteDesconto {
  return { ...LIMITE_DESCONTO_PADRAO, ...(limites.get(contexto.autor_id) ?? {}) };
}
