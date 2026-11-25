/**
 * Quantidade do item do pedido (RN-VEN-02 v3, ADR 0076 D1 a D4): fração só nas unidades KG e M, com até 4 casas decimais.
 * Puro, sem Zod (os schemas do fio ficam no `@macuxi/platform-sdk`, `QuantidadeDecimalSchema` e `FatorDecimalSchema`).
 *
 * Nenhuma conta é feita com o `number` decimal: o número vira inteiro de 1/10.000 (`quantidadeEmEscala`) pela forma
 * decimal mais curta que o JS dá a ele (`String(q)`), sem multiplicar em float; só volta a `number` para o fio e a tela.
 */

export const CASAS_QUANTIDADE = 4;
export const ESCALA_QUANTIDADE = 10_000;
export const UNIDADES_FRACIONARIAS = ['KG', 'M'] as const;
export type UnidadeFracionaria = (typeof UNIDADES_FRACIONARIAS)[number];

const ESCALA_BIG = BigInt(ESCALA_QUANTIDADE);
const MEIA_ESCALA_BIG = ESCALA_BIG / 2n;

/** RN-VEN-02 v3: a unidade aceita quantidade com casas decimais (KG ou M, sem diferença de caixa nem espaço nas pontas). */
export function unidadeFracionaria(sigla: string | null | undefined): boolean {
  if (typeof sigla !== 'string') return false;
  return (UNIDADES_FRACIONARIAS as readonly string[]).includes(sigla.trim().toUpperCase());
}

const DECIMAL_RE = /^(-)?(\d+)(?:\.(\d+))?(?:e([+-]?\d+))?$/i;

/** Texto decimal (`-12.5`, `1e-7`) → inteiro de 1/10.000. `null` = fora do formato, mais de 4 casas ou fora do inteiro seguro. */
function escalaDoTexto(texto: string): number | null {
  const m = DECIMAL_RE.exec(texto);
  if (!m) return null;
  const negativo = m[1] === '-';
  let inteiro = m[2]!;
  let fracao = m[3] ?? '';
  const expoente = m[4] === undefined ? 0 : Number(m[4]);
  // Desloca a vírgula pelo expoente (só aparece na forma que o `String` do JS dá a números muito grandes ou muito pequenos).
  if (expoente > 0) {
    const desloca = fracao.padEnd(expoente, '0');
    inteiro += desloca.slice(0, expoente);
    fracao = desloca.slice(expoente);
  } else if (expoente < 0) {
    const desloca = inteiro.padStart(-expoente + 1, '0');
    fracao = desloca.slice(desloca.length + expoente) + fracao;
    inteiro = desloca.slice(0, desloca.length + expoente);
  }
  fracao = fracao.replace(/0+$/, '');
  if (fracao.length > CASAS_QUANTIDADE) return null;
  const valor = BigInt(inteiro) * ESCALA_BIG + BigInt(fracao.padEnd(CASAS_QUANTIDADE, '0'));
  const r = Number(negativo ? -valor : valor);
  if (!Number.isSafeInteger(r)) return null;
  return r === 0 ? 0 : r;
}

/**
 * Quantidade (ou fator) → inteiro de 1/10.000 (`1.25` → `12500`). `RangeError` se não for finita, tiver mais de 4 casas
 * (`0.00005`) ou passar do inteiro seguro. Negativo é aceito (diferenças); o sinal positivo é regra do schema.
 */
export function quantidadeEmEscala(q: number): number {
  const r = typeof q === 'number' && Number.isFinite(q) ? escalaDoTexto(String(q)) : null;
  if (r === null)
    throw new RangeError(
      `quantidade inválida ou com mais de ${CASAS_QUANTIDADE} casas decimais: ${String(q)}`,
    );
  return r;
}

/**
 * A quantidade (ou fator) é finita, tem até 4 casas e cabe no inteiro seguro (RN-VEN-02 v3)? Sem exceção: o `false` cobre o
 * que `quantidadeEmEscala` recusaria. Negativo é aceito; o sinal positivo é regra de quem chama.
 */
