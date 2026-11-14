/**
 * T-0165 (R-20261112-031456, regras 2 e 3): o "Desc./Acrésc. geral" da aba Itens. Não existe mais desconto sobre o total do pedido
 * (RN-VEN-02 v3): o ajuste fica sempre no item, e o geral só copia um % para todos os itens. Funções puras sobre o ajuste de cada
 * linha do rascunho (a forma `Ajuste` do app, sem importar o app).
 *  - "Aplicar" sobrescreve o ajuste de cada item (em % ou em R$); pergunta antes se algum item tem ajuste diferente;
 *  - item adicionado depois entra com o último geral aplicado;
 *  - acima da alçada vira alerta (`alertasDoPedido`, RN-VEN-10), nunca bloqueia o geral.
 */
import { formatPct } from '@macuxi/comum';

export interface AjusteGeral {
  sentido: 'desconto' | 'acrescimo';
  /** percentual com 2 casas; 0 tira o ajuste de todos os itens */
  pct: number;
}

/** Forma mínima do ajuste de uma linha do rascunho (o `Ajuste` do app é compatível). */
export interface AjusteDaLinha {
  em?: 'pct' | 'valor';
  desconto_pct?: number;
  acrescimo_pct?: number;
  desconto_cents?: number;
  acrescimo_cents?: number;
}

/** O ajuste da linha é exatamente o geral (em %, mesmo sentido, mesmo valor); sem ajuste só é igual a um geral de 0%. */
export function ajusteIgualAoGeral(a: AjusteDaLinha | undefined, g: AjusteGeral): boolean {
  const desc = a?.em === 'valor' ? 0 : (a?.desconto_pct ?? 0);
  const acr = a?.em === 'valor' ? 0 : (a?.acrescimo_pct ?? 0);
  const dCents = a?.em === 'valor' ? (a?.desconto_cents ?? 0) : 0;
  const aCents = a?.em === 'valor' ? (a?.acrescimo_cents ?? 0) : 0;
  if (dCents > 0 || aCents > 0) return false;
  if (g.pct === 0) return desc === 0 && acr === 0;
  return g.sentido === 'desconto' ? desc === g.pct && acr === 0 : acr === g.pct && desc === 0;
}

/** Chaves das linhas cujo ajuste é diferente do geral. */
export function linhasDiferentesDoGeral(chaves: readonly string[], ajustes: Readonly<Record<string, AjusteDaLinha>>, g: AjusteGeral): string[] {
  return chaves.filter((k) => !ajusteIgualAoGeral(ajustes[k], g));
}

/** RD-0148: só pergunta quando algum item tem OUTRO ajuste (item sem desconto nem acréscimo não perde nada). */
export function linhasComOutroAjuste(chaves: readonly string[], ajustes: Readonly<Record<string, AjusteDaLinha>>, g: AjusteGeral): string[] {
  return chaves.filter((k) => !ajusteIgualAoGeral(ajustes[k], g) && !ajusteIgualAoGeral(ajustes[k], { sentido: 'desconto', pct: 0 }));
}

/** O ajuste do geral na forma do rascunho (sempre em %). */
export function ajusteDoGeral(g: AjusteGeral): AjusteDaLinha {
  return g.sentido === 'desconto' ? { em: 'pct', desconto_pct: g.pct } : { em: 'pct', acrescimo_pct: g.pct };
}

/** "Aplicar": o geral sobrescreve o ajuste de cada linha, guardando o resto do que a linha tem (caixa de aplicação etc.). */
export function aplicarGeralNasLinhas<A extends AjusteDaLinha>(chaves: readonly string[], ajustes: Readonly<Record<string, A>>, g: AjusteGeral): Record<string, A> {
  const novo: Record<string, A> = { ...ajustes };
  for (const k of chaves) {
    const { em: _em, desconto_pct: _d, acrescimo_pct: _a, desconto_cents: _dc, acrescimo_cents: _ac, ...resto } = (ajustes[k] ?? {}) as A;
    novo[k] = { ...(resto as unknown as A), ...(ajusteDoGeral(g) as A) };
  }
  return novo;
}

/** Item novo (sem ajuste ainda) entra com o último geral aplicado; linhas que já têm entrada de ajuste ficam como estão. */
export function completarComGeral<A extends AjusteDaLinha>(chaves: readonly string[], ajustes: Readonly<Record<string, A>>, g: AjusteGeral | null): Record<string, A> {
  if (!g || g.pct <= 0) return { ...ajustes };
  const novo: Record<string, A> = { ...ajustes };
  for (const k of chaves) if (novo[k] === undefined) novo[k] = ajusteDoGeral(g) as A;
  return novo;
}

/** RD-0148: a pergunta do "Aplicar" quando algum item tem ajuste diferente; `null` aplica direto, sem perguntar. */
export function perguntaDoGeral(g: AjusteGeral, diferentes: number): { titulo: string; confirmar: string; voltar: string } | null {
  if (diferentes === 0) return null;
  const valor = formatPct(g.pct);
  return { titulo: g.pct === 0 ? 'Tirar o desconto e o acréscimo de todos os itens?' : `Trocar o ${g.sentido === 'desconto' ? 'desconto' : 'acréscimo'} de todos os itens por ${valor}?`, confirmar: 'Trocar', voltar: 'Voltar' };
}

/** "Aplicar" desligado com o campo vazio ou quando todos os itens já têm esse ajuste (sem itens, guarda o % para os próximos). */
export function podeAplicarGeral(texto: string, diferentes: number, semItens: boolean): boolean {
  if (texto.trim() === '') return false;
  return semItens || diferentes > 0;
}

/**
 * RN-VEN-02 (dono do produto, 14/11): o "−" e o "+" do Desc./Acrésc. geral. Passo de 1 ponto percentual em % e de R$ 1,00 (100 centavos)
 * em R$; nunca abaixo de 0 e, em %, nunca acima de 100. A alçada não trava o "+": acima dela vira alerta (RN-VEN-10), como no campo digitado.
 */
export function passoDoGeral(valor: number, direcao: -1 | 1, em: 'pct' | 'valor'): number {
  const passo = em === 'pct' ? 1 : 100;
  const atual = Number.isFinite(valor) && valor > 0 ? valor : 0;
  const novo = Math.max(0, Math.round((atual + direcao * passo) * 100) / 100);
  return em === 'pct' ? Math.min(100, novo) : novo;
}
