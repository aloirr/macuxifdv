import { Fragment } from 'react';
import { codigosDoCliente, type CodigosDoClienteEntrada } from '../../app/lib/codigos-cliente';

/**
 * Códigos do cliente no BKO (v1.0.30; ADR 0069 item 10; docs/design/telas/codigos-do-cliente.md §2): sigla 12/500 cinza e valor
 * mono 13 px com algarismos tabulares, ERP primeiro. Código vazio não aparece; sem nenhum, nada. A regra é a do app
 * (`codigosDoCliente`). `empilhado`: um código por linha (células da tabela); `linha`: "ERP C5007 · FDV 00012", seguido de
 * `depois` (o resto da linha de identificação), com o separador só quando os dois existem.
 */
export function CodigosDoCliente({ cliente, forma, depois = '', testId }: { cliente: CodigosDoClienteEntrada; forma: 'empilhado' | 'linha'; depois?: string; testId?: string }) {
  const codigos = codigosDoCliente(cliente);
  if (codigos.length === 0) return depois || null;
  // leitor de tela: "Código ERP C5007" (o "Código " fica só para ele)
  const item = (c: (typeof codigos)[number]) => (
    <span data-testid={testId ? `${testId}.${c.sigla.toLowerCase()}` : undefined} className="whitespace-nowrap">
      <span className="sr-only">Código </span>
      <span className="text-[12px] font-medium text-ink-2">{c.sigla}</span>{' '}
      <span className="font-mono text-[13px] text-ink tabular-nums">{c.valor}</span>
    </span>
  );
  if (forma === 'empilhado')
    return (
      <span className="flex flex-col leading-4" data-testid={testId}>
        {codigos.map((c) => (
          <Fragment key={c.sigla}>{item(c)}</Fragment>
        ))}
      </span>
    );
  return (
    <>
      <span data-testid={testId}>
        {codigos.map((c, i) => (
          <Fragment key={c.sigla}>
            {i > 0 ? ' · ' : null}
            {item(c)}
          </Fragment>
        ))}
      </span>
      {depois ? ` · ${depois}` : null}
    </>
  );
}
