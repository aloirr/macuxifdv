/**
 * Opção exclusiva em cartão de 52 px (T-0191, docs/design/rotas-criar/spec.md §3.1, §5 e §6): "Criar só nos dias sem rota" /
 * "Substituir N rotas", "Casa" / "Outro endereço". É um `radio` nativo (setas do teclado e leitor de tela de graça) dentro de um
 * `label` com cara de cartão; a bolinha visível é só apresentação. A linha de apoio fica ligada ao radio por `aria-describedby`.
 * Desabilitada, a opção continua legível (texto em ink-2) e a linha de apoio diz o motivo, ex.: "Sem endereço no cadastro".
 * Uso: `<GrupoOpcoesCartao rotulo="Endereço base"><OpcaoCartao nome="base" valor="casa" … /></GrupoOpcoesCartao>`.
 * Sem `'use client'` e sem importar o `ui.tsx`: não tem estado próprio.
 */
import type { ReactNode } from 'react';

const juntar = (...c: Array<string | false | null | undefined>) => c.filter(Boolean).join(' ');

export type PropsOpcaoCartao = {
  /** `name` do radio: o mesmo em todas as opções do grupo. */
  nome: string;
  valor: string;
  selecionada: boolean;
  onSelecionar: (valor: string) => void;
  rotulo: ReactNode;
  /** Linha de apoio, opcional; na opção desabilitada, é o motivo. */
  apoio?: ReactNode;
  desabilitada?: boolean;
  testId?: string;
};

/** Id da linha de apoio (para `aria-describedby`): só letras, números, hífen e sublinhado. */
export function idDoApoio(nome: string, valor: string): string {
  return `${nome}-${valor}-apoio`.replace(/[^A-Za-z0-9_-]/g, '-');
}

export function OpcaoCartao({ nome, valor, selecionada, onSelecionar, rotulo, apoio, desabilitada = false, testId }: PropsOpcaoCartao) {
  const temApoio = apoio !== undefined && apoio !== null && apoio !== '';
  const apoioId = temApoio ? idDoApoio(nome, valor) : undefined;
  const marcada = selecionada && !desabilitada;
  return (
    <label
      className={juntar(
        'flex min-h-[52px] items-center gap-3 rounded-xl border px-4 py-2',
        'has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent',
        desabilitada
          ? 'cursor-not-allowed border-line bg-ground'
          : marcada
            ? 'cursor-pointer border-ink bg-surface ring-1 ring-inset ring-ink'
            : 'cursor-pointer border-field bg-surface hover:bg-ground',
      )}
      data-testid={testId}
      data-selecionada={marcada || undefined}
    >
      <input
        type="radio"
        name={nome}
        value={valor}
        checked={marcada}
        disabled={desabilitada}
        aria-describedby={apoioId}
        onChange={() => onSelecionar(valor)}
        className="sr-only"
        data-testid={testId ? `${testId}.radio` : undefined}
      />
      <span
        aria-hidden="true"
        className={juntar(
          'flex size-5 shrink-0 items-center justify-center rounded-full border-2',
          desabilitada ? 'border-disabled' : marcada ? 'border-ink' : 'border-ink-2',
        )}
      >
        {marcada && <span className="size-2.5 rounded-full bg-ink" />}
      </span>
      <span className="flex min-w-0 flex-col">
        <span className={juntar('text-[15px] font-semibold', desabilitada ? 'text-ink-2' : 'text-ink')}>{rotulo}</span>
        {temApoio && (
          <span id={apoioId} className="text-[13px] text-ink-2">
            {apoio}
          </span>
        )}
      </span>
    </label>
  );
}

/** Grupo das opções: `fieldset` com o nome do grupo para o leitor de tela (a legenda é visível só se `mostrarRotulo`). */
export function GrupoOpcoesCartao({
  rotulo,
  mostrarRotulo = false,
  children,
  testId,
}: {
  rotulo: string;
  mostrarRotulo?: boolean;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <fieldset className="m-0 flex min-w-0 flex-col gap-2 border-0 p-0" data-testid={testId}>
      <legend className={mostrarRotulo ? 'mb-1 p-0 text-[12px] font-semibold text-ink-2' : 'sr-only'}>{rotulo}</legend>
      {children}
    </fieldset>
  );
}
