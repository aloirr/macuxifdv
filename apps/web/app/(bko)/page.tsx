'use client';

import Link from 'next/link';
import { EstadoVazio, PageHeader, Panel } from '@macuxi/ui/web';
import { useVisaoShell } from '@macuxi/platform-sdk/react';

/**
 * Início do BKO: as páginas dos módulos efetivos do usuário (o mesmo que o menu mostra), a 1 clique.
 * Revisão do BKO (docs/design/telas/bko-revisao.md §P1 e §P7): sem frase sob o título nem `eyebrow` (só serve ao caminho de
 * volta); sem página nenhuma, o vazio uma vez, sem quadro em volta e sem explicação do sistema.
 */
export default function Inicio() {
  const visao = useVisaoShell();
  return (
    <>
      <PageHeader title="Backoffice" />
      {visao.navegacao.length === 0 ? (
        <EstadoVazio testId="inicio-sem-paginas" titulo="Nenhuma página liberada para o seu perfil." />
      ) : (
        <Panel label="Páginas disponíveis">
          <ul className="m-0 flex list-disc flex-col gap-1.5 pl-5 text-[14px] text-ink-3">
            {visao.navegacao.map((n) => (
              <li key={n.testID}>
                <Link href={`/${n.caminho}`} className="font-semibold text-accent-ink no-underline hover:underline">
                  {n.rotulo}
                </Link>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </>
  );
}
