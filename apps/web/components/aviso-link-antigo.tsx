'use client';

/**
 * Página dos links de convite antigos (`/convite#<token>` e `/convite/<token>`, T-0087 fatia E). T-0094 (P3; desenho §9): o convite
 * por link saiu; o acesso chega por e-mail com uma senha temporária. A página não lê nem guarda o token (tira-o do endereço) e manda
 * a pessoa à entrada, onde há "Esqueci a senha". O proxy continua com `no-referrer`, `no-store` e `noindex` em `/convite`.
 * testIDs: link-antigo.tela, link-antigo.ir-login.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { Button, Notice } from '@macuxi/ui/web';

import { TEXTOS_LINK_ANTIGO } from '@/lib/ciclo-senha';

export function AvisoLinkAntigo() {
  const router = useRouter();
  // o token antigo sai do endereço e do histórico (não vale mais, mas não fica à vista)
  useEffect(() => {
    try {
      window.history.replaceState(null, '', '/convite');
    } catch {
      // sem histórico
    }
  }, []);
  return (
    <div data-testid="link-antigo.tela" className="flex min-h-screen flex-col items-center bg-ground px-4 py-10 sm:py-16">
      <div className="flex w-full max-w-[400px] flex-col gap-4">
        <h1 className="m-0 text-[24px] font-bold">{TEXTOS_LINK_ANTIGO.titulo}</h1>
        <Notice tone="info">{TEXTOS_LINK_ANTIGO.texto}</Notice>
        <Button data-testid="link-antigo.ir-login" variant="primary" onClick={() => router.replace('/login')}>
          {TEXTOS_LINK_ANTIGO.irParaEntrada}
        </Button>
      </div>
    </div>
  );
}
