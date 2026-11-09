/**
 * Índice de pré-seleção da busca (T-0119, D-T0107b): com 20 mil produtos, ranquear o catálogo inteiro a cada pedido
 * custava ~4 s de CPU. O índice invertido (termo → produtos) devolve, antes do ranking, um SUPERCONJUNTO exato dos
 * produtos que podem ter nota textual maior que zero ou casar por código; o ranking (`rankear`) segue igual e só roda
 * neles. Termo da consulta casa termo do índice pelos mesmos critérios de `nivelDaPalavra` (exato, prefixo, digitação).
 * Função pura; o índice vale para uma lista de produtos e um ano (a aplicação expande faixas de anos).
 */
import type { FiltrosInterpretados } from '../contracts';
import { anoCivilNoFuso } from './ano-civil';
import { expandirAplicacao } from './aplicacao';
import { casaComCodigo, casaComFiltros, cmp, codigoCompacto, codigosDaConsulta, nivelDaPalavra, nomeChave, notaFinal, soCasaExato, toleranciaDaPalavra } from './ranking';
import { chaveDeTermo, expandirSinonimos, tokensDeBusca, tokensDeBuscaSemMemo, type SinonimoDoTenant } from './texto';
import { aplicarChips, entraNaVitrine, temEstoqueParaBusca, type ChipsVitrine, type ContextoVitrine, type ProdutoCatalogo } from './vitrine';
import { filtrosParaPerfil } from './visibilidade';

/** Abaixo disto o ranking completo é barato e o índice não compensa. */
export const MINIMO_PARA_INDICE = 2000;
/**
 * Teto de candidatos que entram no ranking completo (T-0119, D-T0107b). Acima dele `cortarCandidatos` fica com os melhores por uma
 * nota barata (acertos no índice + os mesmos boosts do ranking). Com o corte, o `total` da busca para em `TETO_CANDIDATOS` (a tela pede
 * para refinar; sem corte ele para em `LIMITE_RESULTADOS_BUSCA`, 500). Medido: ~0,3 ms por candidato no ranking completo.
 */
export const TETO_CANDIDATOS = 200;

/** Termos → posições, mais o vocabulário ordenado por tamanho (varre só os termos de tamanho compatível) e a máscara de cada termo. */
export interface SubIndice {
  porTermo: ReadonlyMap<string, readonly number[]>;
  termos: readonly string[];
  /** Máscara de 32 bits dos caracteres de cada termo (mesma ordem de `termos`): descarta cedo o termo que não pode estar a `tolerancia` edições da palavra. */
  mascaras: Int32Array;
}

export interface IndiceBusca {
  produtos: readonly ProdutoCatalogo[];
  anoAtual: number;
  /** Termos de nome, código, marca, categoria e atributos → posições em `produtos`. */
  texto: SubIndice;
  /** Termos da aplicação (com os anos das faixas expandidos), separados porque a nota e a ordem tratam esse campo à parte (RN-CAT-12). */
  aplicacao: SubIndice;
  /** Anos que a aplicação cobre, por posição (`null` = sem aplicação ou sem ano): o ano da consulta fora deles tira o produto (RN-CAT-12). */
  anos: readonly (readonly number[] | null)[];
  /** Códigos exatos (EAN cru, SKU e referências compactados) → posições. */
  porCodigo: ReadonlyMap<string, readonly number[]>;
}

