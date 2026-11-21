/**
 * RN-CAT-19: "é nome de veículo" tirado da própria base do tenant. É veículo a palavra que aparece nas aplicações dos produtos
 * pelo menos `RAZAO_VEICULO` vezes mais do que nos nomes e descrições (e em pelo menos `MINIMO_APLICACOES_VEICULO` produtos).
 * Cálculo puro, feito uma vez por carga (aparelho), por índice (servidor) ou por lista de produtos (`veiculosDe`): a busca só
 * consulta o conjunto pronto. A mesma conta vale para a busca online, a do aparelho e o seletor do pedido.
 *
 * Ocorrência = produto que tem a palavra (a mesma palavra repetida no mesmo campo conta uma vez). A palavra é comparada inteira,
 * sem o singular ("polo" e "polos" são palavras diferentes), com 3 ou mais letras e sem dígito.
 */
import { palavrasInteiras, tokensDeBusca } from './texto';

/** A palavra precisa aparecer pelo menos 5 vezes mais nas aplicações do que nos nomes e descrições. */
export const RAZAO_VEICULO = 5;
/**
 * Premissa: mínimo de produtos com a palavra na aplicação para ela virar veículo. Sem ele, numa base pequena (ou com a palavra só
 * nas aplicações, "razão" 0 no nome), qualquer palavra solta de uma aplicação viraria veículo e deixaria de casar por começo
 * de palavra. Três produtos distinguem um modelo que se repete de um texto que aparece uma vez.
 */
export const MINIMO_APLICACOES_VEICULO = 3;

/** RN-CAT-20: tamanho mínimo de cada pedaço, no modelo derivado, nas palavras da base e nas vizinhas juntas. */
export const PEDACO_MINIMO = 3;

/** Palavra só de letras minúsculas com pelo menos `PEDACO_MINIMO` letras. */
export const soLetras = (w: string): boolean => w.length >= PEDACO_MINIMO && /^[a-z]+$/.test(w);

/**
 * Os nomes de veículo da base (RN-CAT-19) e, para cada um, as palavras grudadas da base de que ele é o começo ou o fim (RN-CAT-20).
 * É um `Set` de nomes, então quem só pergunta "é veículo?" não muda; a busca lê `derivadas` para casar CrossFox e SpaceFox por "fox".
 */
export class NomesDeVeiculo extends Set<string> {
  /** Nome de veículo → palavras derivadas dele (inteiras e no singular, sem repetição). Só tem chave quem tem derivada. */
  readonly derivadas: ReadonlyMap<string, readonly string[]>;
  /**
   * Palavras da base (só letras, com 2 pedaços de 3+ caracteres = 6 ou mais) que podem ser a palavra grudada de duas vizinhas da busca
   * (RN-CAT-20). O FTS5 do aparelho só consulta a palavra junta que existe aqui: "cafe acucar" não gasta uma consulta à toa.
   */
  readonly palavrasLongas: ReadonlySet<string>;

  constructor(nomes: Iterable<string> = [], derivadas: ReadonlyMap<string, readonly string[]> = new Map(), palavrasLongas: ReadonlySet<string> = new Set()) {
    super(nomes);
    this.derivadas = derivadas;
    this.palavrasLongas = palavrasLongas;
  }
}

/**
 * RN-CAT-20: palavras da base que são o nome de veículo mais um pedaço de 3+ caracteres, antes ou depois. Roda uma vez na carga
 * (cada palavra é partida em todos os pontos), nunca por busca.
 */
