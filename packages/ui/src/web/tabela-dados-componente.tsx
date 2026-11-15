'use client';

/**
 * Tabela de dados do BKO (revisão do BKO, docs/design/telas/bko-revisao.md §P2). Substitui `TableScroll` + `<table>` à mão
 * nas listas: sem rolagem lateral (largura do quadro, texto longo com reticências e o texto inteiro no `title`), colunas por
 * prioridade (as de prioridade 2 e 3 somem no quadro estreito), um selo por linha na Situação e as ações num menu "⋯".
 * Clique na linha (ou Enter no nome) abre o item, quando a tela passa `aoAbrir`. Lista vazia mostra `vazio`.
 */
import type { ReactNode } from 'react';
import { MenuAcoes, type AcaoDoMenu } from './menu-acoes';
import { classeDaPrioridade, LARGURA_COLUNA_ACOES, type PrioridadeDaColuna } from './tabela-dados';
import { cx, th, thNum, td, tdNum } from './ui';

export interface ColunaDaTabela<T> {
  id: string;
  titulo: string;
  celula: (linha: T) => ReactNode;
  /** Texto inteiro da célula (vai no `title` quando a reticência corta). */
  texto?: (linha: T) => string;
  /** 1 = sempre (padrão); 2 = quadro ≥ 672 px; 3 = quadro ≥ 1024 px. */
  prioridade?: PrioridadeDaColuna;
  /** Número, dinheiro, data: à direita e em algarismos de mesma largura. */
  numero?: boolean;
  /** Largura da coluna (`'28%'`, `'120px'`). Sem largura, divide o que sobra. */
  largura?: string;
}

export interface PropsTabelaDados<T> {
  colunas: ReadonlyArray<ColunaDaTabela<T>>;
  linhas: readonly T[];
  chave: (linha: T) => string;
  /** Nome da tabela para leitor de tela (legenda escondida), ex.: "Usuários". */
  rotulo: string;
  acoes?: (linha: T) => readonly AcaoDoMenu[];
  aoAbrir?: (linha: T) => void;
  /** O que mostrar quando não há linha (use `EstadoVazio`). */
  vazio?: ReactNode;
  testId?: string;
  linhaTestId?: (linha: T) => string;
  /** Linha apagada (inativo, cancelado): texto em cinza. */
  esmaecida?: (linha: T) => boolean;
}

export function TabelaDados<T>({ colunas, linhas, chave, rotulo, acoes, aoAbrir, vazio, testId, linhaTestId, esmaecida }: PropsTabelaDados<T>) {
  if (linhas.length === 0 && vazio) return <>{vazio}</>;
  const temAcoes = !!acoes;
  return (
    <div className="@container/tabela w-full min-w-0">
      <table className="w-full table-fixed border-collapse text-[13px]" data-testid={testId}>
        <caption className="sr-only">{rotulo}</caption>
        <thead>
          <tr>
            {colunas.map((c) => (
              <th key={c.id} scope="col" className={cx(c.numero ? thNum : th, 'truncate', classeDaPrioridade(c.prioridade))} style={c.largura ? { width: c.largura } : undefined}>
                {c.titulo}
              </th>
            ))}
            {temAcoes && (
              <th scope="col" className={th} style={{ width: LARGURA_COLUNA_ACOES }}>
                <span className="sr-only">Ações</span>
              </th>
            )}
          </tr>
        </thead>
        <tbody>
          {linhas.map((l) => {
            const k = chave(l);
            return (
              <tr
                key={k}
                data-testid={linhaTestId?.(l)}
                onClick={aoAbrir ? () => aoAbrir(l) : undefined}
                className={cx('transition-colors hover:bg-ground', aoAbrir && 'cursor-pointer', esmaecida?.(l) && 'text-ink-2')}
              >
                {colunas.map((c, i) => (
                  <td key={c.id} className={cx(c.numero ? tdNum : td, 'truncate', classeDaPrioridade(c.prioridade))} title={c.texto?.(l)}>
                    {i === 0 && aoAbrir ? (
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          aoAbrir(l);
                        }}
                        className="block max-w-full truncate text-left font-semibold text-ink hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
                      >
                        {c.celula(l)}
                      </button>
                    ) : (
                      c.celula(l)
                    )}
                  </td>
                ))}
                {temAcoes && (
                  <td className={cx(td, 'py-1 text-right')} onClick={(e) => e.stopPropagation()}>
                    <MenuAcoes acoes={acoes(l)} rotulo={`Ações de ${rotuloDaLinha(colunas, l)}`} testId={`${testId ?? 'tabela'}.acoes.${k}`} />
                  </td>
                )}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/** "Ações de <primeira coluna>": o leitor de tela diz de qual linha é o menu. */
function rotuloDaLinha<T>(colunas: ReadonlyArray<ColunaDaTabela<T>>, l: T): string {
  const c = colunas[0];
  return c?.texto?.(l) ?? 'linha';
}
