/**
 * Estoque do Campo v2 (docs/design/catalogo-campo-v2/spec.md §2.1, §3 e §4; RN-CAT-05 revista, RN-CORE-39). Funções puras: valor de N
 * por perfil e filtro, quem vê quais filiais, texto e cor do "Estoque: N" e as linhas da folha "Estoque por filial".
 * O promotor VÊ o estoque (só o preço segue `promotor_ve_preco_estoque`); todo perfil vê só as filiais de VENDA dele (`filial_venda_ids`).
 */
import { localDate } from '@macuxi/comum';
import { FilialDoUsuarioSchema } from '@macuxi/core/contracts';
import type { FaixaEstoque } from '../contracts';
import { ROTULO_FAIXA_ESTOQUE, ROTULO_SEM_HORA } from './estoque';

/** Filtro de filial escolhido na tela: `null` = o padrão do perfil; `'todas'` = "Todas as filiais"; senão o id da filial. */
export type FiltroFilial = string | 'todas' | null;

/** Filiais do usuário como o Catálogo as lê (`core.filiais_do_usuario@1`, RN-CORE-39). */
export interface FiliaisDoUsuario {
  /** Filiais de venda (`filial_venda_ids`): base de preço, estoque, filtro e folha, para todos os perfis. */
  filiaisVenda: readonly string[];
  /** Filial de cadastro (`filial_cadastro_id`): só a faixa do cabeçalho; nunca entra na soma do estoque. */
  filialCadastro: string | null;
  /** Sem filial de cadastro: o usuário está bloqueado; preço e estoque saem vazios. */
  semFilial: boolean;
}

/**
 * ÚNICO leitor da saída de `core.filiais_do_usuario@1` (API) e da linha `usuario` do sync (app), validado pelo `FilialDoUsuarioSchema`.
 * Fora do contrato = `null` (a API trata como sem filial; o app, como estoque recebido sem lista).
 */
export function lerFiliaisDoUsuario(saida: unknown): FiliaisDoUsuario | null {
  const r = FilialDoUsuarioSchema.safeParse(saida);
  if (!r.success) return null;
  const ids = [...new Set(r.data.filial_venda_ids)].sort();
  return { filiaisVenda: ids, filialCadastro: r.data.filial_cadastro_id, semFilial: r.data.sem_filial || ids.length === 0 };
}

export interface FiltroDoEstoque {
  /** Filial efetiva do cliente do contexto (RN-CORE-39); nulo = sem cliente. */
  filialDoCliente: string | null;
  filtro: FiltroFilial;
}

/**
 * ÚNICA função que decide as filiais cuja soma é o `Estoque: N` do cartão, da busca e da ficha (spec §3; RN-CAT-05, RN-CORE-39).
 * Com cliente vale a filial dele; sem cliente, uma filial escolhida só ela; senão (padrão ou "Suas filiais") a soma das filiais de venda.
 * Ninguém passa das filiais de venda (interseção); `sem_filial` = nenhuma. Sempre uma lista (vazia = N 0). Trocar a regra do N
 * (ex.: filial de cadastro no cartão e a soma só na folha) é mexer SÓ aqui.
 */
export function filiaisDoEstoque(usuario: FiliaisDoUsuario, e: FiltroDoEstoque): readonly string[] {
  if (usuario.semFilial) return [];
  const venda = usuario.filiaisVenda;
  const dentro = (ids: readonly string[]): readonly string[] => ids.filter((id) => venda.includes(id));
  if (e.filialDoCliente !== null) return dentro([e.filialDoCliente]);
  if (e.filtro !== null && e.filtro !== 'todas') return dentro([e.filtro]);
  return [...venda];
}

/** spec §4: filiais da folha "Estoque por filial" = as de venda do usuário (todos os perfis); `sem_filial` = nenhuma. */
export const filiaisDaFolha = (usuario: FiliaisDoUsuario): readonly string[] => filiaisDoEstoque(usuario, { filialDoCliente: null, filtro: null });

const MENOS = '−';
const LIMITE_CARTAO = 999;

/**
 * spec §3: "Estoque: N" (sem saldo = 0). No cartão acima de 999 vira "999+" (e abaixo de -999 "−999+"); a ficha e a folha trazem o
 * exato (`noCartao = false`). Tenant que esconde a quantidade: "Em estoque" ou "Sem estoque".
 */
export function textoEstoqueCartao(quantidade: number | null, noCartao: boolean, mostrarQuantidade = true): string {
  const n = quantidade ?? 0;
  if (!mostrarQuantidade) return n > 0 ? EM_ESTOQUE : SEM_ESTOQUE;
  return `Estoque: ${numeroDoEstoque(n, noCartao)}`;
}

const EM_ESTOQUE = 'Em estoque';
const SEM_ESTOQUE = ROTULO_FAIXA_ESTOQUE.sem_estoque;

