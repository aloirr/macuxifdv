/**
 * Estoque do Campo v2 (docs/design/catalogo-campo-v2/spec.md §2.1, §3 e §4; RN-CAT-05 revista, RN-CORE-39). Funções puras: valor de N
 * por perfil e filtro, quem vê quais filiais, texto e cor do "Estoque: N" e as linhas da folha "Estoque por filial".
 * O promotor VÊ o estoque (só o preço segue `promotor_ve_preco_estoque`); promotor, supervisor e gerente veem só as filiais deles.
 */
import type { Perfil } from '@macuxi/platform-sdk';
import type { FaixaEstoque } from '../contracts';

/** Filtro de filial escolhido na tela: `null` = o padrão do perfil; `'todas'` = "Todas as filiais"; senão o id da filial. */
export type FiltroFilial = string | 'todas' | null;

const SO_SUAS_FILIAIS: readonly Perfil[] = ['promotor', 'supervisor', 'gerente'];

/** spec §4: promotor, supervisor e gerente veem estoque só das filiais deles (`core.filiais_do_usuario@1`). */
export const veSoSuasFiliais = (perfil: Perfil): boolean => SO_SUAS_FILIAIS.includes(perfil);

export interface EntradaFiliaisDoCartao {
  perfil: Perfil;
  /** Filiais do próprio usuário (`core.filiais_do_usuario@1` na API; `UsuarioSync.filial_ids` no aparelho). */
  proprias: readonly string[];
  /** Filial efetiva do cliente do contexto (RN-CORE-39); nulo = sem cliente. */
  filialDoCliente: string | null;
  filtro: FiltroFilial;
  /** Escopo antigo (carteira; `null` = todas) para os perfis que não têm filial própria (admin, analista, assistente). */
  escopoCarteira: readonly string[] | null;
}

/**
 * spec §3, valor de N: filiais cuja soma é o `Estoque: N`. `null` = todas. Com cliente vale a filial dele; sem cliente, a escolhida;
 * sem escolha, a(s) filial(is) do usuário. Quem só vê as suas filiais nunca passa delas (interseção, RN-CAT-05).
 */
export function filiaisDoCartao(e: EntradaFiliaisDoCartao): readonly string[] | null {
  const restrito = veSoSuasFiliais(e.perfil);
  const dentro = (ids: readonly string[]): readonly string[] => (restrito ? ids.filter((id) => e.proprias.includes(id)) : ids);
  if (e.filialDoCliente !== null) return dentro([e.filialDoCliente]);
  if (e.filtro !== null && e.filtro !== 'todas') return dentro([e.filtro]);
  if (e.filtro === 'todas') return restrito ? [...e.proprias] : null;
  if (restrito) return [...e.proprias];
  if (e.perfil === 'vendedor' && e.proprias.length > 0) return [...e.proprias];
  return e.escopoCarteira === null ? null : [...e.escopoCarteira];
}

/** spec §4: filiais da folha "Estoque por filial". `null` = todas (o vendedor vê todas); os demais, só as deles. */
export function filiaisDaFolha(e: { perfil: Perfil; proprias: readonly string[] }): readonly string[] | null {
  return veSoSuasFiliais(e.perfil) ? [...e.proprias] : null;
}

const MENOS = '−';
const LIMITE_CARTAO = 999;

/**
 * spec §3: "Estoque: N" (sem saldo = 0). No cartão acima de 999 vira "999+" (e abaixo de -999 "−999+"); a ficha e a folha trazem o
 * exato (`noCartao = false`). Tenant que esconde a quantidade: "Em estoque" ou "Sem estoque".
 */
export function textoEstoqueCartao(quantidade: number | null, noCartao: boolean, mostrarQuantidade = true): string {
  const n = quantidade ?? 0;
  if (!mostrarQuantidade) return n > 0 ? 'Em estoque' : 'Sem estoque';
  return `Estoque: ${numeroDoEstoque(n, noCartao)}`;
}

export function numeroDoEstoque(n: number, noCartao: boolean): string {
  if (noCartao && n > LIMITE_CARTAO) return `${LIMITE_CARTAO}+`;
  if (noCartao && n < -LIMITE_CARTAO) return `${MENOS}${LIMITE_CARTAO}+`;
  return n < 0 ? `${MENOS}${Math.abs(n).toLocaleString('pt-BR')}` : n.toLocaleString('pt-BR');
}

/** catalogo-grade §4: duas cores, verde acima de 0; vermelho em 0, negativo ou sem saldo (o laranja de 1 a 9 saiu). */
export function corDoEstoque(quantidade: number | null): 'sucesso' | 'erro' {
  return (quantidade ?? 0) > 0 ? 'sucesso' : 'erro';
}

export interface RotuloChipFiliais {
  texto: string;
  /** Com ✕ (volta ao padrão do perfil). */
  removivel: boolean;
}

/**
 * spec §4: chip do filtro de filial. Vários: "Suas filiais (3)" sem ✕ (fora delas não há nada para abrir); uma só: "Filial Boa Vista"
 * sem ✕ (quem só vê as suas) ou com ✕ (vendedor: o ✕ mostra "Todas as filiais", que não tem chip: `null`).
 */
export function rotuloChipFiliais(e: { perfil: Perfil; nomesProprias: readonly string[]; escolhida: string | null }): RotuloChipFiliais | null {
  const restrito = veSoSuasFiliais(e.perfil);
  if (e.escolhida === 'todas') return restrito ? { texto: nomesDoGrupo(e.nomesProprias), removivel: false } : null;
  if (e.escolhida !== null) return { texto: `Filial ${e.escolhida}`, removivel: true };
  if (restrito) return { texto: nomesDoGrupo(e.nomesProprias), removivel: false };
  const so = e.nomesProprias[0];
  return so ? { texto: `Filial ${so}`, removivel: true } : null;
}

const nomesDoGrupo = (nomes: readonly string[]): string => (nomes.length > 1 ? `Suas filiais (${nomes.length})` : `Filial ${nomes[0] ?? ''}`.trim());

export interface LinhaFolhaEstoque {
  id: string;
  nome: string;
  valor: string;
  /** Marca "sua filial" (só para o vendedor, spec §2.1). */
  propria: boolean;
  tom: 'sucesso' | 'erro';
}

/** spec §2.1: uma linha por filial; as do usuário primeiro, cada grupo em ordem alfabética; negativo com o sinal de menos. */
export function linhasDaFolhaEstoque(
  porFilial: readonly { branch_id: string; branch_name: string; quantity: number | null; band?: FaixaEstoque }[],
  o: { proprias: readonly string[]; mostrarQuantidade: boolean; marcarPropria: boolean },
): LinhaFolhaEstoque[] {
  const ordem = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'pt-BR');
  const linhas = porFilial.map((b) => {
    const q = b.quantity ?? (b.band && b.band !== 'sem_estoque' ? 1 : 0);
    return {
      id: b.branch_id,
      nome: b.branch_name,
      valor: o.mostrarQuantidade ? numeroDoEstoque(b.quantity ?? 0, false) : textoEstoqueCartao(q, false, false),
      propria: o.proprias.includes(b.branch_id),
      tom: corDoEstoque(q),
    };
  });
  const minhas = linhas.filter((l) => l.propria).sort(ordem);
  const outras = linhas.filter((l) => !l.propria).sort(ordem);
  return [...minhas, ...outras].map((l) => ({ ...l, propria: o.marcarPropria && l.propria }));
}
