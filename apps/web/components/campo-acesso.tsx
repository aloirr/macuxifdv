/**
 * Campo de texto das telas de acesso (login do BKO, "Esqueci a senha" e portal `config.`): rótulo, caixa `CLASSE_CAMPO_ACESSO`
 * do kit e o erro (ou a ajuda) ligado ao campo pelo `aria-describedby` (revisão de UX R-20261106-050553 Y10). Um só para as
 * telas de acesso (RD-0506); a senha usa o `CampoSenha` do kit. `ref` vai direto ao `<input>` (React 19).
 */
import { useId, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { CLASSE_CAMPO_ACESSO, cx } from '@macuxi/ui/web';

export type CampoProps = InputHTMLAttributes<HTMLInputElement> & {
  rotulo: string;
  erro?: string | null;
  ajuda?: ReactNode;
  testId: string;
  ref?: Ref<HTMLInputElement>;
};

export function Campo({ rotulo, erro, ajuda, testId, className, ref, ...rest }: CampoProps) {
  const idNota = `${useId()}-nota`;
  const nota = erro || ajuda ? idNota : undefined;
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[13px] font-semibold text-ink">{rotulo}</span>
      <input ref={ref} data-testid={testId} aria-invalid={erro ? true : undefined} aria-describedby={nota} className={CLASSE_CAMPO_ACESSO} {...rest} />
      {erro ? (
        <span id={idNota} className="text-[12px] text-danger">
          {erro}
        </span>
      ) : ajuda ? (
        <span id={idNota} className="text-[12px] text-ink-2">
          {ajuda}
        </span>
      ) : null}
    </label>
  );
}
