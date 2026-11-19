/**
 * RD-2355 (T-0186): parte PURA das tabelas da ficha (`TabelaRotuloValor` e `TabelaDados`, em `tabela-ficha-rn.tsx`). Unifica a
 * tabela da ficha do Cliente 360 (modulo-core) e as do detalhe do pedido e do Resumo (modulo-vendedor, pedido-v4.md §1, §2, §5.4).
 * Medidas, largura e alinhamento de cada coluna e a leitura do TalkBack. Sem react-native: roda em Node.
 */
import { ALVO_TOQUE, folgaDeToque, leituraDaLinhaDeValor } from './componentes';
import { radius } from './tokens';

/** Medidas (dp e tamanhos de fonte) das duas tabelas. */
export const TABELA_FICHA = {
  /** Raio do cartão da tabela (o mesmo das fontes: 12). */
  raio: radius.md,
  /** Linha da tabela e par rótulo-valor: no mínimo o alvo de toque. */
  alturaLinha: ALVO_TOQUE,
  /** Entre colunas e nas bordas laterais da `TabelaDados`. */
  gapColunas: 4,
  paddingLateral: 8,
  /** `TabelaRotuloValor`: borda lateral 12, 8 entre rótulo e valor, rótulo de 136 dp (a ficha; o pedido usa 92). */
  paddingLateralRotuloValor: 12,
  gapRotuloValor: 8,
  larguraRotulo: 136,
  fonte: { cabecalho: 12, rotulo: 14, valor: 16, celula: 14, celulaPequena: 12, segunda: 12 },
  /** Botão de ícone da célula: alvo de 48 dp, ícone 20. */
  botao: { lado: ALVO_TOQUE, icone: 20 },
  /** Fio vermelho à esquerda da linha em perigo (NF em atraso). */
  fioPerigo: 3,
} as const;

export type AlinharColuna = 'esq' | 'dir' | 'centro';

export interface ColunaTabela {
  id: string;
  /** Cabeçalho 12/600 em `ink2`; vazio ("") para coluna de botão. */
  titulo: string;
  /** dp fixos (código, status, botão). */
  largura?: number;
  /** Sem `largura`: parte do que sobra, por peso (flexBasis 0). Sem peso, divide por igual (peso 1). */
  peso?: number;
  /** Padrão: `dir` na numérica, `esq` nas demais. */
  alinhar?: AlinharColuna;
  /** Valores, quantidades e datas: à direita e com algarismos tabulares. */
  numerica?: boolean;
}

/** Estilo de largura da coluna, igual no cabeçalho e na célula. */
export function estiloDaColuna(c: Pick<ColunaTabela, 'largura' | 'peso'>):
  | { width: number }
  | { flexGrow: number; flexShrink: 1; flexBasis: 0; minWidth: 0 } {
  if (c.largura !== undefined && Number.isFinite(c.largura) && c.largura > 0) return { width: c.largura };
  const peso = c.peso !== undefined && Number.isFinite(c.peso) && c.peso > 0 ? c.peso : 1;
  return { flexGrow: peso, flexShrink: 1, flexBasis: 0, minWidth: 0 };
}

/** Alinhamento efetivo: o explícito ou, por padrão, `dir` na numérica. */
export function alinharDaColuna(c: Pick<ColunaTabela, 'alinhar' | 'numerica'>): AlinharColuna {
  return c.alinhar ?? (c.numerica ? 'dir' : 'esq');
}

const ITENS = { esq: 'flex-start', dir: 'flex-end', centro: 'center' } as const;
const TEXTO = { esq: 'left', dir: 'right', centro: 'center' } as const;

/** `alignItems` da célula (View) e `textAlign` do cabeçalho (Text) para o alinhamento. */
export function alinhamentoDaColuna(a: AlinharColuna): { alignItems: (typeof ITENS)[AlinharColuna]; textAlign: (typeof TEXTO)[AlinharColuna] } {
  return { alignItems: ITENS[a], textAlign: TEXTO[a] };
}

/** Algarismos tabulares só onde há número (coluna numérica ou célula à direita). */
export function fonteNumerica(numerica: boolean | undefined): { fontVariant: ['tabular-nums'] } | null {
  return numerica ? { fontVariant: ['tabular-nums'] } : null;
}

/** Largura do rótulo da `TabelaRotuloValor`: a pedida (> 0) ou 136. */
export function larguraDoRotulo(largura?: number): number {
  return largura !== undefined && Number.isFinite(largura) && largura > 0 ? largura : TABELA_FICHA.larguraRotulo;
}

/** TalkBack do par: "Prazo: 30 dias", "Entrega: sem dado", com o complemento em texto: "Cliente: Mercado X. CNPJ 12…". */
export function leituraDoRotuloValor(rotulo: string, valor: string | null | undefined, complemento?: string | null): string {
  const base = leituraDaLinhaDeValor(rotulo, valor);
  const extra = complemento?.trim();
  return extra ? `${base}. ${extra}` : base;
}

/** Folga de toque do `BotaoCelula` (o visual já tem 48 dp: 0). */
export function folgaDoBotaoCelula(): number {
  return folgaDeToque(TABELA_FICHA.botao.lado);
}
