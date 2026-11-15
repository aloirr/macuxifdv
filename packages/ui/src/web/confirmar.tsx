/**
 * Confirmação por digitação, para ações sem volta (ex.: excluir a empresa no portal). Spec:
 * docs/design/telas/portal-config-enxuto.md §15.2 e §15.4; regras da exclusão na ADR 0052 §3.
 *
 * Rótulo "Digite {código} para confirmar" + campo. O componente é controlado e sem hooks (o teste o chama como função):
 * a tela guarda o valor e habilita o botão de confirmar com `codigoConfere(valor, codigo)`. Código errado não mostra erro;
 * só o botão segue desabilitado.
 */
import type { ChangeEvent } from 'react';
import { CLASSES_DESTAQUE } from './cores';
import { cx } from './ui';

/** Confere o digitado com o código, sem diferença de maiúsculas e de espaços nas pontas. Vazio nunca confere. */
export function codigoConfere(digitado: string, codigo: string): boolean {
  const a = digitado.trim().toUpperCase();
  return a.length > 0 && a === codigo.trim().toUpperCase();
}

export function rotuloConfirmarDigitando(codigo: string): string {
  return `Digite ${codigo} para confirmar`;
}

export function ConfirmarDigitando({
  id,
  codigo,
  valor,
  onChange,
  testID,
  disabled,
}: {
  id: string;
  codigo: string;
  valor: string;
  onChange: (valor: string) => void;
  testID?: string;
  disabled?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        Digite <span className="font-mono font-medium">{codigo}</span> para confirmar
      </label>
      <input
        id={id}
        type="text"
        value={valor}
        onChange={(e: ChangeEvent<HTMLInputElement>) => onChange(e.target.value)}
        autoFocus
        autoComplete="off"
        autoCapitalize="characters"
        spellCheck={false}
        disabled={disabled}
        data-testid={testID}
        data-confere={codigoConfere(valor, codigo) ? 'sim' : 'nao'}
        className={cx(
          'h-[44px] w-full rounded-[10px] border border-field bg-surface px-3 font-mono text-[15px] tracking-[1px] text-ink disabled:opacity-60',
          CLASSES_DESTAQUE.foco,
        )}
      />
    </div>
  );
}
