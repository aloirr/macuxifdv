import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@macuxi/ui/web';
import { UsuariosConteudo } from '@core/web/components/usuarios/usuarios-page';

const cliente = new QueryClient({ defaultOptions: { queries: { retry: false } } });
createRoot(document.getElementById('raiz')!).render(
  <QueryClientProvider client={cliente}>
    <ToastProvider>
      <div style={{ padding: 32 }}>
        <UsuariosConteudo />
      </div>
    </ToastProvider>
  </QueryClientProvider>,
);