export function quantidadeValida(q: number): boolean {
  return typeof q === 'number' && Number.isFinite(q) && escalaDoTexto(String(q)) !== null;
}

/** `a + b` exato, em 1/10.000 (`0.1 + 0.2` → `0.3`). `RangeError` como em `quantidadeEmEscala`. */
export function somarQuantidades(a: number, b: number): number {
  return quantidadeDaEscala(quantidadeEmEscala(a) + quantidadeEmEscala(b));
}

/** `a − b` exato, em 1/10.000 (`0.3 − 0.1` → `0.2`). `RangeError` como em `quantidadeEmEscala`. */
export function subtrairQuantidades(a: number, b: number): number {
  return quantidadeDaEscala(quantidadeEmEscala(a) - quantidadeEmEscala(b));
}

/** Inteiro de 1/10.000 → quantidade (`12500` → `1.25`), só para o fio e a tela. `RangeError` se não for inteiro seguro. */
export function quantidadeDaEscala(u: number): number {
  if (!Number.isSafeInteger(u)) throw new RangeError(`quantidade em escala não inteira: ${String(u)}`);
  const r = u / ESCALA_QUANTIDADE;
  return r === 0 ? 0 : r;
}

/** A quantidade tem casas decimais (RN-VEN-02 v3)? `RangeError` como em `quantidadeEmEscala`. */
export function temFracao(q: number): boolean {
  return quantidadeEmEscala(q) % ESCALA_QUANTIDADE !== 0;
}

/**
 * Corta `n` em `casas` casas decimais, sem arredondar (`1.23456` → `1.2345`; `casas` 0 = `Math.trunc`). O corte é feito no
 * texto decimal mais curto do JS (`String(n)`; a notação exponencial vira forma fixa deslocando a vírgula no texto), sem
 * multiplicar em float: `0.29` continua `0.29`. `RangeError` se `n` não for finito ou `casas` não for inteiro de 0 a 100.
 */
export function truncarCasas(n: number, casas: number = CASAS_QUANTIDADE): number {
  if (!Number.isInteger(casas) || casas < 0 || casas > 100) {
    throw new RangeError(`casas deve ser inteiro de 0 a 100: ${String(casas)}`);
  }
  if (typeof n !== 'number' || !Number.isFinite(n)) throw new RangeError(`número inválido: ${String(n)}`);
  if (casas === 0) {
    const r = Math.trunc(n);
    return r === 0 ? 0 : r;
  }
  let texto = String(n);
  const exp = /^(-?)(\d)(?:\.(\d+))?e([+-]\d+)$/i.exec(texto);
  if (exp) {
    const expoente = Number(exp[4]);
    if (expoente >= 0) return n; // ≥ 1e21: já é inteiro
    // |n| < 1e-6: desloca a vírgula no texto (`9.99e-7` → `0.000000999`).
    texto = `${exp[1]}0.${'0'.repeat(-expoente - 1)}${exp[2]}${exp[3] ?? ''}`;
  }
  const ponto = texto.indexOf('.');
  const r = Number(ponto < 0 ? texto : texto.slice(0, ponto + 1 + casas));
  return r === 0 ? 0 : r;
}

const NUMERIC_RE = /^-?\d+(?:\.\d+)?$/;

/**
 * Coluna `numeric` lida do banco (o `node-pg` devolve texto, ex.: `"1.2500"`) → `number` (ADR 0076 D2). Aceita também o
 * `number`. `RangeError` se o texto não for um decimal simples (`1,25`, `1e3`, `.5`, vazio) ou tiver mais de 4 casas.
 */
export function quantidadeDoBanco(v: string | number): number {
  if (typeof v === 'number') return quantidadeDaEscala(quantidadeEmEscala(v));
  const texto = typeof v === 'string' ? v.trim() : '';
  const r = NUMERIC_RE.test(texto) ? escalaDoTexto(texto) : null;
  if (r === null)
    throw new RangeError(
      `quantidade do banco inválida ou com mais de ${CASAS_QUANTIDADE} casas decimais: ${JSON.stringify(v)}`,
    );
  return quantidadeDaEscala(r);
}

