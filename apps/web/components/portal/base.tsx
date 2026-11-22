'use client';

/**
 * Peças comuns do portal `config.` (T-0087; T-0093): moldura, cabeçalho com a sessão (e o "Trocar de empresa" do admin do
 * cliente) e a guarda de sessão. Os campos são o `Campo` de `components/campo-acesso.tsx`. O campo de senha é o `CampoSenha` do kit (R-20261115-071000).
 * Visual pelos tokens e componentes de `@macuxi/ui/web` (os do login do BKO); sem menu dos módulos (o portal não é o BKO).
 * Caminhos sem o prefixo `/config`: no host `config.` o navegador vê `/empresas` e o `proxy.ts` reescreve.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { Button, cx, LoadingBlock, Panel } from '@macuxi/ui/web';

import { MarcaNaFaixa } from '@/components/marca-faixa';
import { houveUsoRecente, MODO_PORTAL_FALSO, registrarUso, renovarSessaoPortal, sairDoPortal } from '@/lib/portal-api';
import {
  assinarSessaoPortal,
  CAMINHO_ESCOLHER_EMPRESA,
  destinoDaSessao,
  ehTimeMacuxi,
  estadoDaSessao,
  guardarRetornoPortal,
  lerDesvioPortal,
  lerSessaoPortal,
  limparSessaoPortal,
  podeTrocarDeEmpresa,
  retirarDesvioPortal,
  retirarSaidaPedida,
  SEM_ACESSO_TIME_MACUXI,
  versaoDaSessaoPortal,
  type DesvioPortal,
  type SessaoPortal,
} from '@/lib/portal-sessao';

/** Marca do portal: o logo negativo na faixa Azul noite (T-0172). */
export function Marca() {
  return <MarcaNaFaixa area="Portal de implantação" />;
}

/** Link com cara de botão (sem `<button>` dentro de `<a>`). */
export function LinkBotao({ href, children, primario, testId, className }: { href: string; children: ReactNode; primario?: boolean; testId?: string; className?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cx(
        'inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl px-4 text-[15px] font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        primario ? 'bg-ink text-white hover:bg-[#0b1218]' : 'border border-field bg-surface text-ink hover:bg-ground',
        className,
      )}
    >
      {children}
    </Link>
  );
}

