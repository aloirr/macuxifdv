/**
 * Folha "Estoque por filial" e filtro de filial do Catálogo no app (docs/design/catalogo-campo-v2/spec.md §2.1 e §4). Puro, testável
 * em Node; as regras (quem vê quais filiais, texto e cor) são do domain (`estoque-campo.ts`, `estoque.ts`).
 */
import type { ItemVitrine } from '../../contracts';
import { ordemPorNome } from '../../domain/estoque';
import { subtituloDaGrade } from './grade';
import { leituraDoEstoque, linhasDaFolhaEstoque, rotuloCargaEstoque, rotuloChipFiliais, rotuloSuasFiliais, type LinhaFolhaEstoque, type RotuloChipFiliais } from '../../domain/estoque-campo';

export const TITULO_FOLHA_ESTOQUE = 'Estoque por filial';

/** spec §3: o botão da folha "Estoque por filial" (cartão, busca e ficha) só aparece com mais de uma filial no estoque. */
export const mostraEstoquePorFilial = (a: ItemVitrine['availability']): boolean => (a?.by_branch.length ?? 0) > 1;

export interface DadosDaFolha {
  /** "Atualizado às 06:12": hora da carga do estoque no aparelho (decisão 5 do R-20261115-100000). */
  apoio: string;
  linhas: LinhaFolhaEstoque[];
  /** Uma frase por filial para o TalkBack: "Boa Vista, sua filial, estoque 0". */
  leitura: { id: string; texto: string }[];
}

export function dadosDaFolha(e: { availability: NonNullable<ItemVitrine['availability']>; /** Carimbo da carga do estoque no aparelho (UTC). */ cargaEm: string | null; /** Id da filial de CADASTRO (primeira, "sua filial", spec §2.1). */ filialCadastro: string | null; agora: string; fuso: string }): DadosDaFolha {
  const a = e.availability;
  const hora = rotuloCargaEstoque(e.cargaEm, e.agora, e.fuso);
  const mostrar = a.quantity !== null || a.by_branch.some((b) => b.quantity !== null);
  const linhas = linhasDaFolhaEstoque(a.by_branch, { filialCadastro: e.filialCadastro, mostrarQuantidade: mostrar });
  return {
    apoio: hora,
    linhas,
    leitura: linhas.map((l) => ({ id: l.id, texto: `${l.nome}${l.propria ? ', sua filial' : ''}, ${leituraDoEstoque(l.valor, mostrar)}` })),
  };
}

export interface OpcaoFiltroFilial {
  /** Id da filial ou `todas`. */
  valor: string;
  rotulo: string;
}

/**
 * Grupo "Filial" da folha "Filtrar" (spec §4), igual para todo perfil: "Suas filiais (N)" (padrão, soma das de venda) e cada uma delas;
 * com uma só, o grupo não aparece. `proprias` = filiais de venda (RN-CORE-39).
 */
export function opcoesDoFiltroFilial(e: { proprias: readonly string[]; filiais: readonly { id: string; nome: string }[] }): OpcaoFiltroFilial[] {
  const minhas = e.filiais.filter((f) => e.proprias.includes(f.id)).sort(ordemPorNome);
  if (minhas.length <= 1) return [];
  return [{ valor: 'todas', rotulo: rotuloSuasFiliais(minhas.length) }, ...minhas.map((f) => ({ valor: f.id, rotulo: f.nome }))];
}

export interface ResumoDoFiltro {
  /** Número no selo do botão: filial escolhida (fora do padrão) + "Ocultar" sem estoque. */
  contagem: number;
  /** Etiqueta da filial; nulo quando o grupo Filial não existe (uma filial só). */
  filial: RotuloChipFiliais | null;
  soComEstoque: boolean;
}

/** spec §4: o que o botão e as etiquetas do Catálogo mostram, a partir das opções do grupo Filial e da escolha da folha. */
export function resumoDoFiltro(e: { opcoes: readonly OpcaoFiltroFilial[]; escolha: { filial: string | null; soComEstoque: boolean } }): ResumoDoFiltro {
  const propriasOpcoes = e.opcoes.filter((o) => o.valor !== 'todas');
  const escolhida = e.escolha.filial && e.escolha.filial !== 'todas' ? (propriasOpcoes.find((o) => o.valor === e.escolha.filial)?.rotulo ?? null) : null;
  const filial = e.opcoes.length === 0 ? null : rotuloChipFiliais({ nomesProprias: propriasOpcoes.map((o) => o.rotulo), escolhida });
  return { contagem: (filial?.removivel ? 1 : 0) + (e.escolha.soComEstoque ? 1 : 0), filial, soComEstoque: e.escolha.soComEstoque };
}

/** spec §3: subtítulo da faixa do Catálogo, "Sua filial: Boa Vista · 1.284 produtos"; sem filial de cadastro, só a contagem. */
export const subtituloComFilial = (nomeFilial: string | null, total: number): string => (nomeFilial ? `Sua filial: ${nomeFilial} · ${subtituloDaGrade(total)}` : subtituloDaGrade(total));
