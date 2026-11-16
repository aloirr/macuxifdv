import type { ReactNode } from 'react';

/**
 * Cabeçalho da edição e do novo perfil dentro do painel Perfis de acesso (o shell já dá a caixa e o título do painel): sem caixa
 * nem título de página (MC-1700); o nome em 17/600 (título de seção, manual §5.3), o "‹ Voltar" acima e as ações à direita.
 */
export function CabecalhoDoPerfil({ voltar, titulo, selo, acoes }: { voltar?: ReactNode; titulo: string; selo?: ReactNode; acoes?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 border-b border-line-2 pb-3">
      <div className="flex flex-col gap-1">
        {voltar}
        <div className="flex items-center gap-2">
          <h3 className="m-0 text-[17px] font-semibold text-ink">{titulo}</h3>
          {selo}
        </div>
      </div>
      {acoes ? <div className="flex flex-wrap items-center gap-2">{acoes}</div> : null}
    </div>
  );
}
