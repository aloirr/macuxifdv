/**
 * Aplicação do produto (descrição 2) na busca (RN-CAT-12; T-0084 §3): expande faixas de anos ("2010–2014") em anos
 * soltos para o índice e a consulta acharem "2012". Função pura: a mesma no aparelho (FTS5 e ranking) e na API.
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
/** Ano de 2 dígitos ("10/14") fica fora da v1, atrás do parâmetro `aplicacao_ano_2_digitos` (desligado). */
export const APLICACAO_ANO_2_DIGITOS_PADRAO = false;

const ANO_RE = /(?<![\p{L}\p{N}])(?<![\d][.,])(?:19|20)\d{2}(?!\d)(?![.,]\d)(?![\p{L}])/gu;
const SEP_FECHADA_RE = /^(?:\s*[–—\-/]\s*|\s+a\s+)/iu;
const ABERTA_DEPOIS_RE = /^(?:\s*>|\s+em\s+diante(?![\p{L}\p{N}]))/iu;
const ABERTA_ANTES_RE = /(?<![\p{L}\p{N}])a\s+partir\s+de\s+$/iu;

interface TokenAno {
  ano: number;
  inicio: number;
  fim: number;
}

function acharAnos(texto: string): TokenAno[] {
  const saida: TokenAno[] = [];
  for (const m of texto.matchAll(ANO_RE)) saida.push({ ano: Number(m[0]), inicio: m.index!, fim: m.index! + m[0].length });
  return saida;
}

export function expandirAplicacao(texto: string | null | undefined, opcoes: { anoAtual: number }): AplicacaoExpandida {
  const t = texto ?? '';
  if (t === '') return { anos: [], faixas: [], textoIndice: '' };
  const tokens = acharAnos(t);
  const literais = new Set(tokens.map((k) => k.ano));
  const todos = new Set(literais);
  const faixas: FaixaAnos[] = [];
  const limiteAberta = opcoes.anoAtual + 1;
  const adicionar = (de: number, ate: number, inicio: number, fim: number) => {
    for (let a = de; a <= ate; a++) todos.add(a);
    faixas.push({ de, ate, inicio, fim });
  };

  for (let i = 0; i < tokens.length; ) {
    // cadeia: A sep B sep C ... (cada elo ligado por separador de faixa)
    let j = i;
    while (j + 1 < tokens.length) {
      const entre = t.slice(tokens[j]!.fim, tokens[j + 1]!.inicio);
      const m = SEP_FECHADA_RE.exec(entre);
      if (m && m[0].length === entre.length) j++;
      else break;
    }
    const elos = j - i + 1;
    if (elos === 2) {
      const a = tokens[i]!;
      const b = tokens[j]!;
      if (a.ano === b.ano) {
        // ano único: nada a gerar
      } else if (a.ano < b.ano && b.ano - a.ano <= FAIXA_MAXIMA_ANOS) {
        adicionar(a.ano, b.ano, a.inicio, b.fim);
      }
      i = j + 1;
      continue;
    }
    if (elos >= 3) {
      i = j + 1; // lista ("2010/2012/2014"), não faixa
      continue;
    }
    // ano isolado: pode ser faixa aberta
    const k = tokens[i]!;
    const depois = ABERTA_DEPOIS_RE.exec(t.slice(k.fim));
    const antes = ABERTA_ANTES_RE.exec(t.slice(0, k.inicio));
    if ((depois || antes) && limiteAberta - k.ano >= 0 && limiteAberta - k.ano <= FAIXA_MAXIMA_ANOS) {
      adicionar(k.ano, limiteAberta, antes ? k.inicio - antes[0].length : k.inicio, depois ? k.fim + depois[0].length : k.fim);
    }
    i++;
  }

  const anos = [...todos].sort((x, y) => x - y);
  const gerados = anos.filter((a) => !literais.has(a));
  return { anos, faixas, textoIndice: gerados.length === 0 ? t : `${t} ${gerados.join(' ')}` };
}
