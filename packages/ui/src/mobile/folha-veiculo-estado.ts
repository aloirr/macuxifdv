/**
 * Parte PURA da `FolhaVeiculo` (filtro de veículo: spec docs/design/filtro-veiculo/spec.md §4, §9 e §11; desenho técnico
 * docs/desenho/filtro-veiculo.md §6.3). Sem react-native: roda em Node (Vitest).
 * Só tipos estruturais e a fiação da cascata (abrir no último nível escolhido, voltar, aplicar, quando há grade e "Ver peças").
 * Quem diz os níveis, as opções, o que se preenche sozinho e os rótulos é o domain do Catálogo (pela consulta e pela `navegacao`).
 */

/** `curto` = etiqueta (`Gol 2018 1.0`); `completo` = leitor de tela (`Volkswagen Gol 2018 1.0`). Chegam prontos da consulta. */
type Rotulos = { curto: string; completo: string };

/** Um passo já escolhido; `automatico` = nível de uma opção só, preenchido sozinho. */
export type PassoDaCascata = { nivel: string; valor: string; rotulo: string; automatico: boolean };

/** Resultado da busca da folha; `nivel` diz o que ele é (montadora leva ao Modelo; modelo, ao Ano). */
export type ResultadoDaBusca = { valor: string; rotulo: string; apoio: string | null; nivel?: string };

/** O que a consulta da cascata devolve (forma de `catalogo.veiculos@1`, só estrutural). */
export interface CascataConsultada<E, V> {
  /** Falso = sem veículo no catálogo: a folha não aparece. */
  disponivel: boolean;
  trilha: readonly PassoDaCascata[];
  /** Nulo = não há mais nível a escolher (aplica e fecha). */
  nivel: string | null;
  opcoes: readonly { valor: string; rotulo: string; apoio: string | null }[];
  /** Tocar numa opção deste nível aplica e fecha (sem "Ver peças"). */
  ultimo: boolean;
  escolha: E;
  rotulos: Rotulos | null;
  busca: readonly ResultadoDaBusca[] | null;
  recentes: readonly { veiculo: V; rotulos: Rotulos }[];
}

/** Os apoios puros do módulo dono da regra (o Catálogo passa `NAVEGACAO_VEICULO`). Métodos: bivariantes no parâmetro. */
export interface NavegacaoCascata<E, V> {
  vazia: E;
  doVeiculo(v: V): E;
  veiculoDe(e: E): V | null;
  antesDoPasso(trilha: readonly PassoDaCascata[], indice: number): E;
  escolher(e: E, nivel: string, valor: string): E;
  daBusca(r: ResultadoDaBusca): E;
  /** O nível mostrado na grade de 4 colunas (`ano`). */
  nivelEmGrade: string;
  /** Os níveis com o principal "Ver peças" no pé, fora do último (`ano`, `motor`, `versao`). */
  niveisComVerPecas: readonly string[];
}

/** Espera antes do `Loading` embutido no nível (spec §9: só se passar de 300 ms). */
export const ESPERA_CARREGANDO_FOLHA_VEICULO_MS = 300;

/** Teto da volta ao abrir (5 níveis + 1): nunca fica girando quando todos os passos são automáticos. */
const MAX_VOLTAS_AO_ABRIR = 6;

/** Índice do passo a refazer ao voltar: o último escolhido pelo vendedor (os automáticos voltam sozinhos); sem nenhum, o 1º. */
export function indiceParaVoltar(trilha: readonly PassoDaCascata[]): number {
  const k = trilha.map((p) => p.automatico).lastIndexOf(false);
  return k < 0 ? 0 : k;
}

/** O veículo e os rótulos da cascata, quando já há o que aplicar (com modelo); senão, nulo. */
export function aplicacaoDaCascata<E, V>(c: CascataConsultada<E, V>, navegacao: NavegacaoCascata<E, V>): { veiculo: V; rotulos: Rotulos } | null {
  const veiculo = navegacao.veiculoDe(c.escolha);
  return veiculo && c.rotulos ? { veiculo, rotulos: c.rotulos } : null;
}

/** O que fazer com a resposta de um toque: aplicar e fechar (não há mais nível) ou mostrar o novo nível. */
export function destinoDaCascata<E, V>(c: CascataConsultada<E, V>, navegacao: NavegacaoCascata<E, V>, aplicarSeFechou: boolean): { tipo: 'aplicar'; veiculo: V; rotulos: Rotulos } | { tipo: 'mostrar' } {
  if (aplicarSeFechou && c.nivel === null) {
    const a = aplicacaoDaCascata(c, navegacao);
    if (a) return { tipo: 'aplicar', ...a };
  }
  return { tipo: 'mostrar' };
}

/**
 * Ao abrir: no último nível escolhido. Com o veículo aplicado, a consulta não tem mais nível; volta ao passo que o vendedor
 * escolheu por último (spec §3: "abre a folha no último nível escolhido"). Sem veículo, no 1º nível.
 */
export async function abrirCascata<E, V>(
  consultar: (entrada: { escolha: E }) => Promise<CascataConsultada<E, V> | null>,
  navegacao: NavegacaoCascata<E, V>,
  aplicado: V | null,
): Promise<CascataConsultada<E, V> | null> {
  let c = await consultar({ escolha: aplicado ? navegacao.doVeiculo(aplicado) : navegacao.vazia });
  for (let i = 0; c && c.nivel === null && c.trilha.length > 0 && i < MAX_VOLTAS_AO_ABRIR; i++) {
    c = await consultar({ escolha: navegacao.antesDoPasso(c.trilha, indiceParaVoltar(c.trilha)) });
  }
  return c;
}

/** 1º nível = trilha vazia: só nele há a busca da folha e os Recentes. */
export const noPrimeiroNivel = (c: { trilha: readonly unknown[] }): boolean => c.trilha.length === 0;

/** Grade de 4 colunas só no nível da `navegacao` (o Ano). */
export const nivelEmGrade = (nivel: string | null, navegacao: { nivelEmGrade: string }): boolean => nivel !== null && nivel === navegacao.nivelEmGrade;

/** "Ver peças" no pé: só nos níveis da `navegacao` e fora do último nível (lá, tocar já aplica e fecha). */
export function mostrarVerPecas(c: { nivel: string | null; ultimo: boolean }, navegacao: { niveisComVerPecas: readonly string[] }): boolean {
  return c.nivel !== null && !c.ultimo && navegacao.niveisComVerPecas.includes(c.nivel);
}
