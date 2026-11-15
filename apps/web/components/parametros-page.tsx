'use client';

/**
 * Página Parâmetros do BKO (ADR 0058; spec docs/design/menu-parametros/spec.md §2–§3, simulações 02 e 07): título
 * "Parâmetros", lista de seções à esquerda (200 px, na ordem de `visao.parametros`; selecionada em branco com a barra Azul
 * noite; módulo de vitrine sem licença em cinza com cadeado) e, à direita, os painéis da seção empilhados, cada um com a
 * âncora `<modulo>-<id>` (links antigos: `visao.destinoParametros`). O nome da seção não se repete no conteúdo.
 * - `origem: 'painel'`: o componente do módulo dentro de um `Panel` com o título do painel.
 * - `origem: 'pagina'` (transição): a página inteira do módulo como está, sem `Panel` nem título a mais.
 * - Seção bloqueada: pode ser escolhida; o lado direito mostra só o cadeado e "Contrate o módulo para usar" (sem balão).
 * Só exibição: a API revalida perfil, ação e licença em toda rota (RN-CORE-01).
 */
import Link from 'next/link';
import { notFound, useRouter } from 'next/navigation';
import { useEffect } from 'react';
import type { SecaoParametrosVisivel } from '@macuxi/platform-sdk';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { cx, IconLock, LoadingBlock, PageHeader, Panel } from '@macuxi/ui/web';
import { TEXTO_SEM_LICENCA } from '@/lib/menu-bko';
import type { ComponentePagina } from '@/lib/modulos';
import { secaoInicialParametros } from '@/lib/parametros';

const FOCO = 'focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent';

function ListaSecoes({ secoes, atual }: { secoes: readonly SecaoParametrosVisivel<ComponentePagina>[]; atual: string }) {
  return (
    <nav aria-label="Seções de Parâmetros" className="-mx-1 flex shrink-0 gap-0.5 overflow-x-auto px-1 pb-1 md:w-[200px] md:flex-col md:overflow-visible md:pb-0">
      {secoes.map((s) => {
        const ativo = s.secao === atual;
        return (
          <Link
            key={s.secao}
            href={`/${s.caminho}`}
            data-testid={`parametros-secao-${s.secao}`}
            data-bloqueado={s.bloqueado ? '' : undefined}
            aria-current={ativo ? 'page' : undefined}
            className={cx(
              'relative flex h-10 shrink-0 items-center justify-between gap-2 rounded-[10px] pr-3 pl-4 text-[14px] whitespace-nowrap no-underline transition-colors',
              FOCO,
              ativo
                ? "bg-surface font-semibold shadow-[0_0_0_1px_var(--color-line)] before:absolute before:top-2.5 before:bottom-2.5 before:left-1.5 before:w-[3px] before:rounded-sm before:bg-accent before:content-['']"
                : 'hover:bg-surface',
              s.bloqueado ? 'text-texto-apoio' : ativo ? 'text-ink' : 'text-ink-3',
            )}
          >
            {s.rotulo}
            {s.bloqueado && <IconLock size={14} strokeWidth={2.2} className="shrink-0" aria-hidden="true" />}
          </Link>
        );
      })}
    </nav>
  );
}

function ConteudoSecao({ secao }: { secao: SecaoParametrosVisivel<ComponentePagina> }) {
  if (secao.bloqueado) {
    return (
      <section
        data-testid="parametros-sem-licenca"
        className="flex min-w-0 flex-col items-center justify-center gap-2.5 rounded-2xl border border-line bg-surface px-4 py-14 text-center text-ink-3"
      >
        <IconLock size={28} strokeWidth={2.2} aria-hidden="true" />
        <span className="text-[16px] font-semibold text-ink">{TEXTO_SEM_LICENCA}</span>
      </section>
    );
  }
  return (
    <>
      {secao.paineis.map((p) => {
        const Componente = p.componente;
        return (
          <div key={p.ancora} id={p.ancora} data-testid={p.testID} className="flex min-w-0 scroll-mt-6 flex-col gap-5">
            {p.origem === 'painel' ? (
              <Panel title={p.titulo}>
                <Componente />
              </Panel>
            ) : (
              // transição: a página inteira, com o testID de página de sempre (`pagina-<modulo>-<id>`)
              <div data-testid={`pagina-${p.modulo}-${p.id}`} className="contents">
                <Componente />
              </div>
            )}
          </div>
        );
      })}
    </>
  );
}

export function PaginaParametros({ segmentos }: { segmentos: readonly string[] }) {
  const visao = useVisaoShell<ComponentePagina>();
  const router = useRouter();
  const inicial = secaoInicialParametros(visao.parametros);
  const pedida = segmentos[0];
  const destinoInicial = pedida === undefined && inicial ? `/${inicial.caminho}` : null;
  useEffect(() => {
    if (destinoInicial) router.replace(destinoInicial);
  }, [destinoInicial, router]);

  if (segmentos.length > 1) notFound();
  if (pedida === undefined) {
    if (!inicial) notFound();
    return <LoadingBlock label="Carregando…" />;
  }
  const atual = visao.parametros.find((s) => s.secao === pedida);
  if (!atual) notFound();
  return (
    <div data-testid="pagina-parametros" className="contents">
      <PageHeader title="Parâmetros" />
      <div className="flex min-w-0 flex-col gap-4 md:flex-row md:items-start md:gap-6">
        <ListaSecoes secoes={visao.parametros} atual={atual.secao} />
        <div data-testid={`parametros-conteudo-${atual.secao}`} className="flex min-w-0 flex-1 flex-col gap-5">
          <ConteudoSecao secao={atual} />
        </div>
      </div>
    </div>
  );
}
