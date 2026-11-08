'use client';

/**
 * Raiz do portal (`config.macuxifdv.com.br/`): com sessão válida vai para a página inicial de quem entrou (Empresas, a empresa do
 * admin do cliente ou a escolha dela; T-0093); sem, para a entrada (T-0087).
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingBlock } from '@macuxi/ui/web';

import { destinoDaSessao, estadoDaSessao, lerSessaoPortal } from '@/lib/portal-sessao';

export function PortalInicio() {
  const router = useRouter();
  useEffect(() => {
    const s = lerSessaoPortal();
    const e = estadoDaSessao(s, Date.now());
    router.replace(s && (e === 'valida' || e === 'renovar') ? destinoDaSessao(s) : '/entrar');
  }, [router]);
  return (
    <div data-testid="portal.inicio" className="flex min-h-screen items-center justify-center bg-ground">
      <LoadingBlock label="Abrindo o portal…" />
    </div>
  );
}
