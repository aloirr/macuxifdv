/**
 * Parâmetros só leitura do BKO (ADR 0058, menu Parâmetros v1.0.14): a lista "rótulo · valor", com "Padrão: X" embaixo do
 * valor só quando o tenant mudou o padrão. Um componente para Pesquisa, Trade (Promotor) e Treinamento (RD-1583, RD-1584):
 * os módulos montam só as linhas.
 * Uso: `<ListaParametros testId="parametros-pesquisa-fotos" linhas={[{ rotulo: 'Maior lado', ...valorComPadrao(1600, 1280, px) }]} />`.
 * Sem `'use client'` e sem importar o `ui.tsx`: serve também em componente de servidor do Next.
 */
import type { ReactNode } from 'react';
import { formatInt } from './format';

/** Valor em uso e, só quando ele difere do padrão, o texto "Padrão: X". */
export type ValorComPadrao = { valor: string; padrao: string | null };

/**
 * Valor em uso formatado e, só quando difere do padrão, "Padrão: <padrão formatado>" (RD-1584). A comparação é por valor
 * (listas e objetos inclusive): `[1, 2]` igual a `[1, 2]` não mostra o padrão.
 */
export function valorComPadrao<T>(emUso: T, padrao: T, formatar: (v: T) => string = (v) => String(v)): ValorComPadrao {
  const igual = Object.is(emUso, padrao) || JSON.stringify(emUso) === JSON.stringify(padrao);
  return { valor: formatar(emUso), padrao: igual ? null : `Padrão: ${formatar(padrao)}` };
}

/** Formatadores das unidades dos parâmetros (pt-BR, inteiro): "7 min", "50%", "30 dias" (1 dia no singular), "1.600 px". */
export const formatarParametro = {
  min: (n: number) => `${formatInt(n)} min`,
  pct: (n: number) => `${formatInt(n)}%`,
  dias: (n: number) => `${formatInt(n)} ${Math.round(n) === 1 ? 'dia' : 'dias'}`,
  /** Unidade livre: `formatarParametro.unidade('px')(1600)` → "1.600 px". */
  unidade: (u: string) => (n: number) => `${formatInt(n)} ${u}`,
} as const;

export type LinhaListaParametros = {
  rotulo: string;
  valor: ReactNode;
  /** "Padrão: X"; nulo ou ausente quando o valor é o padrão. */
  padrao?: string | null;
  /** `data-testid` do valor (`<dd>`), quando o teste da tela precisa achar um parâmetro. */
  testId?: string;
};

/** Rótulo à esquerda (15/600), valor à direita em números tabulares e, embaixo, "Padrão: X" em 13 na cor de apoio (MC-1515). */
export function ListaParametros({ linhas, testId }: { linhas: readonly LinhaListaParametros[]; testId?: string }) {
  return (
    <dl data-testid={testId} className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-[15px]">
      {linhas.map((l) => (
        <div key={l.rotulo} className="contents">
          <dt className="font-semibold text-ink">{l.rotulo}</dt>
          <dd className="m-0 text-right tabular-nums" data-testid={l.testId}>
            {l.valor}
            {l.padrao ? <span className="block text-[13px] text-ink-2">{l.padrao}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}
