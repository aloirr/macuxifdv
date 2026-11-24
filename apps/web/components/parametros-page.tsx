'use client';

/**
 * Página Parâmetros do BKO (ADR 0060; spec docs/design/menu-parametros/spec.md §2–§3, simulações 02 e 07): título
 * "Parâmetros" e os painéis da seção empilhados na largura toda, cada um com a âncora `<modulo>-<id>` (links antigos:
 * `visao.destinoParametros`). A escolha da seção fica só no menu (grupo Parâmetros, item ativo; R-20261110-093124).
 * - `origem: 'painel'`: o componente do módulo dentro de um `Panel` com o título do painel.
 * - `origem: 'pagina'` (transição): a página inteira do módulo como está, sem `Panel` nem título a mais.
 * - Seção bloqueada: pode ser escolhida; o lado direito mostra só o cadeado e "Contrate o módulo para usar" (sem balão).
 * Só exibição: a API revalida perfil, ação e licença em toda rota (RN-CORE-01).
 */
import { notFound, useRouter } from 'next/navigation';
import { useEffect, useMemo } from 'react';
import type { SecaoParametrosVisivel } from '@macuxi/platform-sdk';
import { useVisaoShell } from '@macuxi/platform-sdk/react';
import { IconLock, LoadingBlock, PageHeader, Panel } from '@macuxi/ui/web';
import { TEXTO_SEM_LICENCA } from '@/lib/menu-bko';
import type { ComponentePagina } from '@/lib/modulos';
import { secaoInicialParametros, secoesParametros } from '@/lib/parametros';

type Secao = SecaoParametrosVisivel<ComponentePagina>;

function ConteudoSecao({ secao }: { secao: Secao }) {
  if (secao.bloqueado) {
    return (
      <section
        data-testid="parametros-sem-licenca"
        className="flex min-w-0 flex-col items-center justify-center gap-2.5 rounded-2xl border border-line bg-surface px-4 py-14 text-center text-ink-3"
      >
        <IconLock size={28} strokeWidth={2.2} aria-hidden />
        <span className="text-[17px] font-semibold text-ink">{TEXTO_SEM_LICENCA}</span>
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
  const secoes = useMemo(() => secoesParametros(visao), [visao]);
  const inicial = secaoInicialParametros(secoes);
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
  const atual = secoes.find((s) => s.secao === pedida);
  if (!atual) notFound();
  return (
    <div data-testid="pagina-parametros" className="contents">
      <PageHeader title="Parâmetros" />
      <div data-testid={`parametros-conteudo-${atual.secao}`} className="flex min-w-0 flex-col gap-5">
        <ConteudoSecao secao={atual} />
      </div>
    </div>
  );
}