/** Quantidade que decide texto e cor: o número do ERP; tenant que esconde a quantidade manda só a faixa (com estoque = 1, sem = 0). */
function quantidadeDoEstoque(quantity: number | null, band?: FaixaEstoque | null): number {
  return quantity ?? (band && band !== 'sem_estoque' ? 1 : 0);
}

/**
 * spec §3: texto e cor do chip `Estoque: N` (cartão, busca e ficha), num lugar só. `noCartao` = "999+" acima de 999 (a ficha traz o
 * exato). Tenant que esconde a quantidade (`quantity` nulo): decide pela faixa, "Em estoque" verde ou "Sem estoque" vermelho.
 */
export function chipDoEstoque(a: { quantity: number | null; band?: FaixaEstoque | null }, noCartao: boolean): { texto: string; tom: 'sucesso' | 'erro'; leitura: string } {
  const q = quantidadeDoEstoque(a.quantity, a.band);
  const mostrar = a.quantity !== null;
  const texto = textoEstoqueCartao(q, noCartao, mostrar);
  // leitura de tela: o mesmo valor, sem os dois-pontos e com o sinal lido como "menos"; sem quantidade, "Em estoque"/"Sem estoque"
  const leitura = mostrar ? `Estoque ${numeroDoEstoque(q, noCartao).replace(MENOS, 'menos ')}` : texto;
  return { texto, tom: corDoEstoque(q), leitura };
}

/** Frase do TalkBack para um valor de estoque: "estoque menos 3" (o sinal − lido como "menos"); sem quantidade, "em estoque"/"sem estoque". */
export function leituraDoEstoque(valor: string, mostrarQuantidade: boolean): string {
  return mostrarQuantidade ? `estoque ${valor.replace(MENOS, 'menos ')}` : valor.toLowerCase();
}

/** spec §4: rótulo do padrão do filtro de filial, no chip e na folha "Filtrar". */
export const rotuloSuasFiliais = (n: number): string => `Suas filiais (${n})`;

function numeroDoEstoque(n: number, noCartao: boolean): string {
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
 * spec §4: chip do filtro de filial, só para quem tem mais de uma filial de venda (com uma só, a faixa do Catálogo já a mostra).
 * Padrão: "Suas filiais (3)" sem ✕; uma escolhida: "Filial X" com ✕ (o ✕ volta a "Suas filiais").
 */
export function rotuloChipFiliais(e: { nomesProprias: readonly string[]; escolhida: string | null }): RotuloChipFiliais {
  if (e.escolhida !== null && e.escolhida !== 'todas') return { texto: `Filial ${e.escolhida}`, removivel: true };
  return { texto: rotuloSuasFiliais(e.nomesProprias.length), removivel: false };
}

export interface LinhaFolhaEstoque {
  id: string;
  nome: string;
  valor: string;
  /** Marca "sua filial" (filial de cadastro, spec §2.1). */
  propria: boolean;
  tom: 'sucesso' | 'erro';
}

/** spec §2.1: uma linha por filial, na ordem recebida (a de `estoqueVisivel`: cadastro primeiro, depois alfabética); negativo com o sinal de menos. */
export function linhasDaFolhaEstoque(
  porFilial: readonly { branch_id: string; branch_name: string; quantity: number | null; band?: FaixaEstoque }[],
  o: { filialCadastro: string | null; mostrarQuantidade: boolean },
): LinhaFolhaEstoque[] {
  const linhas = porFilial.map((b) => {
    const q = quantidadeDoEstoque(b.quantity, b.band);
    return {
      id: b.branch_id,
      nome: b.branch_name,
      valor: o.mostrarQuantidade ? numeroDoEstoque(b.quantity ?? 0, false) : textoEstoqueCartao(q, false, false),
      propria: b.branch_id === o.filialCadastro,
      tom: corDoEstoque(q),
    };
  });
  return linhas;
}

/**
 * Decisão 5 do R-20261115-100000: "Atualizado às 06:12" (hoje), "Atualizado ontem às 06:12", "Atualizado em 12/11 às 06:12" (mais antigo).
 * `cargaEm` é a hora da carga do estoque NO APARELHO (UTC), mostrada no fuso do tenant; o dia também é o do tenant. Sem carimbo: "Sem hora de atualização".
 */
export function rotuloCargaEstoque(cargaEm: string | null, agora: string, fuso: string): string {
  const t = cargaEm === null ? null : new Date(cargaEm);
  const a = new Date(agora);
  if (t === null || Number.isNaN(t.getTime()) || Number.isNaN(a.getTime())) return ROTULO_SEM_HORA;
  const hora = new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(t);
  const dia = localDate(t, fuso);
  if (dia === localDate(a, fuso)) return `Atualizado às ${hora}`;
  if (dia === localDate(new Date(a.getTime() - 86_400_000), fuso)) return `Atualizado ontem às ${hora}`;
  return `Atualizado em ${new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit' }).format(t)} às ${hora}`;
}
