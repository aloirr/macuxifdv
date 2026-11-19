/**
 * Pedido em nome do vendedor (RF-GES-05, RN-VEN-35). Funções puras; a API revalida com elas (nunca confia no app).
 * `vendedor_id` = dono (conta na meta e no ranking, RN-CORE-21); `autor_id` = quem digitou, sempre o usuário do token.
 * RN-VEN-10: o pedido feito pelo gestor usa a alçada do gestor. RN-PRO-01: o promotor nunca cria pedido.
 */
import type { AprovacaoNova, NivelAprovacao, Recusa } from './aprovacao';
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
    // T-0187: texto único da tela e da API ("Vendedor fora da sua equipe"); o rascunho fica no aparelho para escolher outro
    const lugar = e.autor.perfil === 'gerente' ? 'da sua área' : 'da sua equipe';
    return { codigo: 'FORA_DA_EQUIPE', http: 403, mensagem: `Vendedor fora ${lugar}` };
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

// ---------- T-0187: supervisor em campo (pedido aberto pela ficha do cliente) ----------
export interface UsuarioDaEquipe { id: string; nome: string; ativo: boolean; perfil: string; grupo?: string | null }
export interface VinculoDaCarteiraEmNome { usuario_id: string; cliente_id: string }

/**
 * RN-VEN-35 e RN-CORE-04: o vendedor padrão do "Em nome de" é o ÚNICO vendedor ativo da equipe com o cliente na carteira.
 * Zero ou mais de um: `null` (o campo vem vazio, "Escolher"). Promotor nunca é dono de pedido (RN-PRO-01).
 */
export function vendedorPadraoEmNome(e: { clienteId: string; carteira: readonly VinculoDaCarteiraEmNome[]; equipe: readonly UsuarioDaEquipe[] }): string | null {
  const donos = new Set(e.carteira.filter((c) => c.cliente_id === e.clienteId).map((c) => c.usuario_id));
  const candidatos = e.equipe.filter((u) => u.perfil === 'vendedor' && u.ativo && donos.has(u.id));
  return candidatos.length === 1 ? candidatos[0]!.id : null;
}

export interface OpcaoEmNome { id: string; nome: string; da_carteira: boolean; desligado: boolean; motivo: 'Saiu da equipe' | null; grupo: string | null }

/**
 * RN-CORE-04 e RN-VEN-35 (P3 A): quem pode ser o dono do pedido. Só vendedores dentro do escopo do autor (`visiveis`: a equipe do
 * supervisor; as equipes abaixo do gerente), em ordem alfabética. Ficam fora o próprio autor e o promotor (RN-PRO-01).
 * Vendedor inativo aparece desligado, com "Saiu da equipe". `da_carteira` marca "Carteira deste cliente".
 */
export function opcoesEmNome(e: {
  autor: { id: string; perfil: string };
  clienteId: string;
  carteira: readonly VinculoDaCarteiraEmNome[];
  usuarios: readonly UsuarioDaEquipe[];
  visiveis: ReadonlySet<string> | 'tenant';
}): OpcaoEmNome[] {
  const donos = new Set(e.carteira.filter((c) => c.cliente_id === e.clienteId).map((c) => c.usuario_id));
  return e.usuarios
    .filter((u) => u.perfil === 'vendedor' && u.id !== e.autor.id && (e.visiveis === 'tenant' || e.visiveis.has(u.id)))
    .map((u) => ({ id: u.id, nome: u.nome, da_carteira: donos.has(u.id), desligado: !u.ativo, motivo: u.ativo ? null : ('Saiu da equipe' as const), grupo: u.grupo ?? null }))
    .sort((a, b) => a.nome.localeCompare(b.nome, 'pt-BR'));
}

const ORDEM_DO_NIVEL: Record<NivelAprovacao, number> = { supervisor: 0, gerente: 1, analista: 2 };

/** RN-VEN-10 e RN-GES-04 (P4 A): o menor nível que pode decidir o pedido do autor (um acima do dele). Sem autor gestor: `null`. */
export function nivelMinimoDoAutor(perfil: string): NivelAprovacao | null {
  if (perfil === 'supervisor') return 'gerente';
  if (perfil === 'gerente') return 'analista';
  return null;
}

/** RN-GES-04 (P4 A): ninguém aprova o próprio pedido; o motivo que cairia no nível do autor (ou abaixo) sobe um nível. */
export function elevarAoNivelDoAutor<T extends Pick<AprovacaoNova, 'nivel'>>(aprovacoes: readonly T[], perfilDoAutor: string): T[] {
  const minimo = nivelMinimoDoAutor(perfilDoAutor);
  if (!minimo) return [...aprovacoes];
  return aprovacoes.map((a) => (ORDEM_DO_NIVEL[a.nivel] < ORDEM_DO_NIVEL[minimo] ? { ...a, nivel: minimo } : a));
}

/** RN-VEN-35 (P3 A): a venda (meta, comissão, ranking) conta para o vendedor de "Em nome de"; sem ele, para o autor. */
export function donoDaVenda(e: { autor_id: string; vendedor_id?: string | null }): string {
  return e.vendedor_id ? e.vendedor_id : e.autor_id;
}