/** Bit `código do caractere mod 32` de cada caractere do texto. */
function mascaraDe(t: string): number {
  let m = 0;
  for (let i = 0; i < t.length; i++) m |= 1 << (t.charCodeAt(i) & 31);
  return m;
}
function bits(n: number): number {
  n -= (n >>> 1) & 0x55555555;
  n = (n & 0x33333333) + ((n >>> 2) & 0x33333333);
  return (((n + (n >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
}

function acrescentar(m: Map<string, number[]>, termo: string, i: number): void {
  if (!termo) return;
  const l = m.get(termo);
  if (!l) m.set(termo, [i]);
  else if (l[l.length - 1] !== i) l.push(i);
}

export function construirIndiceBusca(produtos: readonly ProdutoCatalogo[], anoAtual: number): IndiceBusca {
  const porTermo = new Map<string, number[]>();
  const porTermoApl = new Map<string, number[]>();
  const porCodigo = new Map<string, number[]>();
  const anos: (readonly number[] | null)[] = new Array<readonly number[] | null>(produtos.length).fill(null);
  produtos.forEach((p, i) => {
    const texto = (t: string | null | undefined) => {
      for (const x of tokensDeBuscaSemMemo(t ?? '')) acrescentar(porTermoApl, x, i);
    };
    const termos = (t: string | null | undefined) => {
      for (const x of tokensDeBusca(t ?? '')) acrescentar(porTermo, x, i);
    };
    termos(p.nome);
    termos(`${p.sku} ${p.ean ?? ''}`.trim());
    acrescentar(porTermo, chaveDeTermo(p.sku), i);
    acrescentar(porTermo, chaveDeTermo(p.ean ?? ''), i);
    acrescentar(porTermo, codigoCompacto(p.sku), i);
    termos(p.marca);
    termos(p.categoria);
    termos(p.atributos.map((x) => `${x.name} ${x.value}`).join(' '));
    for (const r of p.referencias ?? []) {
      termos(r.codigo);
      acrescentar(porTermo, codigoCompacto(r.codigo), i);
      acrescentar(porCodigo, codigoCompacto(r.codigo), i);
    }
    const apl = p.aplicacao ?? '';
    if (apl !== '') {
      texto(apl);
      const e = expandirAplicacao(apl, { anoAtual });
      texto(e.textoIndice);
      if (e.anos.length > 0) anos[i] = e.anos;
    }
    acrescentar(porCodigo, codigoCompacto(p.sku), i);
    if (p.ean) acrescentar(porCodigo, p.ean, i);
  });
  const sub = (m: Map<string, number[]>): SubIndice => {
    const termos = [...m.keys()].sort((a, b) => a.length - b.length);
    return { porTermo: m, termos, mascaras: Int32Array.from(termos, mascaraDe) };
  };
  return { produtos, anoAtual, texto: sub(porTermo), aplicacao: sub(porTermoApl), anos, porCodigo };
}

/** Percorre os termos do índice que a palavra casa (exato, prefixo ou erro de digitação), com o nível do casamento. */
function casamentos(indice: SubIndice, palavra: string, aoCasar: (posicoes: readonly number[], nivel: number) => void): void {
  const exato = indice.porTermo.get(palavra);
  if (exato) aoCasar(exato, nivelDaPalavra(palavra, palavra));
  // medidas e códigos (com dígito) só casam exatos; palavras curtas só exatas (ver `nivelDaPalavra`)
  if (soCasaExato(palavra) || palavra.length < 3) return;
  const tolerancia = toleranciaDaPalavra(palavra);
  const menor = palavra.length - tolerancia;
  // termos de tamanho >= menor; o prefixo exige termo maior que a palavra, a digitação até `+ tolerancia`
  let ini = 0;
  let fim = indice.termos.length;
  while (ini < fim) {
    const m = (ini + fim) >> 1;
    if (indice.termos[m]!.length < menor) ini = m + 1;
    else fim = m;
  }
  const mascaraP = mascaraDe(palavra);
  for (let k = ini; k < indice.termos.length; k++) {
    const t = indice.termos[k]!;
    if (t === palavra) continue;
    if (t.length > palavra.length + tolerancia && !t.startsWith(palavra)) {
      // acima do alcance da digitação só o prefixo conta; sem prefixo não há como casar
      continue;
    }
    // cada caractere da palavra que não existe no termo custa pelo menos uma edição
    if (t.length <= palavra.length + tolerancia && !t.startsWith(palavra) && bits(mascaraP & ~indice.mascaras[k]!) > tolerancia) continue;
    const nivel = nivelDaPalavra(palavra, t);
    if (nivel > 0) aoCasar(indice.porTermo.get(t)!, nivel);
  }
}

/** Posições dos produtos que têm algum termo que a palavra casa (exato, prefixo ou erro de digitação). */
export function posicoesDaPalavra(indice: IndiceBusca, palavra: string, destino: Set<number>): void {
  for (const sub of [indice.texto, indice.aplicacao]) {
    casamentos(sub, palavra, (posicoes) => {
      for (const i of posicoes) destino.add(i);
    });
  }
}

/** Melhor nível (1 exato, 0,7 prefixo, 0,5 digitação) da palavra em cada produto. */
function niveisDaPalavra(indice: SubIndice, palavra: string): Map<number, number> {
  const m = new Map<number, number>();
  casamentos(indice, palavra, (posicoes, nivel) => {
    for (const i of posicoes) if ((m.get(i) ?? 0) < nivel) m.set(i, nivel);
  });
  return m;
}

const indices = new WeakMap<readonly ProdutoCatalogo[], IndiceBusca>();

/** Índice da lista (guardado enquanto a lista for o mesmo objeto; o repositório troca a lista quando o cadastro muda). */
export function indiceDe(produtos: readonly ProdutoCatalogo[], anoAtual: number): IndiceBusca {
  const i = indices.get(produtos);
  if (i && i.anoAtual === anoAtual) return i;
  const novo = construirIndiceBusca(produtos, anoAtual);
  indices.set(produtos, novo);
  return novo;
}

export interface EntradaCandidatos {
  produtos: readonly ProdutoCatalogo[];
  contexto: Pick<ContextoVitrine, 'perfil' | 'parametros' | 'agora'>;
  filtros: FiltrosInterpretados;
  chips?: ChipsVitrine;
  sinonimos: readonly SinonimoDoTenant[];
  semantica?: ReadonlyMap<string, number>;
  anoAtual?: number;
  fuso?: string;
  /** Padrão `MINIMO_PARA_INDICE`. */
  minimo?: number;
}

export interface Candidatos {
  produtos: ProdutoCatalogo[];
  /** Nota barata de cada candidato (mesma ordem de `produtos`), para `cortarCandidatos`: acertos no índice sem o peso do campo. */
  pre?: { pontos: number; exato: boolean; soAplicacao: boolean }[];
  /** Maior `vendas` entre os candidatos do ranking completo (normaliza o boost; não pode mudar com a pré-seleção). */
  maxVendas: number;
}

/** Marca e linha do filtro (os de preço e estoque já foram descartados: nesses casos não há pré-seleção). */
const passaCadastro = (p: ProdutoCatalogo, f: FiltrosInterpretados) => casaComFiltros({ marca: p.marca, categoria: p.categoria, preco_cents: null, estoque: 0 }, f);

/**
 * Pré-seleção da busca (T-0119): os produtos ativos que podem aparecer no resultado e o `maxVendas` do ranking completo.
 * `null` = não vale pré-selecionar (catálogo pequeno, sem texto nem código, nota semântica, filtro de preço ou de estoque,
 * ou "só vendáveis", que dependem do cartão de cada produto): o chamador usa a lista inteira, como antes.
 * Invariante (testada contra `buscarProdutos` sobre a lista inteira): mesmos itens, mesma ordem, mesmo `total`.
 */
export function candidatosDaBusca(e: EntradaCandidatos): Candidatos | null {
  if (e.produtos.length < (e.minimo ?? MINIMO_PARA_INDICE)) return null;
  if ((e.semantica?.size ?? 0) > 0 || e.chips?.only_sellable) return null;
  const filtros = filtrosParaPerfil(aplicarChips(e.filtros, e.chips ?? {}), e.contexto.perfil, e.contexto.parametros);
  if (filtros.min_price_cents !== null || filtros.max_price_cents !== null || filtros.stock !== null) return null;
  const grupos = expandirSinonimos(filtros.text, e.sinonimos);
  if (grupos.length === 0 && !filtros.code) return null;
  const anoAtual = e.anoAtual ?? anoCivilNoFuso(e.contexto.agora, e.fuso);
  const indice = indiceDe(e.produtos, anoAtual);
  const entra = (i: number) => {
    const p = e.produtos[i]!;
    return entraNaVitrine(p, e.chips) && passaCadastro(p, filtros);
  };
  const saida = (posicoes: Iterable<number>): Candidatos => {
    const ordenadas = [...posicoes].sort((a, b) => a - b);
    return { produtos: ordenadas.map((i) => e.produtos[i]!), maxVendas: 0 };
  };

  // código exato (SKU, EAN, referência): se achou, só eles entram (igual ao `rankear`)
  if (filtros.code) {
    const v = codigoCompacto(filtros.code.value);
    const achados = new Set<number>();
    // o índice só aponta; quem decide se o código casa é a mesma função do ranking (`casaComCodigo`)
    for (const i of indice.porCodigo.get(filtros.code.value) ?? []) if (casaComCodigo(e.produtos[i]!, filtros.code)) achados.add(i);
    if (filtros.code.type !== 'ean' && v !== '') for (const i of indice.porCodigo.get(v) ?? []) if (casaComCodigo(e.produtos[i]!, filtros.code)) achados.add(i);
    const validos = [...achados].filter(entra);
    if (validos.length > 0) {
      const r = saida(validos);
      return { ...r, maxVendas: r.produtos.reduce((m, p) => Math.max(m, p.vendas), 0) };
    }
    if (grupos.length === 0) return { produtos: [], maxVendas: 0 };
  }

  // maior venda do universo que o ranking completo enxergaria (todo ativo que passa nos filtros de cadastro)
  let maxVendas = 0;
  for (let i = 0; i < e.produtos.length; i++) if (e.produtos[i]!.vendas > maxVendas && entra(i)) maxVendas = e.produtos[i]!.vendas;

  // por campo (texto × aplicação), por grupo: a melhor alternativa (todas as palavras dela casam; vale o menor nível)
  const palavras = new Set<string>();
  for (const g of grupos) for (const alt of g) for (const w of alt.split(' ')) if (w) palavras.add(w);
  const doGrupo = (sub: SubIndice, g: readonly string[]): Map<number, number> => {
    const niveis = new Map<string, Map<number, number>>();
    for (const w of palavras) niveis.set(w, niveisDaPalavra(sub, w));
    const melhor = new Map<number, number>();
    for (const alt of g) {
      const ws = alt.split(' ').filter(Boolean);
      if (ws.length === 0) continue;
      const atual = new Map(niveis.get(ws[0]!)!);
      for (const w of ws.slice(1)) {
        const outro = niveis.get(w)!;
        for (const [i, n] of atual) {
          const o = outro.get(i);
          if (o === undefined) atual.delete(i);
          else if (o < n) atual.set(i, o);
        }
      }
      for (const [i, n] of atual) if ((melhor.get(i) ?? 0) < n) melhor.set(i, n);
    }
    return melhor;
  };
  const porGrupo = grupos.map((g) => ({ texto: doGrupo(indice.texto, g), aplicacao: doGrupo(indice.aplicacao, g), ano: g.filter((alt) => ANO_RE.test(alt)).map(Number), palavra: g.some((alt) => /[a-z]/.test(alt)) }));
  const alvo = new Set<number>();
  for (const x of porGrupo) {
    for (const i of x.texto.keys()) alvo.add(i);
    for (const i of x.aplicacao.keys()) alvo.add(i);
  }
  // as palavras soltas também entram (um grupo de sinônimos pode ter alternativa com várias palavras): superset exato como antes
  for (const w of palavras) posicoesDaPalavra(indice, w, alvo);
  // n-gramas de código ("cb 3401" → "cb3401") e o código do filtro
  const porCodigo = new Set<number>();
  for (const c of codigosDaConsulta(filtros.text)) for (const i of indice.porCodigo.get(c) ?? []) { alvo.add(i); porCodigo.add(i); }
  const posicoes = [...alvo].filter(entra).sort((a, b) => a - b);
  const pre = posicoes.map((i) => {
    if (porCodigo.has(i)) return { pontos: 1, exato: true, soAplicacao: false };
    let soma = 0;
    let casados = 0;
    let casadosSoAplicacao = 0;
    let casouPalavra = false;
    let tiraPeloAno = false;
    for (const x of porGrupo) {
      const fora = x.texto.get(i) ?? 0;
      const melhor = Math.max(fora, (x.aplicacao.get(i) ?? 0) * PESO_APLICACAO);
      // RN-CAT-12: o ano da consulta que a aplicação (com anos) não cobre tira o produto, salvo se o grupo casar em outro campo
      const anos = indice.anos[i];
      if (anos && fora === 0 && x.ano.length > 0 && !x.ano.some((a) => anos.includes(a))) tiraPeloAno = true;
      if (melhor > 0) {
        casados++;
        if (fora === 0) casadosSoAplicacao++;
        if (x.palavra) casouPalavra = true;
      }
      soma += melhor;
    }
    // número solto não basta quando a consulta também tem palavras (como em `pontuacaoTextual`)
    const temPalavra = porGrupo.some((x) => x.palavra);
    const zerado = tiraPeloAno || (temPalavra && !casouPalavra);
    return { pontos: zerado ? 0 : arred(soma / Math.max(1, grupos.length)), exato: false, soAplicacao: casados > 0 && casadosSoAplicacao === casados };
  });
  return { produtos: posicoes.map((i) => e.produtos[i]!), pre, maxVendas };
}

const ANO_RE = /^(19|20)d{2}$/;
/** `peso_aplicacao` padrão (RN-CAT-12); a nota barata não lê o parâmetro do tenant. */
const PESO_APLICACAO = 0.5;
const arred = (n: number) => Math.round(n * 1e6) / 1e6;

/**
 * Corte dos candidatos antes do ranking completo (T-0119, D-T0107b): o ranking custa ~0,3 ms por produto, e num catálogo de 20 mil
 * uma consulta comum ("pastilha de freio") deixa milhares de candidatos. Acima de `teto`, ficam os melhores por uma nota barata:
 * a mesma conta do ranking (`notaFinal`: boosts de estoque, mais vendido e campanha, exato primeiro) sobre os acertos do índice,
 * com o desempate do ranking. O contexto só precisa do estoque (sem preço: preço não entra na nota, e quem filtra por preço não
 * pré-seleciona). DIFERENÇA ACEITA: a nota barata ignora o peso do campo (nome 1, marca 0,6, categoria 0,4, atributo 0,3,
 * aplicação 0,5), que só o ranking completo aplica; um produto fora do corte por isso pode ser trocado por outro de nota
 * textual um pouco menor. O `maxVendas` não muda e a primeira página de 20 itens bate com o ranking completo nos casos de teste.
 */
export function cortarCandidatos(c: Candidatos, contexto: ContextoVitrine, teto: number = TETO_CANDIDATOS): Candidatos {
  const pre = c.pre;
  if (!pre || c.produtos.length <= teto) return c;
  const p = contexto.parametros;
  // nota textual 0 no ranking (ano fora da aplicação, ou só número): o produto não entra
  const vivos = c.produtos.map((_, k) => k).filter((k) => pre[k]!.exato || pre[k]!.pontos > 0);
  // classes da ordem do ranking: 0 exato, 1 casou fora da aplicação, 2 só pela aplicação (RN-CAT-12). Nenhum boost soma mais que
  // `maiorBoost`: quem tem nota-base a mais que isso abaixo do último que cabe na própria classe (e depois das classes melhores) não entra, e nem é medido.
  const maiorBoost = p.peso_estoque + p.peso_mais_vendido + p.peso_campanha;
  const classe = (k: number) => (pre[k]!.exato ? 0 : pre[k]!.soAplicacao ? 2 : 1);
  const bases: number[][] = [[], [], []];
  for (const k of vivos) bases[classe(k)]!.push(pre[k]!.pontos);
  for (const l of bases) l.sort((x, y) => y - x);
  const pisoDa = (cl: number): number => {
    const adiante = bases.slice(0, cl).reduce((s, l) => s + l.length, 0);
    const resta = teto - adiante;
    if (resta <= 0) return Infinity;
    return (bases[cl]![resta - 1] ?? -Infinity) - maiorBoost;
  };
  const pisos = [-Infinity, pisoDa(1), pisoDa(2)];
  const linhas = vivos.flatMap((k) => {
    const produto = c.produtos[k]!;
    const { pontos, exato, soAplicacao } = pre[k]!;
    if (!exato && pontos < pisos[classe(k)]!) return [];
    const tem = temEstoqueParaBusca(produto, contexto);
    const nota = notaFinal(exato ? 1 : pontos, { estoque: tem ? 1 : 0, vendas_norm: c.maxVendas > 0 ? produto.vendas / c.maxVendas : 0, campanha: produto.campanha }, p);
    return [{ k, produto, pontos, exato, soAplicacao, nota, tem, chave: null as string | null }];
  });
  const chaveDe = (x: (typeof linhas)[number]) => (x.chave ??= nomeChave(x.produto));
  const melhores = linhas
    .sort(
      (a, b) =>
        Number(b.exato) - Number(a.exato) ||
        Number(a.soAplicacao) - Number(b.soAplicacao) ||
        b.nota - a.nota ||
        b.pontos - a.pontos ||
        Number(b.tem) - Number(a.tem) ||
        b.produto.vendas - a.produto.vendas ||
        cmp(chaveDe(a), chaveDe(b)) ||
        cmp(a.produto.id, b.produto.id),
    )
    .slice(0, teto)
    .sort((a, b) => a.k - b.k);
  return { produtos: melhores.map((x) => x.produto), pre: melhores.map((x) => pre[x.k]!), maxVendas: c.maxVendas };
}