/** "Sem acesso" das áreas só do time Macuxi (Diagnósticos, Frases da carga): o admin do cliente volta para a empresa dele. */
export function SemAcessoTimeMacuxi({ testId }: { testId: string }) {
  const sessao = useSessaoPortal();
  return (
    <Panel>
      <div data-testid={testId} className="flex flex-col items-start gap-3 py-4">
        <span className="text-[15px] font-semibold">{SEM_ACESSO_TIME_MACUXI}</span>
        {sessao && (
          <LinkBotao href={destinoDaSessao(sessao)} primario>
            Ir para a sua empresa
          </LinkBotao>
        )}
      </div>
    </Panel>
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

/** Tela estreita (entrar, escolha a empresa). */
export function MolduraEstreita({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="min-h-screen bg-ground">
      <AvisoModoFalso />
      <div data-testid={testId} className="flex flex-col items-center px-4 py-10 sm:py-16">
        <div className="flex w-full max-w-[440px] flex-col gap-5">
          <Marca />
          {/* cartão branco: hierarquia e contraste dos links (accent sobre o fundo dá 4,2:1; sobre branco, 4,6:1; R-20261106-023316 🟡 9) */}
          <div className="rounded-2xl border border-line bg-surface p-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- sessão

/** Sessão do portal no `sessionStorage`; `undefined` = ainda não leu (render do servidor e 1º render do cliente). */
export function useSessaoPortal(): SessaoPortal | null | undefined {
  const versao = useSyncExternalStore(assinarSessaoPortal, versaoDaSessaoPortal, () => -1);
  return useMemo(() => (versao < 0 ? undefined : lerSessaoPortal()), [versao]);
}

/** Desvio pedido por um 403/409 de empresa (admin do cliente): a guarda leva à "Escolha a empresa". */
function useDesvioPortal(): DesvioPortal | null {
  return useSyncExternalStore(assinarSessaoPortal, lerDesvioPortal, () => null);
}

/** Só o time Macuxi: `null` = ainda lendo a sessão; `false` = admin do cliente (mostra o "sem acesso"). */
export function useTimeMacuxi(): boolean | null {
  const sessao = useSessaoPortal();
  if (sessao === undefined || sessao === null) return null;
  return ehTimeMacuxi(sessao);
}

const CHECAR_MS = 30_000;

/**
 * Guarda das páginas internas: sem sessão (ou vencida) → `/entrar`. Com uso recente, renova o token antes do fim; sem uso, deixa
 * vencer (o próximo clique leva ao login). Conta o uso por clique e tecla.
 */
export function GuardaPortal({ children }: { children: ReactNode }) {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const vencida = sessao !== undefined && (!sessao || estadoDaSessao(sessao, Date.now()) === 'expirada');
  // houve sessão nesta página: se ela some (token vencido, 401 da API), a entrada explica "Sua sessão terminou"
  const teveSessao = useRef(false);
  useEffect(() => {
    if (sessao) teveSessao.current = true;
  }, [sessao]);

  useEffect(() => {
    if (sessao === undefined) return;
    if (!sessao || estadoDaSessao(sessao, Date.now()) === 'expirada') {
      // "Sair" não guarda volta nem aviso; o resto volta para esta página (com o #aba) depois do login (R-20261106-023316 🟡 10)
      if (!retirarSaidaPedida()) guardarRetornoPortal({ caminho: `${window.location.pathname}${window.location.hash}`, sessaoTerminou: teveSessao.current || sessao !== null });
      if (sessao) limparSessaoPortal();
      router.replace('/entrar');
    }
  }, [sessao, router]);

  // 403 `EMPRESA_NAO_PERMITIDA` / 409 `EMPRESA_NAO_ESCOLHIDA` do admin do cliente com 2+ empresas: escolher de novo (T-0093 §4)
  const desvio = useDesvioPortal();
  useEffect(() => {
    if (!desvio) return;
    retirarDesvioPortal();
    router.replace(CAMINHO_ESCOLHER_EMPRESA);
  }, [desvio, router]);

  useEffect(() => {
    const uso = () => registrarUso();
    window.addEventListener('pointerdown', uso);
    window.addEventListener('keydown', uso);
    // timer-permitido: relógio local da sessão do portal (lê o sessionStorage); rede só para renovar o token perto do fim e com uso
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

  if (sessao === undefined || vencida) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground">
        <LoadingBlock label={sessao === undefined ? 'Carregando…' : 'Indo para a entrada…'} />
      </div>
    );
  }

  return <>{children}</>;
}

/**
 * Itens do cabeçalho do time da Macuxi (T-0158: "Diagnósticos" ao lado de "Empresas"; T-0181: "Frases da carga" depois);
 * o admin do cliente não vê nenhum.
 */
export const MENU_TIME_MACUXI = [
  { href: '/empresas', rotulo: 'Empresas', testId: 'portal.menu.empresas' },
  { href: '/diagnosticos', rotulo: 'Diagnósticos', testId: 'portal.menu.diagnosticos' },
  { href: '/frases-carga', rotulo: 'Frases da carga', testId: 'portal.menu.frases-carga' },
] as const;

/** Item ativo pelo caminho (no host `config.` o navegador vê `/diagnosticos`; no PC sem o host, `/config/diagnosticos`). */
export function itemAtivoDoMenu(caminho: string | null): string | null {
  const c = (caminho ?? '').replace(/^\/config(?=\/|$)/, '') || '/';
  return MENU_TIME_MACUXI.find((i) => c === i.href || c.startsWith(`${i.href}/`))?.href ?? null;
}

/** Hora local (fuso do navegador do operador; o portal não é de um tenant). */
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/**
 * Moldura das páginas internas: cabeçalho com a marca, o fim da sessão e "Sair"; para o admin do cliente, o nome da empresa atual
 * e, com 2+ empresas, "Trocar de empresa" (T-0093; spec docs/design/portal-entrar.md §3). A marca leva à página inicial de quem
 * entrou (time da Macuxi: Empresas; admin do cliente: a empresa dele), e o "← voltar" para a lista só aparece para o time da
 * Macuxi.
 */
export function MolduraPortal({ children, titulo, voltar }: { children: ReactNode; titulo?: ReactNode; voltar?: { href: string; rotulo: string } }) {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const ativo = itemAtivoDoMenu(usePathname());
  const sair = () => {
    void sairDoPortal().then(() => router.replace('/entrar'));
  };
  const trocar = () => router.push(CAMINHO_ESCOLHER_EMPRESA);
  const inicio = sessao ? destinoDaSessao(sessao) : '/empresas';
  const cliente = sessao?.tipo === 'admin_cliente';
  // o admin do cliente não tem a lista de empresas: o "← Empresas" não aparece para ele
  const voltarVisivel = voltar && !(cliente && voltar.href === '/empresas') ? voltar : undefined;

  return (
    <GuardaPortal>
      <div className="min-h-screen bg-ground">
        <AvisoModoFalso />
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-3">
            <div className="flex flex-wrap items-center gap-6">
              <Link href={inicio} className="no-underline" data-testid="portal.marca">
                <Marca />
              </Link>
              {ehTimeMacuxi(sessao) && (
                <nav aria-label="Portal" className="flex items-stretch gap-1 self-stretch">
                  {MENU_TIME_MACUXI.map((i) => (
                    <Link
                      key={i.href}
                      href={i.href}
                      data-testid={i.testId}
                      aria-current={ativo === i.href ? 'page' : undefined}
                      className={cx(
                        '-mb-3 flex min-h-11 items-center border-b-2 px-3 pb-3 text-[15px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
                        ativo === i.href ? 'border-accent text-ink' : 'border-transparent text-ink-2 hover:text-ink',
                      )}
                    >
                      {i.rotulo}
                    </Link>
                  ))}
                </nav>
              )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3 text-[13px] text-ink-2">
              {/* o nome da empresa (contexto) vem antes do prazo da sessão (R-20261107-174216 🟢 3) */}
              {cliente && sessao?.empresa && (
                <span data-testid="portal.empresa-atual" title={sessao.empresa.nome} className="max-w-[220px] truncate text-[13px] font-semibold text-ink">
                  {sessao.empresa.nome}
                </span>
              )}
              {sessao && (
                <span data-testid="portal.sessao-ate">Sessão até {hora(sessao.sessao_expira_em)}</span>
              )}
              {podeTrocarDeEmpresa(sessao) && (
                <Button data-testid="portal.trocar-empresa" size="sm" className="min-h-11" onClick={trocar}>
                  Trocar de empresa
                </Button>
              )}
              <Button data-testid="portal.sair" size="sm" className="min-h-11" onClick={sair}>
                Sair
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-6">
          {voltarVisivel && (
            <Link
              href={voltarVisivel.href}
              data-testid="portal.voltar"
              className="text-[13px] font-semibold text-accent-ink no-underline hover:underline"
            >
              ← {voltarVisivel.rotulo}
            </Link>
          )}
          {titulo}
          {children}
        </main>
      </div>
    </GuardaPortal>
  );
}
