'use client';

/**
 * Peças comuns do portal `config.` (T-0087; T-0093): moldura, cabeçalho com a sessão (e o "Trocar de empresa" do admin do
 * cliente) e a guarda de sessão. Os campos são o `Campo` de `components/campo-acesso.tsx`. O campo de senha é o `CampoSenha` do kit (R-20261115-071000).
 * Visual pelos tokens e componentes de `@macuxi/ui/web` (os do login do BKO); sem menu dos módulos (o portal não é o BKO).
 * Caminhos com o prefixo `/config` (`noPortal`, `lib/portal.ts`).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { cx, formatTime, LoadingBlock, Panel } from '@macuxi/ui/web';

import { MarcaNaFaixa } from '@/components/marca-faixa';
import { MenuUsuario, type TrocaDeSenhaNoMenu } from '@/components/menu-usuario';
import { identidadeDoPortal } from '@/lib/menu-usuario';
import { erroDaTrocaNoPortal, podeTrocarSenhaNoPortal, trocarSenhaNoPortal } from '@/lib/portal-senha';
import { houveUsoRecente, MODO_PORTAL_FALSO, registrarUso, renovarSessaoPortal, sairDoPortal } from '@/lib/portal-api';
import { CAMINHO_DIAGNOSTICOS } from '@/lib/portal-diagnosticos';
import { CAMINHO_FRASES_CARGA } from '@/lib/portal-frases-carga';
import { ehCaminhoDoPortal, ENTRADA_DO_PORTAL, noPortal } from '@/lib/portal';
import {
  assinarSessaoPortal,
  CAMINHO_EMPRESAS,
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

/** Marca do portal: o logo negativo na faixa Azul noite (T-0172); `naBarra` no cabeçalho, que já é a faixa. */
export function Marca({ naBarra }: { naBarra?: boolean }) {
  return naBarra ? <MarcaNaFaixa area="Portal de implantação" naBarra /> : <MarcaNaFaixa area="Portal de implantação" />;
}

/**
 * Botão do cabeçalho na faixa Azul noite (MC-0023, docs/design/telas/portal-config-enxuto.md §0): borda `faixa-texto`, fundo
 * transparente e texto branco (12,77:1 na faixa), foco branco. Botão próprio: o `Button` secundário do kit tem fundo `surface`.
 */
function BotaoDaFaixa({ testId, onClick, children }: { testId: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={onClick}
      className="inline-flex min-h-11 items-center justify-center rounded-[10px] border border-faixa-texto bg-transparent px-3 text-[13px] font-semibold text-white transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
    >
      {children}
    </button>
  );
}

