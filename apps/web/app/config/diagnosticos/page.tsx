import type { Metadata } from 'next';
import { Suspense } from 'react';
import { LoadingBlock } from '@macuxi/ui/web';
import { TelaDiagnosticos } from '@/components/portal/tela-diagnosticos';

export const metadata: Metadata = { title: 'Diagnósticos' };

/** Portal › Diagnósticos (T-0158, ADR 0043): lista com filtros no endereço; só o time da Macuxi. */
export default function DiagnosticosPage() {
  // os filtros vêm do endereço (useSearchParams): o Suspense deixa o build gerar a página sem esperar a busca
  return (
    <Suspense fallback={<LoadingBlock label="Buscando os diagnósticos…" />}>
      <TelaDiagnosticos />
    </Suspense>
  );
}
