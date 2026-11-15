'use client';

import type { ReactNode } from 'react';
import { useParametros } from '@macuxi/platform-sdk/react';
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
    <dl data-testid={testID} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-sm">
      {linhas.map((l) => (
        <div key={l.rotulo} className="contents">
          <dt>{l.rotulo}</dt>
          <dd className="text-right font-medium">
            {l.valor}
            {l.padrao ? <span className="ml-2 text-xs font-normal opacity-70">{l.padrao}</span> : null}
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

const pct = (n: number) => `${n}%`;
const min = (n: number) => `${n} min`;
const seg = (n: number) => `${n} s`;
const dias = (n: number) => `${n} dias`;

export const linhasQuizLicao = (p: Params): readonly Linha[] => [
  linha(p, 'Nota mínima', 'nota_minima_pct', pct),
  linha(p, 'Tentativas por dia', 'tentativas_max_dia'),
  linha(p, 'Intervalo entre tentativas', 'intervalo_min_tentativas_min', min),
  linha(p, 'Nota que vale', 'nota_que_vale', (v) => (v === 'melhor' ? 'A melhor' : 'A última')),
  linha(p, 'Tempo mínimo na lição', 'segundos_minimos_licao', seg),
  linha(p, 'Parte da duração da lição', 'pct_minimo_duracao_licao', pct),
];

export const linhasXp = (p: Params): readonly Linha[] => [
  linha(p, 'Lição concluída', 'xp_licao'),
  linha(p, 'Acerto no quiz', 'xp_acerto_questao'),
  linha(p, 'Trilha concluída', 'xp_trilha'),
  linha(p, 'Sequência, por dia', 'xp_streak_por_dia'),
  linha(p, 'Sequência, teto', 'xp_streak_teto'),
  linha(p, 'Teto por dia', 'xp_teto_diario'),
  linha(p, 'Teto por desafio', 'xp_max_por_desafio'),
];

export const linhasNiveis = (p: Params): readonly Linha[] => [
  linha(p, 'XP de cada nível', 'niveis_xp_min', (v) => v.join(' · ')),
  linha(p, 'Medalha de sequência', 'streak_medalha_dias', dias),
  linha(p, 'Perfis no ranking', 'perfis_ranking', (v) => v.join(', ')),
];

export const PainelQuizLicao = () => <Lista testID="treinamento-quiz-licao" linhas={linhasQuizLicao(useParametros('treinamento'))} />;
export const PainelXp = () => <Lista testID="treinamento-xp" linhas={linhasXp(useParametros('treinamento'))} />;
export const PainelNiveis = () => <Lista testID="treinamento-niveis" linhas={linhasNiveis(useParametros('treinamento'))} />;
