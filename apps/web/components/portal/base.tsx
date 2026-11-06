'use client';

/**
 * Peças comuns do portal `config.` (T-0087): moldura, cabeçalho com a sessão, campo de formulário e a guarda de sessão.
 * Visual pelos tokens e componentes de `@macuxi/ui/web` (os do login do BKO); sem menu dos módulos (o portal não é o BKO).
 * Caminhos sem o prefixo `/config`: no host `config.` o navegador vê `/empresas` e o `proxy.ts` reescreve.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useSyncExternalStore, type InputHTMLAttributes, type ReactNode } from 'react';
import { Badge, Button, cx, LoadingBlock } from '@macuxi/ui/web';

import { houveUsoRecente, MODO_PORTAL_FALSO, registrarUso, renovarSessaoPortal, sairDoPortal } from '@/lib/portal-api';
import { assinarSessaoPortal, estadoDaSessao, lerSessaoPortal, limparSessaoPortal, versaoDaSessaoPortal, type SessaoPortal } from '@/lib/portal-sessao';

export const campoCss =
  'h-11 w-full rounded-xl border border-field bg-surface px-3 text-[15px] text-ink outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-[invalid=true]:border-danger disabled:bg-ground disabled:text-ink-2';

export function Marca() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-accent font-display text-[17px] font-extrabold text-white">M</span>
      <div className="flex flex-col">
        <span className="font-display text-[15px] font-bold">Portal de implantação</span>
        <span className="text-[12px] text-ink-2">Macuxi FDV · acesso só da equipe Macuxi</span>
      </div>
    </div>
  );
}

/** Link com cara de botão (sem `<button>` dentro de `<a>`). */
export function LinkBotao({ href, children, primario, testId, className }: { href: string; children: ReactNode; primario?: boolean; testId?: string; className?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cx(
        'inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl px-4 text-[14px] font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        primario ? 'bg-ink text-white hover:bg-[#0b1218]' : 'border border-field bg-surface text-ink hover:bg-ground',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function AvisoModoFalso() {
  if (!MODO_PORTAL_FALSO) return null;
  return (
    <div data-testid="portal.modo-falso" className="bg-warning-soft px-4 py-1.5 text-center text-[12px] font-semibold text-warning">
      Modo falso: dados fictícios no navegador, sem chamar a API.
    </div>
  );
}

/** Tela estreita (entrar, primeiro acesso). */
export function MolduraEstreita({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="min-h-screen bg-ground">
      <AvisoModoFalso />
      <div data-testid={testId} className="flex flex-col items-center px-4 py-10 sm:py-16">
        <div className="flex w-full max-w-[440px] flex-col gap-5">
          <Marca />
          {children}
        </div>
      </div>
    </div>
  );
}

export function Campo({
  rotulo,
  erro,
  ajuda,
  testId,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; erro?: string | null; ajuda?: ReactNode; testId: string }) {
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[13px] font-semibold text-ink">{rotulo}</span>
      <input data-testid={testId} aria-invalid={erro ? true : undefined} className={campoCss} {...rest} />
      {erro ? <span className="text-[12px] text-danger">{erro}</span> : ajuda ? <span className="text-[12px] text-ink-2">{ajuda}</span> : null}
    </label>
  );
}

// ---------------------------------------------------------------------------------------------------------------- sessão

/** Sessão do portal no `sessionStorage`; `undefined` = ainda não leu (render do servidor e 1º render do cliente). */
export function useSessaoPortal(): SessaoPortal | null | undefined {
  const versao = useSyncExternalStore(assinarSessaoPortal, versaoDaSessaoPortal, () => -1);
  return useMemo(() => (versao < 0 ? undefined : lerSessaoPortal()), [versao]);
}

const CHECAR_MS = 30_000;

/**
 * Guarda das páginas internas: sem sessão (ou vencida) → `/entrar`. Com uso recente, renova o token antes do fim; sem uso, deixa
 * vencer (o próximo clique leva ao login). Conta o uso por clique e tecla.
 */
export function GuardaPortal({ children }: { children: ReactNode }) {
  const sessao = useSessaoPortal();
  const router = useRouter();

  useEffect(() => {
    if (sessao === undefined) return;
    if (!sessao || estadoDaSessao(sessao, Date.now()) === 'expirada') {
      if (sessao) limparSessaoPortal();
      router.replace('/entrar');
    }
  }, [sessao, router]);

  useEffect(() => {
    const uso = () => registrarUso();
    window.addEventListener('pointerdown', uso);
    window.addEventListener('keydown', uso);
    const t = window.setInterval(() => {
      const s = lerSessaoPortal();
      const estado = estadoDaSessao(s, Date.now());
      if (estado === 'expirada') limparSessaoPortal();
      else if (estado === 'renovar' && houveUsoRecente()) void renovarSessaoPortal();
    }, CHECAR_MS);
    return () => {
      window.removeEventListener('pointerdown', uso);
      window.removeEventListener('keydown', uso);
      window.clearInterval(t);
    };
  }, []);

  if (!sessao || estadoDaSessao(sessao, Date.now()) === 'expirada') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground">
        <LoadingBlock label={sessao === undefined ? 'Carregando…' : 'Indo para a entrada…'} />
      </div>
    );
  }
  return <>{children}</>;
}

/** Hora local (fuso do navegador do operador; o portal não é de um tenant). */
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Moldura das páginas internas: cabeçalho com "Empresas", o fim da sessão e "Sair". */
export function MolduraPortal({ children, titulo, voltar }: { children: ReactNode; titulo?: ReactNode; voltar?: { href: string; rotulo: string } }) {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const sair = async () => {
    await sairDoPortal();
    router.replace('/entrar');
  };
  return (
    <GuardaPortal>
      <div className="min-h-screen bg-ground">
        <AvisoModoFalso />
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href="/empresas" className="no-underline">
              <Marca />
            </Link>
            <div className="flex items-center gap-3 text-[13px] text-ink-2">
              {sessao && (
                <span data-testid="portal.sessao-ate">
                  Sessão até {hora(sessao.sessao_expira_em)}
                  {sessao.recuperacao_restantes <= 3 && (
                    <Badge tone="warning" className="ml-2">
                      {sessao.recuperacao_restantes} códigos de recuperação
                    </Badge>
                  )}
                </span>
              )}
              <Button data-testid="portal.sair" size="sm" onClick={() => void sair()}>
                Sair
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-6">
          {voltar && (
            <Link href={voltar.href} className="text-[13px] font-semibold text-accent no-underline hover:text-accent-ink">
              ← {voltar.rotulo}
            </Link>
          )}
          {titulo}
          {children}
        </main>
      </div>
    </GuardaPortal>
  );
}
