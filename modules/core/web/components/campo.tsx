import type { InputHTMLAttributes } from 'react';
import { CLASSE_CAMPO_BKO } from '../lib/classes';

/** Erro de um campo dos painéis do Core no BKO: 13/400, ligado ao campo por `id` (aria-describedby). Um lugar só (RD-1981, RD-2011). */
export function ErroCampo({ id, texto }: { id: string; texto?: string }) {
  return texto ? (
    <span id={id} className="text-[13px] font-normal text-danger" data-testid={id}>
      {texto}
    </span>
  ) : null;
}

/**
 * Campo com a unidade escrita à direita ("h", "%", "dias"), sobre a `CLASSE_CAMPO_BKO` (RD-2012). `testId` é o `data-testid` do input;
 * com `idErro`, o campo fica inválido e aponta para o `ErroCampo` de mesmo id.
 */
export function CampoComUnidade({ testId, unidade, idErro, ...input }: { testId: string; unidade: string; idErro?: string } & InputHTMLAttributes<HTMLInputElement>) {
  return (
    <span className="relative block">
      <input
        {...input}
        className={`${CLASSE_CAMPO_BKO.replace('border-field', idErro ? 'border-danger' : 'border-field')} w-full pr-12`}
        aria-invalid={idErro ? true : undefined}
        aria-describedby={idErro}
        data-testid={testId}
      />
      <span aria-hidden className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-[13px] font-normal text-ink-2">
        {unidade}
      </span>
    </span>
  );
}
