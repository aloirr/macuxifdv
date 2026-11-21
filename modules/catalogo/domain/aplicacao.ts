/**
 * Aplicação do produto (descrição 2) na busca (RN-CAT-12; T-0084 §3): expande faixas de anos ("2010–2014") em anos
 * soltos para o índice e a consulta acharem "2012". Função pura: a mesma no aparelho (FTS5 e ranking) e na API.
 * RN-CAT-16 (v1.0.19): além de "2010–2014", lê "até", ">" entre anos, "→", mês/ano, "+", "../08" e ano de 2 dígitos.
 * `anoAtual` é o ano civil no fuso do tenant, vindo do relógio injetado (ADR 0015); nunca `new Date()` aqui.
 */

export interface FaixaAnos {
  de: number;
  ate: number;
  /** Posições no texto original (fim exclusivo). */
  inicio: number;
  fim: number;
}

export interface AplicacaoExpandida {
  /** Anos literais e gerados por faixa, crescentes e sem repetir. */
  anos: number[];
  /** Só as faixas válidas que foram expandidas. */
  faixas: FaixaAnos[];
  /** Texto original + " " + anos gerados que ainda não estão no texto (igual ao texto quando nada foi gerado). */
  textoIndice: string;
}

/** RN-CAT-12: faixa com mais de 40 anos ou invertida não vira faixa (fica só como texto). */
export const FAIXA_MAXIMA_ANOS = 40;
/** RN-CAT-16: ano de 2 dígitos ("07–11", "83-92") vale por padrão (`ano2Digitos` omitido = ligado; não há parâmetro do tenant). */
const APLICACAO_ANO_2_DIGITOS_PADRAO = true;
/** RN-CAT-16: primeiro ano válido. O último é o ano atual + 2 (`anoMaximoValido`). */
export const ANO_MINIMO_VALIDO = 1950;
/** RN-CAT-16: teto fixo do ano válido para quem não depende do relógio (índice do aparelho). */
export const ANO_MAXIMO_INDICE = 2099;
/** RN-CAT-16: ano de 2 dígitos até este valor é 20xx; acima é 19xx. */
const CORTE_ANO_2_DIGITOS = 35;
/** RN-CAT-16: último ano válido para o ano civil `anoAtual`. */
const anoMaximoValido = (anoAtual: number): number => anoAtual + 2;

/** RN-CAT-12: palavra da consulta que é um ano (4 dígitos entre `ANO_MINIMO_VALIDO` e `ANO_MAXIMO_INDICE`). */
export const ehAnoDaConsulta = (palavra: string): boolean => {
  if (!/^\d{4}$/.test(palavra)) return false;
  const n = Number(palavra);
  return n >= ANO_MINIMO_VALIDO && n <= ANO_MAXIMO_INDICE;
};

export interface OpcoesAplicacao {
  /** Ano civil no fuso do tenant (relógio injetado). */
  anoAtual: number;
  /** Ano de 2 dígitos ligado (padrão: `APLICACAO_ANO_2_DIGITOS_PADRAO`). */
  ano2Digitos?: boolean;
  /** Último ano válido, quando não é `anoAtual + 2` (o índice do aparelho não depende do relógio). */
  anoMaximo?: number;
}

/** RN-CAT-12: o ano da consulta que a aplicação (com anos) não cobre faz o grupo do ano não casar. */
export const anoForaDaAplicacao = (anosDaConsulta: readonly number[], anosApl: readonly number[]): boolean =>
  anosDaConsulta.length > 0 && !anosDaConsulta.some((a) => anosApl.includes(a));

/**
 * Número de 2 ou 4 dígitos, com mês opcional antes ("06/2008", "01/89"). Fora: letra/dígito colado, "1.2012", "×" ("4×4"),
 * unidade ou polegada depois (13", 16", "12 mm", "10 cv"), que não são ano.
 */
