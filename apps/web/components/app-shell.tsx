'use client';

/**
 * Layout do BKO (copiado de components/app-shell.tsx da Fase M). O menu deixou de ser fixo: vem do
 * registro dos módulos efetivos do usuário (lib/modulos.ts → `criarShell`), filtrado por perfil e por
 * permissão por ação (ADR 0004), mais as páginas da plataforma (Auditoria). Promotor e vendedor não
 * usam o BKO (Q6, doc 03). Cada item tem `data-testid` estável (`nav-<modulo>-<id>`). Itens do slot
 * `menu.itens` do Core (`ItemMenu`, modules/core/contracts/extensoes.ts) entram no grupo "Mais".
 * As páginas recebem o ambiente do navegador (`useHttp()`/`useAmbiente()` — lib/ambiente.ts).
 * RN-CORE-33 (T-0094; spec docs/design/ciclo-de-senha.md §1): perfil sem backoffice (a sessão cujo perfil não tem `acesso.bko`
 * no motor de permissões do SDK, `lib/acesso.ts`, ou o 403 `PERFIL_SEM_BKO` de qualquer chamada) encerra a sessão e volta ao
 * Entrar com o aviso. Nenhuma lista de perfis no shell: onde entra e o que aparece vêm do motor (ADR 0033).
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useMemo, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ItemMenu } from '@macuxi/core/contracts';
import { ROTULO_PERFIL, type Perfil, type VisaoShell } from '@macuxi/platform-sdk';
import { ShellProvider } from '@macuxi/platform-sdk/react';
import { errorMessage, MODO_API } from '@macuxi/platform-sdk/web';
import { cx, ErrorBlock, IconLogout, LoadingBlock } from '@macuxi/ui/web';
import { entraEm } from '@/lib/acesso';
import { criarAmbienteWeb } from '@/lib/ambiente';
import { aoPerfilSemBko, guardarAvisoDoLogin, mensagemSemBko } from '@/lib/ciclo-senha';
import { estadoDoConteudo } from '@/lib/estado-shell';
import { SHELL_WEB, type ComponentePagina } from '@/lib/modulos';
import { useMe, useModulosEfetivos } from '@/lib/queries';
import { encerrarSessao, useSessao } from '@/lib/session';

interface NavItem {
  href: string;
  label: string;
  testId: string;
}

/**
 * Páginas da própria plataforma (não são de módulo). RN-AUD-01: trilha de auditoria, para todo perfil que entra no BKO (a API
 * filtra as linhas pela licença dos módulos e pelo escopo do perfil).
 */
const PLATAFORMA: NavItem[] = [{ href: '/auditoria', label: 'Auditoria', testId: 'nav-plataforma-auditoria' }];

const ROTULO_GRUPO = { operacao: 'Operação', cadastros: 'Cadastros', analise: 'Análise', administracao: 'Administração' } as const;

function NavLink({ item, active, compact }: { item: NavItem; active: boolean; compact?: boolean }) {
  return (
    <Link
      href={item.href}
      data-testid={item.testId}
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex h-10 shrink-0 items-center justify-between gap-2 rounded-[10px] px-3 text-[14px] whitespace-nowrap no-underline transition-colors',
        active ? 'bg-nav-active font-semibold text-white' : 'text-nav-text hover:bg-nav-active/60 hover:text-white',
        compact && 'h-9 text-[13px]',
      )}
    >
      {item.label}
    </Link>
  );
}

function Brand({ product, company }: { product: string; company: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2.5">
      <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-[9px] bg-accent font-display text-[15px] font-extrabold text-on-accent">M</span>
      <div className="flex min-w-0 flex-col">
        <span className="truncate font-display text-[15px] font-bold text-white">{product}</span>
        <span className="truncate text-[12px] text-nav-text">{company}</span>
      </div>
    </div>
  );
}

/** Grupos do menu: itens dos módulos efetivos (por grupo) + plataforma. */
function gruposDoMenu(visao: VisaoShell<ComponentePagina>, perfil: Perfil | null): { titulo: string; itens: NavItem[] }[] {
  const grupos = new Map<string, NavItem[]>();
  for (const n of visao.navegacao) {
    const lista = grupos.get(n.grupo) ?? [];
    lista.push({ href: `/${n.caminho}`, label: n.rotulo, testId: n.testID });
    grupos.set(n.grupo, lista);
  }
  const saida: { titulo: string; itens: NavItem[] }[] = [...grupos].map(([g, itens]) => ({ titulo: ROTULO_GRUPO[g as keyof typeof ROTULO_GRUPO], itens }));
  const mais = visao.extensoes<ItemMenu>('menu.itens').map((i) => ({ href: `/${i.payload.caminho.replace(/^\/+/, '')}`, label: i.payload.rotulo, testId: i.payload.testID }));
  if (mais.length > 0) saida.push({ titulo: 'Mais', itens: mais });
  const plataforma = entraEm('bko', perfil) ? PLATAFORMA : [];
  if (plataforma.length > 0) saida.push({ titulo: 'Plataforma', itens: plataforma });
  return saida;
}

