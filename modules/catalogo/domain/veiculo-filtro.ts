/**
 * RN-CAT-22 (D4): filtro de veículo em cascata (montadora › modelo › ano › motor › versão); o filtro só restringe pelo que o vendedor
 * escolheu (a peça aparece ou não aparece, sem "de conferir"), "Leve também" e a contagem dos chips da folha Filtrar. Funções puras sobre o `IndiceVeiculos` (`veiculo-indice.ts`): o mesmo resultado no aparelho
 * (sem sinal) e na API. Spec `docs/design/filtro-veiculo/spec.md` §4 a §7; desenho `docs/desenho/filtro-veiculo.md` §3.
 */
import type { GrupoFiltro, GruposFiltro, NivelVeiculo, OpcaoVeiculo, PassoTrilha, RotulosVeiculo, VeiculoEscolhido, VeiculoParcial, VeiculoRecente, VeiculosSaida } from '../contracts';
import { normalizarTexto } from './texto';
import { apelidosDeMontadora, indiceTemVeiculo, type EntradaVeiculo, type IndiceVeiculos } from './veiculo-indice';

export const NIVEIS_VEICULO: readonly NivelVeiculo[] = ['montadora', 'modelo', 'ano', 'motor', 'versao'];
/** Quantos resultados a busca da folha mostra. */
export const MAXIMO_BUSCA_VEICULO = 30;

const chave = (s: string | null | undefined): string | null => (s === null || s === undefined || s.trim() === '' ? null : normalizarTexto(s));
const ptBr = (a: string, b: string) => a.localeCompare(b, 'pt-BR');

interface Filtro {
  montadora: string | null;
  modelo: string | null;
  ano: number | null;
  motor: string | null;
  versao: string | null;
}

const filtroDe = (v: VeiculoParcial): Filtro => ({ montadora: chave(v.montadora), modelo: chave(v.modelo), ano: v.ano ?? null, motor: chave(v.motor), versao: chave(v.versao) });

const nomeDe = (i: IndiceVeiculos, c: string): string => i.nomes.get(c) ?? c;

/** Entradas do modelo escolhido (montadora igual ou não escrita). */
function entradasDoModelo(i: IndiceVeiculos, f: Filtro): readonly EntradaVeiculo[] {
  if (f.modelo === null) return [];
  return (i.doModelo.get(f.modelo) ?? []).filter((e) => f.montadora === null || e.montadora === null || e.montadora === f.montadora);
}

/** RN-CAT-22: nível escolhido, o trecho tem de trazer o valor (sem o dado, não passa); nível não escolhido não filtra. */
const nivelPassa = <T>(escolhido: T | null, doTrecho: readonly T[]): boolean => escolhido === null || doTrecho.includes(escolhido);

/** O trecho passa em cada nível ESCOLHIDO (ano, motor, versão), menos em `exceto` (o nível cujas opções se listam). */
function passaNosEscolhidos(f: Filtro, e: EntradaVeiculo, exceto?: NivelVeiculo): boolean {
  return (exceto === 'ano' || nivelPassa(f.ano, e.anos)) && (exceto === 'motor' || nivelPassa(f.motor, e.motores)) && (exceto === 'versao' || nivelPassa(f.versao, e.versoes));
}

/**
 * Opções (chaves) de um nível, dado o que foi escolhido: só aparece opção que leva a alguma peça, com o MESMO predicado do filtro
 * (`nivelPassa`): o trecho sem o ano (ou sem o motor) escolhido não alimenta as opções dos níveis seguintes.
 */
function opcoesDoNivel(i: IndiceVeiculos, nivel: NivelVeiculo, f: Filtro): string[] {
  switch (nivel) {
    case 'montadora':
      return [...i.modelosDaMontadora].filter(([, m]) => m.length > 0).map(([k]) => k).sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b)));
    case 'modelo': {
      const modelos = f.montadora ? (i.modelosDaMontadora.get(f.montadora) ?? []) : [...i.doModelo.keys()];
      return [...modelos].sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b)));
    }
    case 'ano':
      return [...new Set(entradasDoModelo(i, f).filter((e) => passaNosEscolhidos(f, e, 'ano')).flatMap((e) => e.anos))].sort((a, b) => b - a).map(String);
    case 'motor':
      return [...new Set(entradasDoModelo(i, f).filter((e) => passaNosEscolhidos(f, e, 'motor')).flatMap((e) => e.motores))].sort((a, b) => Number(a) - Number(b));
    case 'versao':
      return [...new Set(entradasDoModelo(i, f).filter((e) => passaNosEscolhidos(f, e, 'versao')).flatMap((e) => e.versoes))].sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b)));
  }
}

