'use client';

/**
 * Rodapé legal das telas Entrar do BKO e do portal `config.` (docs/design/telas/rodape-legal.md §2; R-20261114-221000-alexandre):
 * `<footer>` centralizado, até três linhas (empresa, direitos, versão e site), 12/16 em `ink-2`; o site é link sublinhado em
 * `accent-ink`, abre em nova aba, com área de clique de 44 px sem mudar o desenho. Versão de `NEXT_PUBLIC_VERSAO` (build);
 * dados de `useDadosLegais` (rota pública). Pendência: a spec põe este componente no kit (`packages/ui/src/web`, designer-ux).
 */
import { cx } from '@macuxi/ui/web';

import { useDadosLegais } from '@/lib/dados-legais';
import { linhasDoRodapeLegal, type DadosDoRodape } from '@/lib/rodape-legal';

/** Desenho puro (testável): recebe os dados prontos. */
export function RodapeLegalVisual({ dados, versao, ano, className }: { dados: DadosDoRodape | null; versao: string | null | undefined; ano: number; className?: string }) {
  const l = linhasDoRodapeLegal({ dados, versao, ano });
  return (
    <footer data-testid="rodape-legal" className={cx('flex w-full max-w-[440px] flex-col items-center gap-0.5 text-center text-[12px] leading-4 text-ink-2', className)}>
      {l.empresa && (
        <p data-testid="rodape-legal.empresa" className="m-0" aria-label={l.empresa.leitor}>
          {l.empresa.razaoSocial && (
            <span>
              {l.empresa.razaoSocial}
              {l.empresa.cnpj ? ' · ' : ''}
            </span>
          )}
          {l.empresa.cnpj && <span className="whitespace-nowrap">{l.empresa.cnpj}</span>}
        </p>
      )}
      <p className="m-0" aria-label={l.direitos.leitor}>
        {l.direitos.texto}
      </p>
      <p className="m-0">
        {l.versao && `${l.versao} · `}
        <a
          data-testid="rodape-legal.site"
          href={l.url}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={`${l.site} (abre em nova aba)`}
          className="-my-[14px] inline-block py-[14px] font-semibold text-accent-ink underline underline-offset-2 focus-visible:outline-2 focus-visible:outline-accent"
        >
          {l.site}
        </a>
      </p>
    </footer>
  );
}

export function RodapeLegal({ className }: { className?: string }) {
  const dados = useDadosLegais();
  return <RodapeLegalVisual dados={dados} versao={process.env.NEXT_PUBLIC_VERSAO} ano={new Date().getFullYear()} className={className} />;
}