function derivadasDeVeiculos(veiculos: ReadonlySet<string>, palavras: Iterable<string>): Map<string, string[]> {
  const saida = new Map<string, Set<string>>();
  const guardar = (v: string, w: string) => {
    let l = saida.get(v);
    if (!l) saida.set(v, (l = new Set()));
    l.add(w);
    const singular = tokensDeBusca(w)[0]; // o índice guarda as palavras no singular; a busca por palavra inteira confere as duas formas
    if (singular !== undefined && singular !== w) l.add(singular);
  };
  for (const w of palavras) {
    for (let k = PEDACO_MINIMO; k <= w.length - PEDACO_MINIMO; k++) {
      const comeco = w.slice(0, k);
      const fim = w.slice(k);
      if (veiculos.has(comeco)) guardar(comeco, w); // o veículo é o começo e o resto tem 3+ (k <= tamanho - 3)
      if (veiculos.has(fim)) guardar(fim, w); // o veículo é o fim e o começo tem 3+ (k >= 3)
    }
  }
  return new Map([...saida].map(([v, l]) => [v, [...l].sort()]));
}

/** O que a base lê de um produto (do Catálogo, do índice ou do aparelho). */
export interface ProdutoDaBase {
  nome: string;
  descricao?: string | null | undefined;
  aplicacao?: string | null | undefined;
}

/** Um produto da contagem: nome + descrição, e a aplicação como texto (vazia = sem aplicação). */
export interface FonteVeiculo {
  nomeEDescricao: string;
  aplicacao: string;
}

/** Contador incremental (a carga do índice cede o laço entre os pedaços). */
export class ContadorVeiculos {
  private readonly nomes = new Map<string, number>();
  private readonly aplicacoes = new Map<string, number>();

  acrescentar(f: FonteVeiculo): void {
    this.contar(f.nomeEDescricao, this.nomes);
    if (f.aplicacao !== '') this.contar(f.aplicacao, this.aplicacoes);
  }

  private contar(texto: string, destino: Map<string, number>): void {
    const vistas = new Set<string>();
    for (const p of palavrasInteiras(texto)) {
      if (soLetras(p) && !vistas.has(p)) {
        vistas.add(p);
        destino.set(p, (destino.get(p) ?? 0) + 1);
      }
    }
  }

  concluir(): NomesDeVeiculo {
    const veiculos = new Set<string>();
    for (const [p, nA] of this.aplicacoes) if (nA >= MINIMO_APLICACOES_VEICULO && nA >= RAZAO_VEICULO * (this.nomes.get(p) ?? 0)) veiculos.add(p);
    // RN-CAT-20: as palavras da base (nomes, descrições e aplicações) são as candidatas a derivada
    const palavras = new Set([...this.nomes.keys(), ...this.aplicacoes.keys()]);
    return new NomesDeVeiculo(veiculos, derivadasDeVeiculos(veiculos, palavras), new Set([...palavras].filter((w) => w.length >= 2 * PEDACO_MINIMO)));
  }
}

export function nomesDeVeiculo(fontes: Iterable<FonteVeiculo>): NomesDeVeiculo {
  const c = new ContadorVeiculos();
  for (const f of fontes) c.acrescentar(f);
  return c.concluir();
}

/** Fonte de um produto do Catálogo (só os ativos entram na base). */
export const fonteDoProduto = (p: ProdutoDaBase): FonteVeiculo => ({ nomeEDescricao: `${p.nome} ${p.descricao ?? ''}`, aplicacao: p.aplicacao ?? '' });

const DA_LISTA = new WeakMap<readonly object[], ReadonlySet<string>>();

/** O conjunto de uma lista de produtos, guardado enquanto a lista for o mesmo objeto (o repositório troca a lista quando o cadastro muda). */
export function veiculosDe(produtos: readonly (ProdutoDaBase & { ativo: boolean })[]): ReadonlySet<string> {
  let v = DA_LISTA.get(produtos);
  if (!v) {
    v = nomesDeVeiculo(produtos.filter((p) => p.ativo).map(fonteDoProduto));
    DA_LISTA.set(produtos, v);
  }
  return v;
}

/** A carga já calculou o conjunto (por exemplo, com a aplicação que não fica na memória do aparelho): `veiculosDe` devolve esse. */
export function definirVeiculos(produtos: readonly object[], veiculos: ReadonlySet<string>): void {
  DA_LISTA.set(produtos, veiculos);
}
