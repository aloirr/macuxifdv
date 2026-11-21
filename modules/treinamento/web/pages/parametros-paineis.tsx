'use client';

import { useParametros } from '@macuxi/platform-sdk/react';
import { formatarParametro, formatInt, ListaParametros, rotuloDoPerfil, valorComPadrao, type LinhaListaParametros } from '@macuxi/ui/web';
import { PARAMETROS_PADRAO as P, type ParametrosTreinamento } from '../../domain/parametros';
import { parametrosDoPainel } from '../lib/parametros-valor';

/** Só leitura (ADR 0058): o valor do tenant, com o padrão do contrato como reserva. Lista e "Padrão: X" do kit (RD-1583, RD-1584). */
type Params = Readonly<Record<string, unknown>>;

function linha<K extends keyof ParametrosTreinamento>(
  em: ParametrosTreinamento,
  rotulo: string,
  chave: K,
  formatar: (v: ParametrosTreinamento[K]) => string = (v) => String(v),
): LinhaListaParametros {
  return { rotulo, ...valorComPadrao(em[chave], P[chave], formatar) };
}

const { pct, min, dias } = formatarParametro;
const seg = formatarParametro.unidade('s');

export const linhasQuizLicao = (p: Params): readonly LinhaListaParametros[] => {
  const em = parametrosDoPainel(p);
  return [
  linha(em, 'Nota mínima', 'nota_minima_pct', pct),
  linha(em, 'Tentativas por dia', 'tentativas_max_dia', formatInt),
  linha(em, 'Intervalo entre tentativas', 'intervalo_min_tentativas_min', min),
  linha(em, 'Nota que vale', 'nota_que_vale', (v) => (v === 'melhor' ? 'A melhor' : 'A última')),
  linha(em, 'Tempo mínimo', 'segundos_minimos_licao', seg),
  linha(em, 'Parte da duração', 'pct_minimo_duracao_licao', pct),
  ];
};

export const linhasXp = (p: Params): readonly LinhaListaParametros[] => {
  const em = parametrosDoPainel(p);
  return [
  linha(em, 'Lição concluída', 'xp_licao', formatInt),
  linha(em, 'Acerto no quiz', 'xp_acerto_questao', formatInt),
  linha(em, 'Trilha concluída', 'xp_trilha', formatInt),
  linha(em, 'Sequência por dia', 'xp_streak_por_dia', formatInt),
  linha(em, 'Teto da sequência', 'xp_streak_teto', formatInt),
  linha(em, 'Teto diário', 'xp_teto_diario', formatInt),
  linha(em, 'Teto por desafio', 'xp_max_por_desafio', formatInt),
  ];
};

export const linhasNiveis = (p: Params): readonly LinhaListaParametros[] => {
  const em = parametrosDoPainel(p);
  return [
  linha(em, 'XP de cada nível', 'niveis_xp_min', (v) => v.map(formatInt).join(' · ')),
  linha(em, 'Medalha de sequência', 'streak_medalha_dias', dias),
  linha(em, 'Perfis no ranking', 'perfis_ranking', (v) => v.map((c) => rotuloDoPerfil(c, { forma: 'longo' })).join(', ')),
  ];
};

export const PainelQuizLicao = () => <ListaParametros testId="treinamento-quiz-licao" linhas={linhasQuizLicao(useParametros('treinamento'))} />;
export const PainelXp = () => <ListaParametros testId="treinamento-xp" linhas={linhasXp(useParametros('treinamento'))} />;
export const PainelNiveis = () => <ListaParametros testId="treinamento-niveis" linhas={linhasNiveis(useParametros('treinamento'))} />;
