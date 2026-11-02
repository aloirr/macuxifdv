'use client';

/**
 * Erro inesperado numa página do BKO (T-0059, R-20261102-091519 item 2): o usuário vê uma frase em português com
 * "Tentar de novo"; o detalhe técnico (mensagem, pilha) vai só para o console. O menu do shell continua no lugar.
 */
import { ErrorBlock, PageHeader } from '@macuxi/ui/web';
import { useEffect } from 'react';

export default function ErroDaPagina({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('[erro na página]', error);
  }, [error]);
  return (
    <div className="flex flex-col gap-4">
      <PageHeader title="Algo deu errado nesta página" />
      <ErrorBlock message="" fallback="Não foi possível abrir esta página. Tente de novo; se continuar, avise o suporte." onRetry={reset} />
    </div>
  );
}
