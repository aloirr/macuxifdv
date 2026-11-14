'use client';

/**
 * Peças comuns do portal `config.` (T-0087; T-0093): moldura, cabeçalho com a sessão (e o "Trocar de empresa" do admin do
 * cliente), campo de formulário, campo de senha com o olho e a guarda de sessão. O cabeçalho é a faixa Azul noite (MC-0023).
 * Visual pelos tokens e componentes de `@macuxi/ui/web` (os do login do BKO); sem menu dos módulos (o portal não é o BKO).
 * Caminhos sem o prefixo `/config`: no host `config.` o navegador vê `/empresas` e o `proxy.ts` reescreve.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type InputHTMLAttributes, type ReactNode } from 'react';
import { cx, ESCONDER_SENHA, IconEye, IconEyeOff, LoadingBlock, MOSTRAR_SENHA } from '@macuxi/ui/web';

import { MarcaNaFaixa } from '@/components/marca-faixa';
import { houveUsoRecente, MODO_PORTAL_FALSO, registrarUso, renovarSessaoPortal, sairDoPortal } from '@/lib/portal-api';
import { hora } from '@/lib/portal-formato';
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
  versaoDaSessaoPortal,
  type DesvioPortal,
  type SessaoPortal,
} from '@/lib/portal-sessao';

export const campoCss =
  'h-11 w-full rounded-xl border border-field bg-surface px-3 text-[15px] text-ink outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-[invalid=true]:border-danger disabled:bg-ground disabled:text-ink-2';

/** Marca do portal: o logo negativo na faixa Azul noite (T-0172). `naBarra` = dentro do cabeçalho, que já é a faixa (MC-0023). */
export function Marca({ naBarra = false }: { naBarra?: boolean }) {
  return <MarcaNaFaixa area="Portal de implantação" noPortal semFundo={naBarra} />;
}