/** Link com cara de botão (sem `<button>` dentro de `<a>`); o principal em Azul noite, como o `Button` (MC-0021). */
export function LinkBotao({ href, children, primario, testId, className }: { href: string; children: ReactNode; primario?: boolean; testId?: string; className?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cx(
        'inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl px-4 text-[15px] font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        primario ? 'bg-accent text-white hover:bg-accent/90' : 'border border-field bg-surface text-ink hover:bg-ground',
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
 * Guarda das páginas internas: sem sessão (ou vencida) → `/config/entrar`. Com uso recente, renova o token antes do fim; sem uso, deixa
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
      router.replace(ENTRADA_DO_PORTAL);
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
  { href: CAMINHO_EMPRESAS, rotulo: 'Empresas', testId: 'portal.menu.empresas' },
  { href: CAMINHO_DIAGNOSTICOS, rotulo: 'Diagnósticos', testId: 'portal.menu.diagnosticos' },
  { href: CAMINHO_FRASES_CARGA, rotulo: 'Frases da carga', testId: 'portal.menu.frases-carga' },
] as const;

/**
 * Item ativo pelo caminho: `/config/diagnosticos` (os links do portal) ou `/diagnosticos` (endereço reescrito por um favorito
 * antigo do host `config.`).
 */
export function itemAtivoDoMenu(caminho: string | null): string | null {
  const bruto = caminho || '/';
  const c = ehCaminhoDoPortal(bruto) ? bruto : noPortal(bruto);
  return MENU_TIME_MACUXI.find((i) => c === i.href || c.startsWith(`${i.href}/`))?.href ?? null;
}

/**
 * "Trocar a senha" do menu do usuário do portal: o time Macuxi pela rota do portal (ADR 0075; a sessão diz quem é, a troca derruba
 * a sessão); o admin do cliente com a empresa escolhida pela rota pública do Core (o código da empresa vai no pedido; o e-mail ele
 * digita). Se a sessão do portal cair, a pessoa vai à entrada com o aviso.
 */
function trocaDeSenhaDoPortal(sessao: SessaoPortal, irParaEntrada: () => void): TrocaDeSenhaNoMenu | undefined {
  if (!podeTrocarSenhaNoPortal(sessao)) return undefined;
  return {
    pedirEmail: sessao.tipo === 'admin_cliente',
    enviar: async (p) => {
      const r = await trocarSenhaNoPortal(lerSessaoPortal() ?? sessao, p);
      if (r === 'entrar_de_novo') irParaEntrada();
      return r === 'continua';
    },
    erro: erroDaTrocaNoPortal,
  };
}

/**
 * Moldura das páginas internas: cabeçalho com a marca, o fim da sessão e o menu do usuário (com o "Sair"); para o admin do
 * cliente, o nome da empresa atual e, com 2+ empresas, "Trocar de empresa" (T-0093; spec docs/design/portal-entrar.md §3). A
 * marca leva à página inicial de quem entrou (time da Macuxi: Empresas; admin do cliente: a empresa dele), e o "← voltar" para
 * a lista só aparece para o time da Macuxi.
 */
export function MolduraPortal({ children, titulo, voltar }: { children: ReactNode; titulo?: ReactNode; voltar?: { href: string; rotulo: string } }) {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const ativo = itemAtivoDoMenu(usePathname());
  const sair = () => {
    void sairDoPortal().then(() => router.replace(ENTRADA_DO_PORTAL));
  };
  const trocar = () => router.push(CAMINHO_ESCOLHER_EMPRESA);
  const inicio = sessao ? destinoDaSessao(sessao) : CAMINHO_EMPRESAS;
  const cliente = sessao?.tipo === 'admin_cliente';
  // o admin do cliente não tem a lista de empresas: o "← Empresas" não aparece para ele
  const voltarVisivel = voltar && !(cliente && voltar.href === CAMINHO_EMPRESAS) ? voltar : undefined;

  return (
    <GuardaPortal>
      <div className="min-h-screen bg-ground">
        <AvisoModoFalso />
        <header className="bg-faixa">
          {/* < 768 px (spec §10.2): logo e o menu do usuário (no lugar do "Sair") na 1ª linha; abas e "Sessão até" na de baixo. A partir de 768 px, tudo numa linha. */}
          <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center gap-x-3 px-4">
            <Link href={inicio} className="order-1 py-3 no-underline md:py-0" data-testid="portal.marca">
              <Marca naBarra />
            </Link>
            <div className="order-2 ml-auto py-2 md:order-5 md:ml-0">
              {sessao && <MenuUsuario identidade={identidadeDoPortal(sessao)} onSair={sair} trocarSenha={trocaDeSenhaDoPortal(sessao, () => router.replace(ENTRADA_DO_PORTAL))} tom="escuro" />}
            </div>
            <div aria-hidden className="order-3 h-0 basis-full md:hidden" />
            {ehTimeMacuxi(sessao) && (
              <nav aria-label="Portal" className="order-4 flex items-stretch gap-1 self-stretch md:order-2 md:ml-3">
                {MENU_TIME_MACUXI.map((i) => (
                  <Link
                    key={i.href}
                    href={i.href}
                    data-testid={i.testId}
                    aria-current={ativo === i.href ? 'page' : undefined}
                    className={cx(
                      'flex min-h-11 items-center whitespace-nowrap border-b-2 px-3 text-[15px] font-semibold no-underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white',
                      ativo === i.href ? 'border-white text-white' : 'border-transparent text-faixa-texto hover:text-white',
                    )}
                  >
                    {i.rotulo}
                  </Link>
                ))}
              </nav>
            )}
            <div className="order-5 flex min-w-0 flex-wrap items-center gap-3 py-3 text-[13px] text-faixa-texto md:order-3 md:ml-auto">
              {sessao && (
                <span data-testid="portal.sessao-ate">Sessão até {formatTime(sessao.sessao_expira_em)}</span>
              )}
              {podeTrocarDeEmpresa(sessao) && (
                <BotaoDaFaixa testId="portal.trocar-empresa" onClick={trocar}>
                  Trocar de empresa
                </BotaoDaFaixa>
              )}
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
