'use client';

import Link from 'next/link';
import { PageHeader, Panel } from '@macuxi/ui/web';
import { useVisaoShell } from '@macuxi/platform-sdk/react';

/**
 * Início do BKO. Na Fase M "/" ia direto para o farol de pedidos; agora o shell lista as páginas
 * dos módulos efetivos do usuário (o farol de pedidos é página do Vendedor, registrada na B2).
 */
export default function Inicio() {
  const visao = useVisaoShell();
  // ADR 0060: item de módulo de vitrine sem licença (bloqueado) não abre: fica só no menu, com o cadeado
  const paginas = visao.navegacao.filter((n) => !n.bloqueado);
  return (
    <>
      <PageHeader eyebrow="Macuxi FDV" title="Backoffice" subtitle="Páginas dos módulos ativos para o seu perfil." />
      <Panel label="Páginas disponíveis">
        {paginas.length === 0 ? (
          <span className="text-[13px] text-ink-2" data-testid="inicio-sem-paginas">
            Nenhuma página de módulo registrada ainda (as telas de Core e Vendedor entram na Fase B2 da T-0001).
          </span>
        ) : (
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[15px] text-ink-3">
            {paginas.map((n) => (
              <li key={n.testID}>
                <Link href={`/${n.caminho}`} className="font-semibold text-accent-ink no-underline hover:underline">
                  {n.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </>
  );
}
