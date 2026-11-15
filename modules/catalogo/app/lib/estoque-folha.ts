/**
 * Folha "Estoque por filial" e filtro de filial do Catálogo no app (docs/design/catalogo-campo-v2/spec.md §2.1 e §4). Puro, testável
 * em Node; as regras (quem vê quais filiais, texto e cor) são do domain (`estoque-campo.ts`, `estoque.ts`).
 */
import type { ItemVitrine } from '../../contracts';
import { AVISO_ESTOQUE_DESATUALIZADO, rotuloAtualizacaoEstoque } from '../../domain/estoque';
import { linhasDaFolhaEstoque, type LinhaFolhaEstoque } from '../../domain/estoque-campo';

export const TITULO_FOLHA_ESTOQUE = 'Estoque por filial';

export interface DadosDaFolha {
  titulo: string;
  /** "PAF.1434 · Atualizado às 07:28" (RN-CAT-07). */
  apoio: string;
  linhas: LinhaFolhaEstoque[];
  /** Uma frase por filial para o TalkBack: "Boa Vista, sua filial, estoque 0". */
  leitura: { id: string; texto: string }[];
}

export function dadosDaFolha(e: { codigo: string; availability: NonNullable<ItemVitrine['availability']>; proprias: readonly string[]; agora: string; fuso: string }): DadosDaFolha {
  const a = e.availability;
  const hora = rotuloAtualizacaoEstoque(a, e.agora, e.fuso);
  const mostrar = a.quantity !== null || a.by_branch.some((b) => b.quantity !== null);
  const linhas = linhasDaFolhaEstoque(a.by_branch, { proprias: e.proprias, mostrarQuantidade: mostrar, marcarPropria: false });
  return {
    titulo: TITULO_FOLHA_ESTOQUE,
    apoio: `${e.codigo} · ${a.stale ? `${AVISO_ESTOQUE_DESATUALIZADO} · ` : ''}${hora}`,
    linhas,
    leitura: linhas.map((l) => ({ id: l.id, texto: `${l.nome}${l.propria ? ', sua filial' : ''}, ${mostrar ? `estoque ${l.valor.replace('−', 'menos ')}` : l.valor.toLowerCase()}` })),
  };
}

export interface OpcaoFiltroFilial {
  /** Id da filial ou `todas`. */
  valor: string;
  rotulo: string;
  apoio: string | null;
}

/**
 * Grupo "Filial" da folha "Filtrar" (spec §4), igual para todo perfil: "Suas filiais (N)" (padrão, soma das de venda) e cada uma delas;
 * com uma só, o grupo não aparece. `proprias` = filiais de venda (RN-CORE-39).
 */
export function opcoesDoFiltroFilial(e: { proprias: readonly string[]; filiais: readonly { id: string; nome: string }[] }): OpcaoFiltroFilial[] {
  const ordem = (a: { nome: string }, b: { nome: string }) => a.nome.localeCompare(b.nome, 'pt-BR');
  const minhas = e.filiais.filter((f) => e.proprias.includes(f.id)).sort(ordem);
  if (minhas.length <= 1) return [];
  return [{ valor: 'todas', rotulo: `Suas filiais (${minhas.length})`, apoio: null }, ...minhas.map((f) => ({ valor: f.id, rotulo: f.nome, apoio: null }))];
}
