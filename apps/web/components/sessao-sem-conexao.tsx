'use client';

/**
 * T-0117 (revisão G2): a aba do BKO com o usuário guardado não alcançou o servidor ao restaurar a sessão pelo cookie (rede,
 * tempo esgotado, servidor fora). O usuário continua: em vez do login, o aviso do SDK (`session.aviso`, em português) e o
 * "Tentar de novo" (`tentarRestaurarSessao()`). A volta da rede e o foco na aba tentam sozinhos (SDK); com a renovação, o shell
 * volta ao conteúdo sem novo login. Só 401/423 levam ao login.
 */
import { Button, Notice } from '@macuxi/ui/web';

export const TEXTO_VOLTA_SOZINHO = 'Quando a conexão voltar, o backoffice abre de novo sozinho.';

export function SessaoSemConexao({ aviso, onTentar }: { aviso: string; onTentar: () => void }) {
  return (
    <div data-testid="shell-sem-conexao" className="flex min-h-screen items-center justify-center bg-ground px-4">
      <div className="flex w-full max-w-[440px] flex-col gap-3">
        <Notice tone="warning">{aviso}</Notice>
        <p className="text-[13px] text-ink-2">{TEXTO_VOLTA_SOZINHO}</p>
        <Button variant="primary" data-testid="shell-sem-conexao-tentar" onClick={onTentar}>
          Tentar de novo
        </Button>
      </div>
    </div>
  );
}
