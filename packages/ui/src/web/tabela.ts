import { Children, isValidElement, type CSSProperties, type ReactElement, type ReactNode } from 'react';

export type PropsDaTabela = { style?: CSSProperties; className?: string };

/**
 * O `TableScroll` aceita dois jeitos: o miolo (`<thead>`/`<tbody>`), que ele embrulha no próprio `<table>`, ou um
 * `<table>` pronto (com `data-testid` e classes da tela), que ele só põe na caixa de rolagem. Aqui fica a decisão:
 * devolve o `<table>` quando ele é o único filho, para não aninhar tabela em tabela (HTML inválido; quebra a hidratação).
 * Atenção: o `<table>` pronto precisa trazer as próprias classes (`w-full border-collapse text-[13px]`, ou o tamanho de
 * fonte da tela): as classes do `<table>` do kit não entram nele. Sem elas, a tabela fica sem largura total, sem colapso
 * de borda e na fonte do corpo. Não mesclamos classes de propósito (`text-[13px]` + `text-[15px]` dependeria da ordem do CSS).
 */
export function tabelaPronta(children: ReactNode): ReactElement<PropsDaTabela> | null {
  const itens = Children.toArray(children);
  if (itens.length !== 1) return null;
  const [unico] = itens;
  return isValidElement<PropsDaTabela>(unico) && unico.type === 'table' ? unico : null;
}

/** Estilo do `<table>` pronto: a largura mínima do `TableScroll` vence a da tela, o resto do estilo da tela fica. */
export function estiloDaTabela(minWidth: number, style?: CSSProperties): CSSProperties {
  return { ...style, minWidth };
}