const TOKEN_RE =
  /(?<![\p{L}\p{N}×])(?<!\d[.,])(?:(0?[1-9]|1[0-2])\s?\/\s?(?=\d))?(\d{2}(?:\d{2})?)(?!\d)(?![.,]\d)(?![\p{L}])(?!\s?(?:["”″]|''))(?!\s?(?:mm|cm|m|kg|g|ml|l|v|pol|pcs|pc|un|cv|hp|w|volts?|dentes|estrias)(?![\p{L}\p{N}]))/giu;
/** "../08", "…/2008": fim de faixa sem início escrito. */
const ATE_ANO_RE = /(?<![\p{L}\p{N}])(?:\.{2,3}|…)\s?\/\s?(\d{4}|\d{2})(?!\d)/gu;
const SEP_FECHADA_RE = /^(?:\s*(?:[–—\-/→>]|->)\s*|\s+a\s+|\s+at[eé]\s+)/iu;
const ABERTA_DEPOIS_RE = /^(?:\s*>|\+|\s+em\s+diante(?![\p{L}\p{N}]))/iu;
const ABERTA_ANTES_RE = /(?<![\p{L}\p{N}])a\s+partir\s+de\s+$/iu;

interface TokenAno {
  ano: number;
  /** 4 dígitos escritos (só estes contam como ano solto). */
  quatro: boolean;
  /** Mês escrito antes ("06/2008"; "10/14" pode ser mês/ano ou faixa de 2 dígitos). */
  mes: number | null;
  inicio: number;
  fim: number;
}

const ano2 = (n: number): number => (n <= CORTE_ANO_2_DIGITOS ? 2000 + n : 1900 + n);

/** Lê o número de 4 ou 2 dígitos como ano; `null` quando 2 dígitos estão desligados. */
function lerAno(digitos: string, dois: boolean): number | null {
  if (digitos.length === 4) return Number(digitos);
  return dois ? ano2(Number(digitos)) : null;
}

function acharAnos(texto: string, valido: (a: number) => boolean, dois: boolean): TokenAno[] {
  const saida: TokenAno[] = [];
  for (const m of texto.matchAll(TOKEN_RE)) {
    const ano = lerAno(m[2]!, dois);
    if (ano === null || !valido(ano)) continue;
    saida.push({ ano, quatro: m[2]!.length === 4, mes: m[1] ? Number(m[1]) : null, inicio: m.index!, fim: m.index! + m[0].length });
  }
  return saida;
}

export function expandirAplicacao(texto: string | null | undefined, opcoes: OpcoesAplicacao): AplicacaoExpandida {
  const t = texto ?? '';
  if (t === '') return { anos: [], faixas: [], textoIndice: '' };
  const maximo = opcoes.anoMaximo ?? anoMaximoValido(opcoes.anoAtual);
  const valido = (a: number) => a >= ANO_MINIMO_VALIDO && a <= maximo;
  const dois = opcoes.ano2Digitos ?? APLICACAO_ANO_2_DIGITOS_PADRAO;
  const literais = new Set<number>();
  const todos = new Set<number>();
  const faixas: FaixaAnos[] = [];
  const limiteAberta = opcoes.anoAtual + 1;
  const adicionar = (de: number, ate: number, inicio: number, fim: number) => {
    for (let a = de; a <= ate; a++) todos.add(a);
    faixas.push({ de, ate, inicio, fim });
  };

  // "../08": fim de faixa sem início; o trecho sai da leitura dos demais anos
  let resto = t;
  for (const m of t.matchAll(ATE_ANO_RE)) {
    const ate = lerAno(m[1]!, dois);
    if (ate === null || !valido(ate)) continue;
    adicionar(Math.max(ANO_MINIMO_VALIDO, ate - FAIXA_MAXIMA_ANOS), ate, m.index!, m.index! + m[0].length);
    if (m[1]!.length === 4) literais.add(ate);
    resto = resto.slice(0, m.index!) + ' '.repeat(m[0].length) + resto.slice(m.index! + m[0].length);
  }

  const tokens = acharAnos(resto, valido, dois);
  for (const k of tokens) if (k.quatro) literais.add(k.ano);
  for (const a of literais) todos.add(a);

  for (let i = 0; i < tokens.length; ) {
    // cadeia: A sep B sep C ... (cada elo ligado por separador de faixa)
    let j = i;
    while (j + 1 < tokens.length) {
      const entre = resto.slice(tokens[j]!.fim, tokens[j + 1]!.inicio);
      const m = SEP_FECHADA_RE.exec(entre);
      if (m && m[0].length === entre.length) j++;
      else break;
    }
    const elos = j - i + 1;
    if (elos === 2) {
      const a = tokens[i]!;
      const b = tokens[j]!;
      if (a.ano < b.ano && b.ano - a.ano <= FAIXA_MAXIMA_ANOS) adicionar(a.ano, b.ano, a.inicio, b.fim);
      i = j + 1;
      continue;
    }
    if (elos >= 3) {
      i = j + 1; // lista ("2010/2012/2014"), não faixa
      continue;
    }
    // elemento só
    const k = tokens[i]!;
    if (!k.quatro) {
      // "10/14": sem outro ano ao lado, o mês/ano de 2 dígitos é lido como faixa de 2 dígitos (premissa RN-CAT-16)
      if (k.mes !== null) {
        const de = ano2(k.mes);
        if (valido(de) && de < k.ano && k.ano - de <= FAIXA_MAXIMA_ANOS) adicionar(de, k.ano, k.inicio, k.fim);
      }
      i++;
      continue;
    }
    // ano de 4 dígitos isolado: pode ser faixa aberta
    const depois = ABERTA_DEPOIS_RE.exec(resto.slice(k.fim));
    const antes = ABERTA_ANTES_RE.exec(resto.slice(0, k.inicio));
    if ((depois || antes) && limiteAberta - k.ano >= 0 && limiteAberta - k.ano <= FAIXA_MAXIMA_ANOS) {
      adicionar(k.ano, limiteAberta, antes ? k.inicio - antes[0].length : k.inicio, depois ? k.fim + depois[0].length : k.fim);
    }
    i++;
  }

  const anos = [...todos].sort((x, y) => x - y);
  const gerados = anos.filter((a) => !literais.has(a));
  return { anos, faixas, textoIndice: gerados.length === 0 ? t : `${t} ${gerados.join(' ')}` };
}
