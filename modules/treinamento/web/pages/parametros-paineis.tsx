'use client';

import type { ReactNode } from 'react';
import { FAIXAS_NIVEL_PADRAO, PARAMETROS_PADRAO as P } from '../../domain/parametros';

/** Só leitura (ADR 0058): sem rota de leitura/gravação dos parâmetros do tenant, mostra o valor em uso = o padrão do contrato. */
interface Linha {
  rotulo: string;
  valor: ReactNode;
}

function Lista({ linhas, testID }: { linhas: readonly Linha[]; testID: string }) {
  return (
    <dl data-testid={testID} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-6 gap-y-2 text-sm">
      {linhas.map((l) => (
        <div key={l.rotulo} className="contents">
          <dt>{l.rotulo}</dt>
          <dd className="text-right font-medium">{l.valor}</dd>
        </div>
      ))}
    </dl>
  );
}

const unidade = (n: number, u: string) => `${n} ${u}`;

export const LINHAS_QUIZ_LICAO: readonly Linha[] = [
  { rotulo: 'Nota mínima', valor: `${P.nota_minima_pct}%` },
  { rotulo: 'Tentativas por dia', valor: P.tentativas_max_dia },
  { rotulo: 'Intervalo entre tentativas', valor: unidade(P.intervalo_min_tentativas_min, 'min') },
  { rotulo: 'Nota que vale', valor: P.nota_que_vale === 'melhor' ? 'A melhor' : 'A última' },
  { rotulo: 'Tempo mínimo na lição', valor: unidade(P.segundos_minimos_licao, 's') },
  { rotulo: 'Parte da duração da lição', valor: `${P.pct_minimo_duracao_licao}%` },
];

export const LINHAS_XP: readonly Linha[] = [
  { rotulo: 'Lição concluída', valor: P.xp_licao },
  { rotulo: 'Acerto no quiz', valor: P.xp_acerto_questao },
  { rotulo: 'Trilha concluída', valor: P.xp_trilha },
  { rotulo: 'Sequência, por dia', valor: P.xp_streak_por_dia },
  { rotulo: 'Sequência, teto', valor: P.xp_streak_teto },
  { rotulo: 'Teto por dia', valor: P.xp_teto_diario },
  { rotulo: 'Teto por desafio', valor: P.xp_max_por_desafio },
];

export const LINHAS_NIVEIS: readonly Linha[] = [
  { rotulo: 'XP de cada nível', valor: FAIXAS_NIVEL_PADRAO.join(' · ') },
  { rotulo: 'Medalha de sequência', valor: unidade(P.streak_medalha_dias, 'dias') },
  { rotulo: 'Perfis no ranking', valor: P.perfis_ranking.join(', ') },
];

export const PainelQuizLicao = () => <Lista testID="treinamento-quiz-licao" linhas={LINHAS_QUIZ_LICAO} />;
export const PainelXp = () => <Lista testID="treinamento-xp" linhas={LINHAS_XP} />;
export const PainelNiveis = () => <Lista testID="treinamento-niveis" linhas={LINHAS_NIVEIS} />;
