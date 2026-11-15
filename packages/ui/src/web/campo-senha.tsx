/**
 * R-20261115-071000 (dono do produto, 15/11/2026: "Padrão da senha é o olho para mostrar e ocultar"): `CampoSenha`, o campo de
 * senha único da web (BKO e portal de implantação). Spec: docs/design/campo-senha/spec.md.
 *
 * - Botão só com ícone, dentro do campo, à direita, alvo de 44 px: `IconEye` com a senha oculta ("Mostrar senha"),
 *   `IconEyeOff` com a senha visível ("Ocultar senha"); o texto fica só no `aria-label` (sem "Mostrar"/"Esconder" na tela).
 * - Controlado e sem hooks (o teste chama o componente como função): a tela guarda `visivel` e troca no `onAlternar`; em
 *   "Crie sua senha" o mesmo estado vale para os dois campos. Sem `onAlternar` o campo não tem olho.
 * - `autoComplete` `current-password` (padrão) ou `new-password` (`finalidade="criacao"`); sem corretor nem maiúscula.
 * - `descrito` liga a lista das regras (`RegrasDaSenha`) pelo `aria-describedby`, junto com o erro (`<id>-erro`).
 */
import type { InputHTMLAttributes } from 'react';

import { rotuloDoOlhoDaSenha, type FinalidadeSenha } from '../comum/senha';
import { IconEye, IconEyeOff } from './icons';
import { CLASSE_CAMPO_ACESSO, cx } from './ui';

/** Botão do olho: 44 × 44 px, colado à direita do campo. */
export const OLHO_SENHA_CSS =
  'absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent';

export type CampoSenhaProps = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'id' | 'autoComplete' | 'spellCheck' | 'autoCapitalize' | 'autoCorrect'> & {
  /** Id do campo (o `<label>` aponta para ele; o erro usa `<id>-erro`). */
  id: string;
  rotulo: string;
  /** A senha está à mostra agora (estado da tela). */
  visivel: boolean;
  /** Clique no olho. Ausente = campo sem olho. */
  onAlternar?: () => void;
  /** `login` (padrão): `current-password`; `criacao`: `new-password`. */
  finalidade?: FinalidadeSenha;
  erro?: string | null;
  /** Id de outro texto que descreve o campo (lista das regras). */
  descrito?: string;
  testId?: string;
  className?: string;
};

export function CampoSenha({ id, rotulo, visivel, onAlternar, finalidade = 'login', erro, descrito, testId, className, ...rest }: CampoSenhaProps) {
  const idErro = `${id}-erro`;
  const ligados = [descrito, erro ? idErro : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={id} className="text-[13px] font-semibold text-ink">
        {rotulo}
      </label>
      <div className="relative">
        <input
          {...rest}
          id={id}
          data-testid={testId}
          type={visivel ? 'text' : 'password'}
          autoComplete={finalidade === 'criacao' ? 'new-password' : 'current-password'}
          spellCheck={false}
          autoCapitalize="none"
          autoCorrect="off"
          aria-invalid={erro ? true : undefined}
          aria-describedby={ligados}
          className={cx(CLASSE_CAMPO_ACESSO, onAlternar && 'pr-12')}
        />
        {onAlternar && (
          <button
            type="button"
            data-testid={testId ? `${testId}.olho` : undefined}
            aria-label={rotuloDoOlhoDaSenha(visivel)}
            onClick={onAlternar}
            className={OLHO_SENHA_CSS}
          >
            {visivel ? <IconEyeOff size={18} /> : <IconEye size={18} />}
          </button>
        )}
      </div>
      {erro && (
        <span id={idErro} className="text-[12px] text-danger">
          {erro}
        </span>
      )}
    </div>
  );
}