const rotuloDaOpcao = (i: IndiceVeiculos, nivel: NivelVeiculo, c: string): string => (nivel === 'ano' || nivel === 'motor' ? c : nomeDe(i, c));

export function rotulosDoVeiculo(v: VeiculoParcial): RotulosVeiculo | null {
  if (!v.modelo) return null;
  const junta = (xs: (string | number | null | undefined)[]) => xs.filter((x) => x !== null && x !== undefined && x !== '').join(' ');
  return { curto: junta([v.modelo, v.ano, v.motor, v.versao]), completo: junta([v.montadora, v.modelo, v.ano, v.motor, v.versao]) };
}

export interface NavegacaoVeiculo {
  trilha: PassoTrilha[];
  nivel: NivelVeiculo | null;
  opcoes: OpcaoVeiculo[];
  ultimo: boolean;
  escolha: VeiculoParcial;
  rotulos: RotulosVeiculo | null;
  busca: OpcaoVeiculo[] | null;
}

/** Busca da folha: modelo e montadora pelo nome e pelos apelidos (RN-CAT-15). Montadora primeiro, depois os modelos. */
function buscarNaCascata(i: IndiceVeiculos, texto: string, apelidos: ReadonlyMap<string, string>): OpcaoVeiculo[] {
  const q = normalizarTexto(texto);
  if (q === '') return [];
  const casa = (c: string) => c.startsWith(q) || c.split(' ').some((p) => p.startsWith(q));
  const montadoras = new Set<string>();
  for (const k of i.modelosDaMontadora.keys()) if (casa(k)) montadoras.add(k);
  for (const [apelido, nomeCompleto] of apelidos) {
    const k = normalizarTexto(nomeCompleto);
    if (i.modelosDaMontadora.has(k) && (apelido === q || apelido.startsWith(q))) montadoras.add(k);
  }
  const saida: OpcaoVeiculo[] = [...montadoras].sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b))).map((k) => ({ valor: nomeDe(i, k), rotulo: nomeDe(i, k), apoio: null, nivel: 'montadora' as const }));
  const montadoraDe = new Map<string, string | null>();
  for (const e of i.entradas) if (!montadoraDe.has(e.modelo)) montadoraDe.set(e.modelo, e.montadora);
  const modelos = [...i.doModelo.keys()].filter(casa).sort((a, b) => ptBr(nomeDe(i, a), nomeDe(i, b)));
  for (const m of modelos) {
    const mont = montadoraDe.get(m) ?? null;
    saida.push({ valor: nomeDe(i, m), rotulo: nomeDe(i, m), apoio: mont ? nomeDe(i, mont) : null, nivel: 'modelo' });
  }
  return saida.slice(0, MAXIMO_BUSCA_VEICULO);
}

/**
 * RN-CAT-22: a cascata. Só mostra opções que existem nas aplicações; nível com uma opção só se preenche sozinho (`automatico` na
 * trilha); nível sem opção é pulado; ano do mais novo ao mais velho e o resto em ordem alfabética. `apelidos` (chave → nome da montadora)
 * vem do chamador porque é a lista padrão do domínio mais os sinônimos do tenant.
 */
