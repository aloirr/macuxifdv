'use client';

/** Raiz do portal (`config.macuxifdv.com.br/`): com sessão válida vai para as empresas; sem, para a entrada (T-0087). */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { LoadingBlock } from '@macuxi/ui/web';

import { estadoDaSessao, lerSessaoPortal } from '@/lib/portal-sessao';

export function PortalInicio() {
  const router = useRouter();
  useEffect(() => {
    const e = estadoDaSessao(lerSessaoPortal(), Date.now());
    router.replace(e === 'valida' || e === 'renovar' ? '/empresas' : '/entrar');
  }, [router]);
  return (
    <div data-testid="portal.inicio" className="flex min-h-screen items-center justify-center bg-ground">
      <LoadingBlock label="Abrindo o portal…" />
    </div>
  );
}
