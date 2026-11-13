/**
 * Barra de progresso do BKO (T-0104). Uso: `<Progresso rotulo="Metas batidas" valor={7} maximo={10} textoValor="7 de 10" />`.
 * Acessibilidade: o contêiner é o `progressbar` (nome em `aria-label`, `aria-valuenow` já limitado à faixa e
 * `aria-valuetext` legível); o que está dentro é só apresentação. O percentual sempre aparece em texto, nunca só na cor.
 * Sem `'use client'` e sem importar o `ui.tsx` (que é de cliente): serve também em componente de servidor do Next.
 */

const juntar = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

/** Percentual inteiro de 0 a 100. Valor ou máximo inválido (NaN, máximo ≤ 0) dá 0; fora da faixa, limita. */
export function percentualDoProgresso(valor: number, maximo = 100): number {
  if (Number.isNaN(valor) || Number.isNaN(maximo) || maximo <= 0) return 0;
  const p = (valor / maximo) * 100;
  if (Number.isNaN(p)) return 0;
  return Math.round(Math.min(100, Math.max(0, p)));
}

/** Valor para `aria-valuenow`: limitado a [0, máximo]; NaN dá 0. */
export function valorDoProgresso(valor: number, maximo = 100): number {
  if (Number.isNaN(valor) || Number.isNaN(maximo) || maximo <= 0) return 0;
  return Math.min(maximo, Math.max(0, valor));
}

export type TomProgresso = 'destaque' | 'sucesso';

const PREENCHIMENTO: Record<TomProgresso, string> = {
  // T-0172: barra é gráfico, laranja da marca (bg-grafico)
  destaque: 'bg-grafico',
  sucesso: 'bg-success',
};

export type PropsProgresso = {
  valor: number;
  maximo?: number;
  /** Nome da barra (aria-label) e texto à esquerda, ex.: "Positivação da carteira". */
  rotulo: string;
  /** Texto do valor (à direita e no `aria-valuetext`); padrão "40%". */
  textoValor?: string;
  /** `false` esconde a linha de rótulo e valor (a barra continua com nome e valor para o leitor de tela). */
  mostrarRotulo?: boolean;
  tom?: TomProgresso;
  testid?: string;
  className?: string;
};

export function Progresso({ valor, maximo = 100, rotulo, textoValor, mostrarRotulo = true, tom = 'destaque', testid, className }: PropsProgresso) {
  const pct = percentualDoProgresso(valor, maximo);
  const texto = textoValor ?? `${pct}%`;
  return (
    <div
      role="progressbar"
      aria-label={rotulo}
      aria-valuemin={0}
      aria-valuemax={maximo}
      aria-valuenow={valorDoProgresso(valor, maximo)}
      aria-valuetext={texto}
      data-testid={testid}
      className={juntar('flex min-w-0 flex-col gap-1.5', className)}
    >
      {mostrarRotulo && (
        <div className="flex items-baseline justify-between gap-3">
          <span className="min-w-0 truncate text-[13px] text-ink-2">{rotulo}</span>
          <span className="shrink-0 text-[13px] font-semibold text-ink tabular-nums">{texto}</span>
        </div>
      )}
      <div className="h-2 w-full overflow-hidden rounded-full bg-line-2">
        <div
          className={juntar('h-full rounded-full transition-[width] duration-[240ms] ease-out motion-reduce:transition-none', PREENCHIMENTO[tom])}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