/** Link com cara de botão (sem `<button>` dentro de `<a>`). */
export function LinkBotao({ href, children, primario, testId, className }: { href: string; children: ReactNode; primario?: boolean; testId?: string; className?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cx(
        'inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl px-4 text-[14px] font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        primario ? 'bg-accent text-white hover:bg-accent/90' : 'border border-field bg-surface text-ink hover:bg-ground',
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

export function Campo({
  rotulo,
  erro,
  ajuda,
  testId,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; erro?: string | null; ajuda?: ReactNode; testId: string }) {
  // o erro (ou a ajuda) fica ligado ao campo: o leitor de tela lê junto com o rótulo (revisão de UX R-20261106-050553 Y10)
  const idNota = `${useId()}-nota`;
  const nota = erro || ajuda ? idNota : undefined;
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[13px] font-semibold text-ink">{rotulo}</span>
      <input data-testid={testId} aria-invalid={erro ? true : undefined} aria-describedby={nota} className={campoCss} {...rest} />
      {erro ? (
        <span id={idNota} className="text-[12px] text-danger">
          {erro}
        </span>
      ) : ajuda ? (
        <span id={idNota} className="text-[12px] text-ink-2">
          {ajuda}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Campo de senha com o botão do olho dentro, à direita (spec docs/design/portal-entrar.md §1 e §6): "Mostrar senha" /
 * "Esconder senha" (`MOSTRAR_SENHA`/`ESCONDER_SENHA` do kit) com `IconEye`/`IconEyeOff` do kit, alvo de 44 px. `descrito` liga a lista das regras (`RegrasDaSenha`)
 * ao campo pelo `aria-describedby`, junto com o erro.
 */
export function CampoSenha({
  rotulo,
  erro,
  testId,
  descrito,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { rotulo: string; erro?: string | null; testId: string; descrito?: string }) {
  const [mostrar, setMostrar] = useState(false);
  const idCampo = useId();
  const idErro = `${idCampo}-erro`;
  const ligados = [descrito, erro ? idErro : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={idCampo} className="text-[13px] font-semibold text-ink">
        {rotulo}
      </label>
      <div className="relative">
        <input
          id={idCampo}
          data-testid={testId}
          type={mostrar ? 'text' : 'password'}
          spellCheck={false}
          autoCapitalize="none"
          aria-invalid={erro ? true : undefined}
          aria-describedby={ligados}
          className={cx(campoCss, 'pr-12')}
          {...rest}
        />
        <button
          type="button"
          data-testid={`${testId}.olho`}
          aria-label={mostrar ? ESCONDER_SENHA : MOSTRAR_SENHA}
          onClick={() => setMostrar((m) => !m)}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          {mostrar ? <IconEyeOff size={18} /> : <IconEye size={18} />}
        </button>
      </div>
      {erro && (
        <span id={idErro} className="text-[12px] text-danger">
          {erro}
        </span>
      )}
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
      const estado = estadoDaSessao(lerSessaoPortal(), Date.now());
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

/** Itens do cabeçalho do time da Macuxi (T-0158: "Diagnósticos" ao lado de "Empresas"); o admin do cliente não vê nenhum. */
export const MENU_TIME_MACUXI = [
  { href: '/empresas', rotulo: 'Empresas', testId: 'portal.menu.empresas' },
  { href: '/diagnosticos', rotulo: 'Diagnósticos', testId: 'portal.menu.diagnosticos' },
] as const;

/** Item ativo pelo caminho (no host `config.` o navegador vê `/diagnosticos`; no PC sem o host, `/config/diagnosticos`). */
export function itemAtivoDoMenu(caminho: string | null): string | null {
  const c = (caminho ?? '').replace(/^\/config(?=\/|$)/, '') || '/';
  return MENU_TIME_MACUXI.find((i) => c === i.href || c.startsWith(`${i.href}/`))?.href ?? null;
}

/** Botão secundário sobre a faixa Azul noite (MC-0023): borda `faixa-texto`, fundo transparente, texto branco, foco branco. */
const botaoNaFaixa =
  'inline-flex min-h-11 items-center justify-center rounded-xl border border-faixa-texto bg-transparent px-3 text-[13px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white';

/**
 * Moldura das páginas internas: cabeçalho na faixa Azul noite (MC-0023) com a marca, o fim da sessão e "Sair"; para o admin do
 * cliente com 2+ empresas, "Trocar de empresa" (T-0093). O nome da empresa fica só no título da página (RD-0261). A marca leva à
 * página inicial de quem entrou (time da Macuxi: Empresas; admin do cliente: a empresa dele), e o "← voltar" para a lista só
 * aparece para o time da Macuxi.
 */
export function MolduraPortal({ children, titulo, voltar }: { children: ReactNode; titulo?: ReactNode; voltar?: { href: string; rotulo: string } }) {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const ativo = itemAtivoDoMenu(usePathname());
  const sair = () => void sairDoPortal().then(() => router.replace('/entrar'));
  const inicio = sessao ? destinoDaSessao(sessao) : '/empresas';
  const cliente = sessao?.tipo === 'admin_cliente';
  // o admin do cliente não tem a lista de empresas: o "← Empresas" não aparece para ele
  const voltarVisivel = voltar && !(cliente && voltar.href === '/empresas') ? voltar : undefined;

  return (
    <GuardaPortal>
      <div className="min-h-screen bg-ground">
        <AvisoModoFalso />
        <header data-testid="portal.cabecalho" className="bg-faixa">
          <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-2">
            <div className="flex flex-wrap items-center gap-6">
              <Link href={inicio} className="rounded-xl no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white" data-testid="portal.marca">
                <Marca naBarra />
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
                        '-mb-2 flex min-h-11 items-center border-b-2 px-3 pb-2 text-[14px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                        ativo === i.href ? 'border-white text-white' : 'border-transparent text-faixa-texto hover:text-white',
                      )}
                    >
                      {i.rotulo}
                    </Link>
                  ))}
                </nav>
              )}
            </div>
            <div className="flex min-w-0 flex-wrap items-center gap-3 text-[13px] text-faixa-texto">
              {sessao && <span data-testid="portal.sessao-ate">Sessão até {hora(sessao.sessao_expira_em)}</span>}
              {podeTrocarDeEmpresa(sessao) && (
                <button type="button" data-testid="portal.trocar-empresa" className={botaoNaFaixa} onClick={() => router.push(CAMINHO_ESCOLHER_EMPRESA)}>
                  Trocar de empresa
                </button>
              )}
              <button type="button" data-testid="portal.sair" className={botaoNaFaixa} onClick={sair}>
                Sair
              </button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-6">
          {voltarVisivel && (
            <Link href={voltarVisivel.href} data-testid="portal.voltar" className="text-[13px] font-semibold text-accent-ink no-underline hover:underline">
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
