'use client';

/**
 * Portal de implantação, versão "em breve" (T-0086). Exige login como o resto do BKO: sem sessão, vai para
 * `/login?next=<endereço do navegador>` (no host `config.` o endereço é `/`, e o proxy leva de volta ao portal). O
 * caminho vem de `window.location`, não do `usePathname`, porque a página chega por rewrite do `proxy.ts`.
 * O acesso só do super-admin com 2º fator e o conteúdo (empresa, equipe e bases por CSV) chegam na T-0087.
 */
import { useRouter } from 'next/navigation';
import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Button, LoadingBlock } from '@macuxi/ui/web';
import { encerrarSessao, useSessao } from '@/lib/session';

export function PortalEmBreve() {
  const session = useSessao();
  const router = useRouter();
  const qc = useQueryClient();

  useEffect(() => {
    if (session.status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(window.location.pathname + window.location.search)}`);
  }, [session.status, router]);

  if (session.status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground">
        <LoadingBlock label={session.status === 'anonymous' ? 'Indo para o login…' : 'Carregando…'} />
      </div>
    );
  }

  const sair = () => {
    encerrarSessao();
    qc.clear();
    router.replace('/login');
  };

  return (
    <main data-testid="portal-em-breve" className="flex min-h-screen items-center justify-center bg-ground px-4 py-10">
      <section className="flex w-full max-w-[560px] flex-col gap-4 rounded-2xl border border-line bg-surface p-6">
        <span className="text-[11px] font-semibold tracking-[0.06em] text-accent uppercase">Em breve</span>
        <h1 className="m-0 font-display text-[22px] font-bold">Portal de implantação</h1>
        <p className="m-0 text-[14px] text-ink-3">Aqui a Macuxi vai cadastrar a empresa cliente e carregar a equipe e as bases por CSV, sem linha de comando.</p>
        <div className="flex items-center justify-between gap-3 border-t border-line pt-4 text-[13px] text-ink-2">
          <span className="truncate">{session.user?.name}</span>
          <Button variant="link" onClick={sair}>
            Sair
          </Button>
        </div>
      </section>
    </main>
  );
}
