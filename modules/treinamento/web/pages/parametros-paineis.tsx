'use client';

import type { ReactNode } from 'react';
import { useParametros } from '@macuxi/platform-sdk/react';
import { formatInt, rotuloDoPerfil } from '@macuxi/ui/web';
import { PARAMETROS_PADRAO as P, type ParametrosTreinamento } from '../../domain/parametros';
import { valorComPadrao, valorParametro } from '../lib/parametros-valor';

/** Só leitura (ADR 0058): mostra o valor do tenant (parâmetros do ambiente), com o padrão do contrato como reserva. */
interface Linha {
  rotulo: string;
  valor: ReactNode;
  padrao?: string | null;
}

function Lista({ linhas, testID }: { linhas: readonly Linha[]; testID: string }) {
  return (
    <dl data-testid={testID} className="m-0 grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-[15px]">
      {linhas.map((l) => (
        <div key={l.rotulo} className="contents">
          <dt className="font-semibold text-ink">{l.rotulo}</dt>
          <dd className="m-0 text-right tabular-nums">
            {l.valor}
            {l.padrao ? <span className="block text-[13px] text-ink-2">{l.padrao}</span> : null}
          </dd>
        </div>
      ))}
    </dl>
  );
}

type Params = Readonly<Record<string, unknown>>;

function linha<K extends keyof ParametrosTreinamento>(
  params: Params,
  rotulo: string,
  chave: K,
  formatar: (v: ParametrosTreinamento[K]) => string = (v) => String(v),
): Linha {
  const r = valorComPadrao(valorParametro(params, chave), P[chave], formatar);
  return { rotulo, valor: r.texto, padrao: r.padrao };
}

const pct = (n: number) => `${formatInt(n)}%`;
const min = (n: number) => `${formatInt(n)} min`;
const seg = (n: number) => `${formatInt(n)} s`;
const dias = (n: number) => `${formatInt(n)} dias`;

export const linhasQuizLicao = (p: Params): readonly Linha[] => [
  linha(p, 'Nota mínima', 'nota_minima_pct', pct),
  linha(p, 'Tentativas por dia', 'tentativas_max_dia', formatInt),
  linha(p, 'Intervalo entre tentativas', 'intervalo_min_tentativas_min', min),
  linha(p, 'Nota que vale', 'nota_que_vale', (v) => (v === 'melhor' ? 'A melhor' : 'A última')),
  linha(p, 'Tempo mínimo', 'segundos_minimos_licao', seg),
  linha(p, 'Parte da duração', 'pct_minimo_duracao_licao', pct),
];

export const linhasXp = (p: Params): readonly Linha[] => [
  linha(p, 'Lição concluída', 'xp_licao', formatInt),
  linha(p, 'Acerto no quiz', 'xp_acerto_questao', formatInt),
  linha(p, 'Trilha concluída', 'xp_trilha', formatInt),
  linha(p, 'Sequência por dia', 'xp_streak_por_dia', formatInt),
  linha(p, 'Teto da sequência', 'xp_streak_teto', formatInt),
  linha(p, 'Teto diário', 'xp_teto_diario', formatInt),
  linha(p, 'Teto por desafio', 'xp_max_por_desafio', formatInt),
];

export const linhasNiveis = (p: Params): readonly Linha[] => [
  linha(p, 'XP de cada nível', 'niveis_xp_min', (v) => v.map(formatInt).join(' · ')),
  linha(p, 'Medalha de sequência', 'streak_medalha_dias', dias),
  linha(p, 'Perfis no ranking', 'perfis_ranking', (v) => v.map((c) => rotuloDoPerfil(c, { forma: 'longo' })).join(', ')),
];

export const PainelQuizLicao = () => <Lista testID="treinamento-quiz-licao" linhas={linhasQuizLicao(useParametros('treinamento'))} />;
export const PainelXp = () => <Lista testID="treinamento-xp" linhas={linhasXp(useParametros('treinamento'))} />;
export const PainelNiveis = () => <Lista testID="treinamento-niveis" linhas={linhasNiveis(useParametros('treinamento'))} />;
