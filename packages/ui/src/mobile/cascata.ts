/**
 * Parte PURA da `FolhaCascata` e da `GradeOpcoes` (filtro de veículo: spec docs/design/filtro-veiculo/spec.md §4 e §11;
 * desenho técnico docs/desenho/filtro-veiculo.md §6.2). Sem react-native: roda em Node (Vitest).
 * Só apresentação: quem diz os níveis, as opções, o que se preenche sozinho e o que é o último nível é o domain do Catálogo.
 */
import { ALTURA, colors, radius } from './tokens';

/** Medidas e cores da folha de níveis (tokens existentes; nenhuma cor nova). */
export const FOLHA_CASCATA = {
  /** Linha de opção: 48 dp, nome 16 `ink`, apoio 14 `ink2` embaixo, chevron `ink3` quando há próximo nível. */
  linha: {
    alturaMinima: ALTURA.toque,
    nome: { tamanho: 16, cor: colors.ink },
    apoio: { tamanho: 14, cor: colors.ink2 },
    seta: { tamanho: 16, cor: colors.ink3 },
  },
  /** Cartão branco que agrupa as linhas, com traço `lineSoft` entre elas. */
  cartao: { fundo: colors.surface, borda: colors.line, traco: colors.lineSoft, raio: radius.lg },
  /** Grade do Ano (chip de escolha do kit): 4 colunas, 48 dp, borda `lineStrong`, raio 12, 16/600 tabular. */
  grade: { colunas: 4, vao: 8, altura: ALTURA.toque, raio: radius.md, fundo: colors.surface, borda: colors.lineStrong, texto: { tamanho: 16, cor: colors.ink } },
  /** "Nenhum modelo com "xyz"." no lugar da lista. */
  vazio: { tamanho: 14, cor: colors.ink2 },
  /** Troca de nível: o conteúdo entra deslocado 24 dp e com opacidade 0,4 (simulação da spec), em `MOVIMENTO.avancar`. */
  avanco: { deslocamento: 24, opacidadeInicial: 0.4 },
} as const;

/** Reparte as opções em linhas de `colunas` e completa a última com `null` (a célula vazia guarda o lugar; nada estica). */
export function linhasDaGrade<T>(itens: readonly T[], colunas: number = FOLHA_CASCATA.grade.colunas): (T | null)[][] {
  const n = Math.max(1, Math.floor(colunas));
  const linhas: (T | null)[][] = [];
  for (let i = 0; i < itens.length; i += n) {
    const linha: (T | null)[] = itens.slice(i, i + n);
    while (linha.length < n) linha.push(null);
    linhas.push(linha);
  }
  return linhas;
}

export type ConteudoFolhaCascata = 'busca' | 'buscaVazia' | 'carregando' | 'grade' | 'lista';

/** O que ocupa o meio da folha: texto na busca manda (resultados ou o vazio); sem texto, carregando, grade ou lista. */
export function conteudoDaFolhaCascata(e: { textoBusca: string | undefined; resultados: number; carregando: boolean | undefined; grade: boolean | undefined }): ConteudoFolhaCascata {
  if ((e.textoBusca ?? '').trim()) return e.resultados > 0 ? 'busca' : 'buscaVazia';
  if (e.carregando) return 'carregando';
  return e.grade ? 'grade' : 'lista';
}

/** Recentes só sem texto na busca e com ao menos um (sem nenhum, a seção não aparece). */
export function mostrarRecentes(textoBusca: string | undefined, quantos: number): boolean {
  return !(textoBusca ?? '').trim() && quantos > 0;
}

/** Leitura da opção: "1.0" ou, com apoio, "Gol, Volkswagen" (o leitor junta "botão"). */
export function leituraDaOpcaoCascata(o: { rotulo: string; apoio?: string | null }): string {
  const apoio = (o.apoio ?? '').trim();
  return apoio ? `${o.rotulo}, ${apoio}` : o.rotulo;
}

/** Profundidade do nível atual: os passos já escolhidos (o nível atual fica no rótulo, não na trilha). */
export function profundidadeDaCascata(trilha: ReadonlyArray<unknown>): number {
  return trilha.length;
}

/** De onde o novo nível entra (dp): pela direita ao avançar, pela esquerda ao voltar; 0 no mesmo nível ou com "reduzir movimento". */
export function deslocamentoDoNivel(antes: number, depois: number, reduzir: boolean): number {
  if (reduzir || antes === depois) return 0;
  return depois > antes ? FOLHA_CASCATA.avanco.deslocamento : -FOLHA_CASCATA.avanco.deslocamento;
}