export function navegarCascata(indice: IndiceVeiculos, escolha: VeiculoParcial, busca?: string, apelidos: ReadonlyMap<string, string> = new Map()): NavegacaoVeiculo {
  const f = filtroDe(escolha);
  // RN-CAT-22 (R-20261121-211200): o nível de uma opção só entra na trilha (`automatico`), mas só o que o vendedor escolheu filtra; montadora e
  // modelo automáticos são o veículo (sem eles não há lista), então seguem na escolha. `mostrado` = o que a trilha exibe.
  const mostrado: Filtro = { ...f };
  const autos = new Set<NivelVeiculo>();
  let nivel: NivelVeiculo | null = null;
  let opcoes: string[] = [];
  for (const n of NIVEIS_VEICULO) {
    if (n === 'montadora' ? f.montadora !== null || f.modelo !== null : n === 'modelo' ? f.modelo !== null : f[n] !== null) continue;
    const o = opcoesDoNivel(indice, n, f);
    if (o.length === 0) continue;
    if (o.length === 1) {
      if (n === 'ano') mostrado.ano = Number(o[0]);
      else mostrado[n] = o[0]!;
      if (n === 'montadora' || n === 'modelo') f[n] = o[0]!;
      autos.add(n);
      continue;
    }
    nivel = n;
    opcoes = o;
    break;
  }
  const valorDe = (n: NivelVeiculo, c: string | number | null): string | null => (c === null ? null : n === 'ano' || n === 'motor' ? String(c) : nomeDe(indice, c as string));
  const trilha: PassoTrilha[] = [];
  for (const n of NIVEIS_VEICULO) {
    const v = valorDe(n, mostrado[n]);
    if (v !== null) trilha.push({ nivel: n, valor: v, rotulo: v, automatico: autos.has(n) });
  }
  const sai: VeiculoParcial = {
    montadora: valorDe('montadora', f.montadora),
    modelo: valorDe('modelo', f.modelo),
    ano: f.ano,
    motor: valorDe('motor', f.motor),
    versao: valorDe('versao', f.versao),
  };
  // `ultimo`: depois deste nível nenhum outro tem opção (para qualquer escolha dele)
  let ultimo = nivel !== null;
  if (nivel !== null) {
    const depois = NIVEIS_VEICULO.slice(NIVEIS_VEICULO.indexOf(nivel) + 1);
    const base: Filtro = { ...f };
    for (const n of depois) {
      if (n === 'montadora' || n === 'modelo') continue;
      if (opcoesDoNivel(indice, n, { ...base, ano: nivel === 'ano' ? null : base.ano, motor: nivel === 'motor' ? null : base.motor }).length > 0) ultimo = false;
    }
    if (nivel === 'montadora' || nivel === 'modelo') ultimo = false;
  }
  return {
    trilha,
    nivel,
    opcoes: opcoes.map((c) => ({ valor: valorDe(nivel!, c)!, rotulo: rotuloDaOpcao(indice, nivel!, c), apoio: null })),
    ultimo,
    escolha: sai,
    rotulos: rotulosDoVeiculo(sai),
    busca: busca !== undefined && busca.trim() !== '' ? buscarNaCascata(indice, busca, apelidos) : null,
  };
}

/** A saída de `catalogo.veiculos@1` quando o catálogo (ou o escopo) não tem veículo: o botão Veículo não aparece. */
export const SEM_VEICULO: VeiculosSaida = { disponivel: false, trilha: [], nivel: null, opcoes: [], ultimo: false, escolha: {}, rotulos: null, busca: null, recentes: [] };

/**
 * A resposta de `catalogo.veiculos@1` sobre um índice (já restrito ao escopo): a mesma no aparelho e na API. Sem veículo no índice,
 * `SEM_VEICULO`; `recentes` só o aparelho tem (a API passa `[]`).
 */
export function saidaDaCascata(indice: IndiceVeiculos, entrada: { escolha?: VeiculoParcial | undefined; busca?: string | undefined }, recentes: VeiculoRecente[]): VeiculosSaida {
  if (!indiceTemVeiculo(indice)) return SEM_VEICULO;
  return { disponivel: true, ...navegarCascata(indice, entrada.escolha ?? {}, entrada.busca, apelidosDeMontadora()), recentes };
}

// ---------- serve ou não serve ----------
export type SituacaoVeiculo = 'compativel' | 'nao_serve' | 'universal';

export interface Compatibilidade {
  situacao: SituacaoVeiculo;
  /** O trecho da aplicação que serve no veículo (a ficha o põe em negrito); nulo fora de `compativel`. */
  segmento: EntradaVeiculo | null;
}

function compatibilidadeCom(indice: IndiceVeiculos, f: Filtro, produtoId: string): Compatibilidade {
  const entradas = indice.doProduto.get(produtoId);
  if (!entradas || entradas.length === 0) return { situacao: 'universal', segmento: null };
  const doModelo = new Set(entradasDoModelo(indice, f));
  const e = entradas.find((x) => doModelo.has(x) && passaNosEscolhidos(f, x));
  return e ? { situacao: 'compativel', segmento: e } : { situacao: 'nao_serve', segmento: null };
}

