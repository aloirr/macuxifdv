import type { ReactNode } from 'react';

/** Vazio dentro do cartão da tabela (MC-0061): só o texto, sem a borda tracejada do `EstadoVazio` (que fica solto no fundo). */
export function VazioSimples({
  titulo,
  acao,
  testId,
}: {
  titulo: string;
  acao?: ReactNode;
  testId?: string;
}) {
  return (
    <div data-testid={testId} className="flex flex-col items-center gap-3 px-6 py-10 text-center">
      <span className="text-[14px] font-semibold text-ink-2">{titulo}</span>
      {acao}
    </div>
  );
}
