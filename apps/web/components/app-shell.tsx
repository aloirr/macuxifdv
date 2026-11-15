'use client';

/**
 * Layout do BKO (copiado de components/app-shell.tsx da Fase M). O menu deixou de ser fixo: vem do
 * registro dos módulos efetivos do usuário (lib/modulos.ts → `criarShell`), filtrado por perfil e por
 * permissão por ação (ADR 0004), mais as páginas da plataforma (Auditoria, no grupo Sistema). Promotor e vendedor não
 * usam o BKO (Q6, doc 03). Cada item tem `data-testid` estável (`nav-<modulo>-<id>`). Itens do slot
 * `menu.itens` do Core (`ItemMenu`, modules/core/contracts/extensoes.ts) entram no grupo "Mais".
 * Menu (R-20261114-192700; docs/design/telas/bko-revisao.md §M2–§M4): grupos do SDK (`grupoMenu`/`rotuloGrupo`, ADR 0050), em ordem alfabética
 * (lib/menu-bko.ts); tudo aberto quando cabe na altura, senão sanfona com o grupo da tela atual aberto e painel ao lado
 * do menu ao passar o ponteiro (ou dar foco) num grupo fechado. Marca: logo A negativo para o grafite (MC-0056).
 * As páginas recebem o ambiente do navegador (`useHttp()`/`useAmbiente()` — lib/ambiente.ts).
 * RN-CORE-33 (T-0094; spec docs/design/ciclo-de-senha.md §1): perfil sem backoffice (a sessão cujo perfil não tem `acesso.bko`
 * no motor de permissões do SDK, `entraEm`, ou o 403 `PERFIL_SEM_BKO` de qualquer chamada) encerra a sessão e volta ao
 * Entrar com o aviso. Nenhuma lista de perfis no shell: onde entra e o que aparece vêm do motor (ADR 0033).
 * T-0176 (RN-CORE-39; ADR 0056): conta sem filial de cadastro (403 `USUARIO_SEM_FILIAL` nos módulos ou em qualquer chamada): o
 * BKO abre só a "Escolha a sua filial" (spec docs/design/filial-cadastro-venda §5), sem menu; a sessão fica (`eu/filial-cadastro`).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type FocusEvent, type MouseEvent, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ItemMenu } from '@macuxi/core/contracts';
import { entraEm, type Perfil, type VisaoShell } from '@macuxi/platform-sdk';
import { ShellProvider } from '@macuxi/platform-sdk/react';
import { errorMessage, MODO_API, tentarRestaurarSessao } from '@macuxi/platform-sdk/web';
import { cx, ErrorBlock, IconChevronRight, IconLogout, LoadingBlock, rotuloDoPerfil } from '@macuxi/ui/web';
import { criarAmbienteWeb } from '@/lib/ambiente';
import { aoPerfilSemBko, guardarAvisoDoLogin, mensagemSemBko } from '@/lib/ciclo-senha';
import { estadoDaSessao, estadoDoConteudo } from '@/lib/estado-shell';
import { PROPORCAO_LOGO_HORIZONTAL, SRC_LOGO_NEGATIVO_GRAFITE } from '@/lib/logo-marca';
import { ALTURA_ITEM, grupoDaTela, cabeTudoAberto, hrefAtivo, montarGruposMenu, type GrupoMenuBko, type ItemMenuBko } from '@/lib/menu-bko';
import { SHELL_WEB } from '@/lib/modulos';
import { qk, useMe, useModulosEfetivos } from '@/lib/queries';
import { aoSemFilial, ehUsuarioSemFilial } from '@/lib/sem-filial';
import { encerrarSessao, useSessao } from '@/lib/session';
import { CHAVE_MINHA_FILIAL, EscolherFilial } from './escolher-filial';
import { SessaoSemConexao } from './sessao-sem-conexao';

/** Largura do logo A a 28 px de altura (viewBox 514,41 × 110,85 → ≈ 130 px). */
const ALTURA_LOGO = 28;
const LARGURA_LOGO = Math.round(ALTURA_LOGO * PROPORCAO_LOGO_HORIZONTAL);

// foco branco no grafite (o Azul noite do outline-accent some no grafite, 1,29:1; T-0172); por dentro, para a lista
// com rolagem (abaixo de 640 px de altura) não cortar o contorno
const FOCO = 'focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-white';