export function AppShell({ children }: { children: ReactNode }) {
  const session = useSessao();
  const router = useRouter();
  const pathname = usePathname();
  const qc = useQueryClient();
  const me = useMe();
  const perfil = session.user?.perfil ?? null;
  const modulos = useModulosEfetivos(perfil);

  useEffect(() => {
    if (session.status === 'anonymous') router.replace(`/login?next=${encodeURIComponent(pathname)}`);
  }, [session.status, router, pathname]);

  // menu: só o Core enquanto `/v1/me/modulos` carrega; o miolo (páginas, que decidem 404) espera os efetivos (D-B30)
  const visao = useMemo(() => SHELL_WEB.montar({ perfil, modulosAtivos: modulos.data ?? ['core'] }), [perfil, modulos.data]);
  const usuario = session.user;
  const ambiente = useMemo(() => criarAmbienteWeb(() => (usuario ? { id: usuario.id, nome: usuario.name, perfil: usuario.perfil } : null)), [usuario]);

  const switchProfile = () => {
    encerrarSessao();
    qc.clear();
    router.replace('/login');
  };

  // RN-CORE-33: perfil sem backoffice durante o uso (403 PERFIL_SEM_BKO): sai e mostra o motivo no Entrar
  useEffect(
    () =>
      aoPerfilSemBko(() => {
        guardarAvisoDoLogin(mensagemSemBko(perfil));
        encerrarSessao();
        qc.clear();
        router.replace('/login');
      }),
    [perfil, qc, router],
  );

  if (session.status !== 'authenticated') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground">
        <LoadingBlock label={session.status === 'anonymous' ? 'Indo para o login…' : 'Carregando…'} />
      </div>
    );
  }

  // API real: empresa do login (Core); demonstração: `GET /me` do mock-api
  const product = MODO_API === 'demo' ? (me.data?.tenant.product_name ?? '…') : 'Macuxi FDV';
  const company = MODO_API === 'demo' ? (me.data?.tenant.name ?? '') : (session.user?.empresa ?? '');
  const user = session.user;
  const roleLabel = perfil ? ROTULO_PERFIL[perfil] : '';
  const isActive = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const grupos = gruposDoMenu(visao, perfil);
  const todos = grupos.flatMap((g) => g.itens);
  const conteudo = estadoDoConteudo({ erroMe: MODO_API === 'demo' && me.isError, perfilUsaWeb: entraEm('bko', perfil), modulos });

  return (
    <div className="flex min-h-screen flex-col bg-ground md:flex-row">
      {/* menu lateral (desktop) */}
      <nav aria-label="Menu do backoffice" data-testid="menu-bko" className="sticky top-0 hidden h-screen w-[220px] shrink-0 flex-col gap-1 overflow-y-auto bg-ink px-3.5 py-6 text-white md:flex">
        <div className="px-2 pb-5">
          <Brand product={product} company={company} />
        </div>
        {grupos.map((g, i) => (
          <div key={g.titulo} className="flex flex-col gap-1">
            {i > 0 && <span className="px-3 pt-[18px] pb-1.5 text-[11px] font-semibold tracking-[0.06em] text-nav-muted uppercase">{g.titulo}</span>}
            {g.itens.map((item) => (
              <NavLink key={item.href} item={item} active={isActive(item.href)} />
            ))}
          </div>
        ))}
        <div className="mt-auto flex flex-col gap-2 border-t border-nav-active px-2 pt-4">
          <div className="flex flex-col">
            <span className="truncate text-[14px] font-semibold">{user?.name ?? '—'}</span>
            <span className="text-[12px] text-nav-text">{roleLabel}</span>
          </div>
          <button type="button" data-testid="trocar-perfil" onClick={switchProfile} className="flex h-9 items-center gap-2 rounded-[10px] px-0 text-[13px] font-semibold text-nav-text hover:text-white">
            <IconLogout size={15} />
            Trocar perfil
          </button>
        </div>
      </nav>

      {/* menu no topo (tela estreita) */}
      <nav aria-label="Menu do backoffice" className="flex flex-col gap-3 bg-ink px-4 pt-4 pb-3 text-white md:hidden">
        <div className="flex items-center justify-between gap-3">
          <Brand product={product} company={company} />
          <button type="button" onClick={switchProfile} className="flex h-10 shrink-0 items-center gap-1.5 rounded-[10px] border border-nav-active px-3 text-[12px] font-semibold text-nav-text">
            <IconLogout size={14} />
            Trocar perfil
          </button>
        </div>
        <div className="-mx-4 flex gap-1 overflow-x-auto px-4 pb-1">
          {todos.map((i) => (
            <NavLink key={i.href} item={i} active={isActive(i.href)} compact />
          ))}
        </div>
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
    encerrarSessao();
    qc.clear();
    router.replace('/login');
  }, [perfil, qc, router]);
  return (
    <div data-testid="shell-sem-bko">
      <LoadingBlock label="Indo para o login…" />
    </div>
  );
}