/**
 * `quantidade × fator`, exato (RN-VEN-02 v3, RN-VEN-15). `RangeError` se os dois tiverem fração (nunca juntos no mesmo item,
 * para a base caber em 4 casas) ou se algum tiver mais de 4 casas.
 */
export function quantidadeBase(quantidade: number, fator: number): number {
  const q = quantidadeEmEscala(quantidade);
  const f = quantidadeEmEscala(fator);
  if (q % ESCALA_QUANTIDADE !== 0 && f % ESCALA_QUANTIDADE !== 0) {
    throw new RangeError('RN-VEN-02: quantidade e fator não podem ser fracionários no mesmo item.');
  }
  const r = Number((BigInt(q) * BigInt(f)) / ESCALA_BIG); // exata: um dos dois é múltiplo da escala
  if (!Number.isSafeInteger(r)) throw new RangeError('quantidade base fora do inteiro seguro');
  return quantidadeDaEscala(r);
}

/**
 * RN-VEN-02 v3: total da linha em centavos = preço unitário (centavos) × quantidade, arredondado ao centavo, meio para cima
 * (como o vProd da NF-e). Conta em `BigInt`; com valor negativo o meio afasta de zero (simétrico). Com quantidade inteira o
 * resultado é igual a `preço × quantidade`. Ex.: 1999 × 1,250 = 2498,75 → 2499.
 */
export function totalDaLinhaCents(precoUnitarioCents: number, quantidade: number): number {
  if (!Number.isSafeInteger(precoUnitarioCents)) {
    throw new RangeError(`preço unitário deve ser inteiro em centavos: ${String(precoUnitarioCents)}`);
  }
  const produto = BigInt(precoUnitarioCents) * BigInt(quantidadeEmEscala(quantidade));
  const absoluto = produto < 0n ? -produto : produto;
  const arredondado = (absoluto + MEIA_ESCALA_BIG) / ESCALA_BIG;
  const r = Number(produto < 0n ? -arredondado : arredondado);
  if (!Number.isSafeInteger(r)) throw new RangeError('total da linha fora do inteiro seguro');
  return r === 0 ? 0 : r;
}

const milhares = (inteiro: string): string => inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.');

/**
 * Quantidade para a tela e o PDF (RN-VEN-02 v3). KG e M: vírgula, de 3 a 4 casas, sigla minúscula (`1,250 kg`,
 * `0,1255 kg`). Demais: inteiro com ponto de milhar e a sigla como veio (`1.200 CX`); se ainda assim houver fração, ela
 * aparece com as casas que tiver. `unidade` nula ou vazia = só o número. `semSigla`: as mesmas casas da unidade, sem a
 * sigla (`1,250`), para tabela com a sigla na coluna ao lado. `RangeError` com mais de 4 casas.
 */
export function formatarQuantidade(
  q: number,
  unidade: string | null,
  opcoes: { semSigla?: boolean } = {},
): string {
  const u = quantidadeEmEscala(q);
  const absoluto = Math.abs(u);
  const inteiro = milhares(String(Math.trunc(absoluto / ESCALA_QUANTIDADE)));
  const casas = String(absoluto % ESCALA_QUANTIDADE).padStart(CASAS_QUANTIDADE, '0');
  const fracionaria = unidadeFracionaria(unidade);
  const fracao = fracionaria ? casas.replace(/0$/, '') : casas.replace(/0+$/, '');
  const numero = `${u < 0 ? '-' : ''}${inteiro}${fracao ? `,${fracao}` : ''}`;
  const sigla = (unidade ?? '').trim();
  if (!sigla || opcoes.semSigla) return numero;
  return `${numero} ${fracionaria ? sigla.toLowerCase() : sigla}`;
}