/**
 * RN-CAT-22 (D4): o produto no veículo escolhido. `compativel` = algum trecho do modelo traz o ano, o motor e a versão ESCOLHIDOS (o que não
 * foi escolhido não filtra); `nao_serve` = nenhum trecho serve (inclusive o trecho sem o dado escolhido); `universal` = aplicação vazia ou
 * sem nome de veículo.
 */
export function compatibilidadeDoProduto(indice: IndiceVeiculos, produtoId: string, veiculo: VeiculoEscolhido): Compatibilidade {
  return compatibilidadeCom(indice, filtroDe(veiculo), produtoId);
}

/**
 * RN-CAT-22 (D4): só os produtos que servem no veículo, na ordem que veio (a do ranking ou a da vitrine). O universal e o que não serve
 * saem. A peça aparece ou não aparece: não há "de conferir".
 */
export function filtrarPorVeiculo<T extends { produto_id: string }>(itens: readonly T[], indice: IndiceVeiculos, veiculo: VeiculoEscolhido): T[] {
  const f = filtroDe(veiculo);
  return itens.filter((item) => compatibilidadeCom(indice, f, item.produto_id).situacao === 'compativel');
}

/** Ids dos produtos que citam o modelo (o conjunto de partida da lista sem texto); o `filtrarPorVeiculo` decide o resto. */
export function produtosDoModelo(indice: IndiceVeiculos, veiculo: VeiculoParcial): Set<string> {
  return new Set(entradasDoModelo(indice, filtroDe(veiculo)).map((e) => e.produto));
}

/**
 * RN-CAT-22 / RN-CAT-11 (D3): "Leve também". Sem veículo, a lista de hoje; com veículo, só os que passam no filtro e os universais.
 */
export function leveTambemDoVeiculo<T extends { produto_id: string }>(ofereceJunto: readonly T[], indice: IndiceVeiculos, veiculo: VeiculoEscolhido | null): T[] {
  if (!veiculo) return [...ofereceJunto];
  const f = filtroDe(veiculo);
  return ofereceJunto.filter((o) => {
    const s = compatibilidadeCom(indice, f, o.produto_id).situacao;
    return s === 'compativel' || s === 'universal';
  });
}

// ---------- folha Filtrar com contagem (D1) ----------
export interface GrupoDeClassificacao {
  grupo: GrupoFiltro;
  rotulo: string;
  opcoes: readonly { id: string; nome: string; produtos: ReadonlySet<string> }[];
}

/**
 * RN-CAT-22 (D1): os chips da folha Filtrar com a contagem. `produtos` = ids da lista de agora ANTES dos grupos (veículo, busca e
 * `Só com estoque` já aplicados); cada grupo conta aplicando os OUTROS grupos marcados. Chip com 0 sai, salvo o marcado; grupo com uma
 * opção só sai. `marcados` = grupo → id do chip marcado.
 * `cruzar: false` (grupos em cascata da árvore, cada um com as opções do que está marcado acima): o marcado de um grupo não corta a contagem dos
 * outros, senão o marcado mais fundo zeraria os irmãos dos grupos de cima e o grupo sumiria da folha.
 */
export function contarChipsFiltrar(produtos: Iterable<string>, classificacao: readonly GrupoDeClassificacao[], marcados: Partial<Record<GrupoFiltro, string | null>>, { cruzar = true }: { cruzar?: boolean } = {}): GruposFiltro {
  const base = [...produtos];
  const saida: GruposFiltro = [];
  for (const g of classificacao) {
    let lista = base;
    for (const outro of classificacao) {
      const id = marcados[outro.grupo];
      if (!cruzar || outro.grupo === g.grupo || !id) continue;
      const alvo = outro.opcoes.find((o) => o.id === id);
      if (alvo) lista = lista.filter((p) => alvo.produtos.has(p));
    }
    const chips = g.opcoes
      .map((o) => ({ grupo: g.grupo, id: o.id, nome: o.nome, contagem: lista.reduce((n, p) => n + (o.produtos.has(p) ? 1 : 0), 0), marcado: marcados[g.grupo] === o.id }))
      .filter((c) => c.contagem > 0 || c.marcado);
    if (chips.length >= 2) saida.push({ grupo: g.grupo, rotulo: g.rotulo, chips });
  }
  return saida;
}