/**
 * Item do menu. `lateral` (padrão): 32 px, com recuo sob o título do grupo (`recuo=false` no painel ao lado); tela atual
 * com a barra de 3 px em Sol claro à esquerda (§M3 item 4). `compact`: chip da faixa de rolagem da tela estreita.
 */
function NavLink({ item, active, variante = 'lateral', recuo = true, onNavegar }: { item: ItemMenuBko; active: boolean; variante?: 'lateral' | 'compact'; recuo?: boolean; onNavegar?: () => void }) {
  const lateral = variante === 'lateral';
  return (
    <Link
      href={item.href}
      data-testid={item.testId}
      aria-current={active ? 'page' : undefined}
      onClick={onNavegar}
      className={cx(
        'flex shrink-0 items-center rounded-lg whitespace-nowrap no-underline transition-colors',
        FOCO,
        lateral ? cx('relative h-8 pr-2.5 text-[14px]', recuo ? 'pl-5' : 'pl-2.5') : 'h-9 px-3 text-[13px]',
        active ? 'bg-nav-active font-semibold text-white' : 'text-nav-text hover:bg-nav-active hover:text-white',
        active && lateral && "before:absolute before:top-2 before:bottom-2 before:left-2 before:w-[3px] before:rounded-sm before:bg-nav-grupo before:content-['']",
      )}
    >
      {item.label}
    </Link>
  );
}

/**
 * Logo A (MC-0056) no grafite e, abaixo, o nome da distribuidora fora da área de proteção (manual §2.3: margem igual à
 * altura do "M", ≈ 17,4 px a 28 px de altura → 18 px).
 */
function Brand({ company }: { company: string }) {
  return (
    <div className="flex min-w-0 flex-col items-start">
      <img src={SRC_LOGO_NEGATIVO_GRAFITE} alt="Macuxi Força de Vendas" width={LARGURA_LOGO} height={ALTURA_LOGO} className="block h-7 w-auto shrink-0" />
      {company && <span className="mt-[18px] max-w-full truncate text-[12px] leading-4 text-nav-text">{company}</span>}
    </div>
  );
}

const TITULO_GRUPO = 'text-[11.5px] font-semibold tracking-[0.07em] text-nav-grupo uppercase';

interface Painel {
  grupo: string;
  top: number;
  left: number;
}

/**
 * Lista do menu lateral (§M3): mede a própria altura (flex-1 entre a marca e o rodapé). Tudo cabe → tudo aberto, títulos
 * sem seta e sem clique. Não cabe → sanfona: só o grupo da tela atual aberto; ponteiro ou foco de teclado num grupo
 * fechado abre o painel ao lado (fixed, fora do overflow da lista); clique no título troca o grupo aberto.
 */
