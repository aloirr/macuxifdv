'use client';

import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useState, type ReactNode } from 'react';
import { ApiRequestError } from '@macuxi/platform-sdk/web';
import { ToastProvider } from '@macuxi/ui/web';

import { avisarSePerfilSemBko } from '@/lib/ciclo-senha';

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        // RN-CORE-33 (T-0094): 403 PERFIL_SEM_BKO em qualquer consulta ou gravação = o perfil perdeu o backoffice durante o uso;
        // o shell (app-shell) encerra a sessão e volta ao Entrar com o aviso
        queryCache: new QueryCache({ onError: (e) => void avisarSePerfilSemBko(e) }),
        mutationCache: new MutationCache({ onError: (e) => void avisarSePerfilSemBko(e) }),
        defaultOptions: {
          queries: {
            staleTime: 5_000,
            refetchOnWindowFocus: true,
            // 4xx não adianta repetir
            retry: (count, err) => !(err instanceof ApiRequestError && err.status >= 400 && err.status < 500) && count < 2,
          },
        },
      }),
  );
  return (
    <QueryClientProvider client={client}>
      <ToastProvider>{children}</ToastProvider>
    </QueryClientProvider>
  );
}