function MenuLateral({ grupos, ativo }: { grupos: GrupoMenuBko[]; ativo: string | null }) {
  const listaRef = useRef<HTMLDivElement>(null);
  const [disponivel, setDisponivel] = useState<number | null>(null);
  useLayoutEffect(() => {
    const el = listaRef.current;
    if (!el) return;
    const medir = () => setDisponivel(el.clientHeight);
    medir();
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(medir);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const tudoAberto = disponivel !== null && cabeTudoAberto(grupos, disponivel);

  // a sanfona acompanha a tela: ao abrir uma tela de outro grupo, o grupo dela abre e o anterior fecha
  const grupoAtual = grupoDaTela(grupos, ativo);
  const [aberto, setAberto] = useState<string | null>(grupoAtual);
  const [grupoVisto, setGrupoVisto] = useState<string | null>(grupoAtual);
  if (grupoVisto !== grupoAtual) {
    setGrupoVisto(grupoAtual);
    setAberto(grupoAtual);
  }

  const [painel, setPainel] = useState<Painel | null>(null);
  const fechar = useRef<ReturnType<typeof setTimeout> | null>(null);
  const cancelarFechar = () => {
    if (fechar.current) clearTimeout(fechar.current);
    fechar.current = null;
  };
  const fecharPainel = () => {
    cancelarFechar();
    setPainel(null);
  };
  const abrirPainel = (grupo: GrupoMenuBko, titulo: HTMLElement) => {
    cancelarFechar();
    const r = titulo.getBoundingClientRect();
    const menu = titulo.closest('nav')?.getBoundingClientRect();
    const altura = grupo.itens.length * ALTURA_ITEM + 18;
    setPainel({ grupo: grupo.id, top: Math.max(8, Math.min(r.top - 6, window.innerHeight - altura - 8)), left: (menu?.right ?? r.right) - 2 });
  };

  // Esc ou clique fora fecham o painel
  useEffect(() => {
    if (!painel) return;
    const tecla = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPainel(null);
    };
    const clique = (e: PointerEvent) => {
      if (!(e.target instanceof Element) || !e.target.closest(`[data-menu-grupo="${painel.grupo}"]`)) setPainel(null);
    };
    document.addEventListener('keydown', tecla);
    document.addEventListener('pointerdown', clique);
    return () => {
      document.removeEventListener('keydown', tecla);
      document.removeEventListener('pointerdown', clique);
    };
  }, [painel]);
  useEffect(() => cancelarFechar, []);

  return (
    <div ref={listaRef} className="-mx-1 flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-1">
      {grupos.map((g) => {
        const estaAberto = tudoAberto || aberto === g.id;
        const comPainel = !estaAberto && painel?.grupo === g.id;
        const titulo = (e: { currentTarget: HTMLElement }) => e.currentTarget.querySelector<HTMLElement>('[data-menu-titulo]');
        return (
          <div
            key={g.id}
            data-menu-grupo={g.id}
            className="flex shrink-0 flex-col"
            onMouseEnter={(e: MouseEvent<HTMLDivElement>) => {
              const t = titulo(e);
              if (!estaAberto && t) abrirPainel(g, t);
            }}
            onMouseLeave={() => {
              if (!comPainel) return;
              cancelarFechar();
              fechar.current = setTimeout(() => setPainel(null), 150);
            }}
            onBlur={(e: FocusEvent<HTMLDivElement>) => {
              if (comPainel && !e.currentTarget.contains(e.relatedTarget as Node | null)) setPainel(null);
            }}
          >
            {tudoAberto ? (
              <span data-menu-titulo="" className={cx('flex h-[30px] shrink-0 items-center px-2.5', TITULO_GRUPO)}>
                {g.titulo}
              </span>
            ) : (
              <button
                type="button"
                data-menu-titulo=""
                aria-expanded={estaAberto}
                aria-controls={`menu-grupo-${g.id}`}
                onClick={() => {
                  fecharPainel();
                  setAberto(estaAberto ? null : g.id);
                }}
                onFocus={(e) => {
                  if (!estaAberto && e.currentTarget.matches(':focus-visible')) abrirPainel(g, e.currentTarget);
                }}
                className={cx('flex h-[30px] w-full shrink-0 items-center justify-between rounded-lg px-2.5 text-left transition-colors hover:bg-nav-active', TITULO_GRUPO, FOCO, comPainel && 'bg-nav-active')}
              >
                {g.titulo}
                <IconChevronRight size={14} strokeWidth={2.2} className={cx('shrink-0 transition-transform', estaAberto && 'rotate-90')} />
              </button>
            )}
            {estaAberto && (
              <div id={`menu-grupo-${g.id}`} className="flex flex-col">
                {g.itens.map((item) => (
                  <NavLink key={item.href} item={item} active={item.href === ativo} />
                ))}
              </div>
            )}
            {comPainel && (
              <div
                aria-label={g.titulo}
                role="group"
                style={{ top: painel.top, left: painel.left }}
                className="fixed z-50 flex w-[250px] flex-col rounded-[10px] border border-nav-active bg-ink px-1.5 py-2 shadow-[0_8px_24px_rgba(22,32,42,0.35)]"
              >
                {g.itens.map((item) => (
                  <NavLink key={item.href} item={item} active={item.href === ativo} recuo={false} onNavegar={fecharPainel} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Tela estreita: seletor do grupo e a faixa lateral só com os itens dele (padrão: o grupo da tela atual; §M3 item 5). */
function MenuEstreito({ grupos, ativo }: { grupos: GrupoMenuBko[]; ativo: string | null }) {
  const grupoAtual = grupoDaTela(grupos, ativo);
  const [escolhido, setEscolhido] = useState<string | null>(grupoAtual);
  const [grupoVisto, setGrupoVisto] = useState<string | null>(grupoAtual);
  if (grupoVisto !== grupoAtual) {
    setGrupoVisto(grupoAtual);
    setEscolhido(grupoAtual);
  }
  const grupo = grupos.find((g) => g.id === escolhido) ?? grupos[0];
  if (!grupo) return null;
  return (
    <div className="flex items-center gap-2">
      <select
        aria-label="Grupo do menu"
        value={grupo.id}
        onChange={(e) => setEscolhido(e.target.value)}
        className={cx('h-9 max-w-[45%] shrink-0 rounded-lg border border-nav-active bg-ink px-2', TITULO_GRUPO, FOCO)}
      >
        {grupos.map((g) => (
          <option key={g.id} value={g.id}>
            {g.titulo}
          </option>
        ))}
      </select>
      <div className="-mr-4 flex min-w-0 flex-1 gap-1 overflow-x-auto pr-4 pb-1">
        {grupo.itens.map((i) => (
          <NavLink key={i.href} item={i} active={i.href === ativo} variante="compact" />
        ))}
      </div>
    </div>
  );
}

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSessao();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const me = useMe();
  const perfil = session.user?.perfil ?? null;
  const modulos = useModulosEfetivos(perfil);

  // T-0117 (G2): só `anonymous` (401/423 ou sem usuário) vai ao login; `sem_conexao` fica na aba com o aviso
  const estadoSessao = estadoDaSessao(session.status);
  useEffect(() => {
    if (estadoSessao === 'ir_ao_login') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [estadoSessao, router, pathname]);

  // menu: só o Core enquanto `/v1/me/modulos` carrega; o miolo (páginas, que decidem 404) espera os efetivos (D-B30)
  const visao = useMemo(() => SHELL_WEB.montar({ perfil, modulosAtivos: modulos.data ?? ['core'] }), [perfil, modulos.data]);
  const usuario = session.user;
  const ambiente = useMemo(() => criarAmbienteWeb(() => (usuario ? { id: usuario.id, nome: usuario.name, perfil: usuario.perfil } : null)), [usuario]);

  const switchProfile = () => {
    void encerrarSessao();
    qc.clear();
    router.replace('/login');
  };

  // RN-CORE-33: perfil sem backoffice durante o uso (403 PERFIL_SEM_BKO): sai e mostra o motivo no Entrar
  useEffect(
    () =>
      aoPerfilSemBko(() => {
        guardarAvisoDoLogin(mensagemSemBko(perfil));
        void encerrarSessao();
        qc.clear();
        router.replace('/login');
      }),
    [perfil, qc, router],
  );

  // T-0176: 403 USUARIO_SEM_FILIAL numa página (o dos módulos efetivos o shell lê direto da consulta)
  const [semFilialNaPagina, setSemFilialNaPagina] = useState(false);
  useEffect(() => aoSemFilial(() => setSemFilialNaPagina(true)), []);
  // T-0176 (spec §5, 16e): filial salva = some a tela, os módulos efetivos são relidos e o BKO entra no Início, com o menu
  const filialSalva = useCallback(() => {
    setSemFilialNaPagina(false);
    qc.removeQueries({ queryKey: CHAVE_MINHA_FILIAL });
    void qc.resetQueries({ queryKey: qk.modulos });
    router.replace('/');
  }, [qc, router]);

  if (session.status === 'sem_conexao') return <SessaoSemConexao aviso={session.aviso} onTentar={() => void tentarRestaurarSessao()} />;
  if (session.status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground">
        <LoadingBlock label={estadoSessao === 'ir_ao_login' ? 'Indo para o login…' : 'Carregando…'} />
      </div>
    );
  }

  // API real: empresa do login (Core); demonstração: `GET /me` do mock-api
  const company = MODO_API === 'demo' ? (me.data?.tenant.name ?? '') : (session.user?.empresa ?? '');
  const user = session.user;
  // RD-0014: nome curto do perfil, o mesmo do login, do portal e do app (kit)
  const roleLabel = perfil ? rotuloDoPerfil(perfil) : '';
  const grupos = montarGruposMenu({
    navegacao: visao.navegacao,
    mais: visao.extensoes<ItemMenu>('menu.itens').map((i) => i.payload),
    plataforma: entraEm('bko', perfil),
  });
  const ativo = hrefAtivo(pathname, grupos.flatMap((g) => g.itens.map((i) => i.href)));
  const conteudo = estadoDoConteudo({
    erroMe: MODO_API === 'demo' && me.isError,
    perfilUsaWeb: entraEm('bko', perfil),
    modulos,
    semFilial: semFilialNaPagina || ehUsuarioSemFilial(modulos.error),
  });

  // T-0176 (spec §5): sem filial de cadastro, o BKO abre só a "Escolha a sua filial" (moldura do login, sem menu)
  if (conteudo === 'sem_filial') return <EscolherFilial onSalvo={filialSalva} onSair={switchProfile} />;

  return (
    <div className="flex min-h-screen flex-col bg-ground md:flex-row">
      {/* menu lateral (desktop): a lista ocupa o espaço entre a marca e o rodapé; o menu em si não rola */}
      <nav aria-label="Menu do backoffice" data-testid="menu-bko" className="sticky top-0 hidden h-screen w-[240px] shrink-0 flex-col bg-ink px-3 pt-3.5 pb-3 text-white md:flex">
        <div className="shrink-0 px-2 pb-3">
          <Brand company={company} />
        </div>
        <MenuLateral grupos={grupos} ativo={ativo} />
        <div className="mt-1 flex shrink-0 flex-col gap-0.5 border-t border-nav-active px-2 pt-3">
          <div className="flex flex-col">
            <span className="truncate text-[14px] leading-5 font-semibold">{user?.name ?? '—'}</span>
            <span className="text-[12px] leading-4 text-nav-text">{roleLabel}</span>
          </div>
          <button type="button" data-testid="trocar-perfil" onClick={switchProfile} className={cx('flex h-8 items-center gap-2 rounded-lg px-0 text-[13px] font-semibold text-nav-text hover:text-white', FOCO)}>
            <IconLogout size={15} />
            Trocar perfil
          </button>
        </div>
      </nav>

      {/* menu no topo (tela estreita) */}
      <nav aria-label="Menu do backoffice" className="flex flex-col gap-3 bg-ink px-4 pt-4 pb-3 text-white md:hidden">
        <div className="flex items-start justify-between gap-3">
          <Brand company={company} />
          <button type="button" onClick={switchProfile} className={cx('flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-nav-active px-3 text-[12px] font-semibold text-nav-text', FOCO)}>
            <IconLogout size={14} />
            Trocar perfil
          </button>
        </div>
        <MenuEstreito grupos={grupos} ativo={ativo} />
        <span className="text-[12px] text-nav-text">
          {user?.name} · {roleLabel}
        </span>
      </nav>

      <main className="flex min-w-0 flex-1 flex-col gap-5 px-4 pt-5 pb-10 md:px-8 md:pt-7">
        {conteudo === 'erro_me' ? (
          <ErrorBlock message={errorMessage(me.error)} onRetry={() => void me.refetch()} />
        ) : conteudo === 'perfil_fora_do_bko' ? (
          <SemBko perfil={perfil} />
        ) : conteudo === 'erro_modulos' ? (
          <ErrorBlock message={errorMessage(modulos.error)} onRetry={() => void modulos.refetch()} />
        ) : conteudo === 'carregando_modulos' ? (
          <div data-testid="shell-carregando-modulos">
            <LoadingBlock label="Carregando…" />
          </div>
        ) : (
          <ShellProvider visao={visao as VisaoShell<unknown>} ambiente={ambiente}>
            {children}
          </ShellProvider>
        )}
      </main>
    </div>
  );
}

/** Sessão de um perfil sem backoffice (ex.: aberta antes da RN-CORE-33): encerra e volta ao Entrar com o aviso do SDK. */
function SemBko({ perfil }: { perfil: Perfil | null }) {
  const router = useRouter();
  const qc = useQueryClient();
  useEffect(() => {
    guardarAvisoDoLogin(mensagemSemBko(perfil));
    void encerrarSessao();
    qc.clear();
    router.replace('/login');
  }, [perfil, qc, router]);
  return (
    <div data-testid="shell-sem-bko">
      <LoadingBlock label="Indo para o login…" />
    </div>
  );
}
