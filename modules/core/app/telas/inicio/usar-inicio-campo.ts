/**
 * Hook do Início do Campo (T-0170). Tudo do aparelho (offline-first): a Performance de "Este mês" (as mesmas funções do domain
 * dos 4 cards e dos 6 indicadores), a frase do dia (entidade `frase_dia` do pull quando existir; senão as 30 padrão) e a
 * contagem do sino (recados e tarefas novos). Nenhum timer (RN-CORE-23): recalcula quando um sync termina ou a fila muda.
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';

import { dataLocal, saudacaoDoDia } from '../../../domain';
import type { AvatarGravado } from '../../../domain/frase-avatar/avatar';
import type { FraseDoRodizio } from '../../../domain/frase-avatar/frase-do-dia';
import { useCore } from '../../lib/usar-core';
import { intervaloDaSelecao, SELECAO_PADRAO } from '../performance/periodo-performance';
import { usePerformance } from '../performance/usar-performance';
import { useRecadosETarefas } from '../recados-e-tarefas/usar-recados-e-tarefas';
import {
  cardsDeMetasDoMes,
  contarSino,
  fraseDoPainel,
  indicadoresDoInicio,
  linhaDaData,
  textoUltimaSincronizacao,
  type CardMetaInicio,
  type ContagemSino,
  type IndicadorInicio,
} from './inicio-campo';
import { saudacaoComNome } from '../../../domain/nome';
import { ENTIDADE_USUARIO_AVATAR, fotoDoPerfil } from './foto-perfil';

/** Entidade do pull das frases do tenant (`core.frase_dia`); até ser registrada na costura o aparelho usa as 30 padrão. */
export const ENTIDADE_FRASE_DIA = 'frase_dia';

export interface VisaoInicioCampo {
  /** "Quinta, 12 de novembro · DU 9 de 20" */
  data: string;
  /** "Boa tarde, Lucas" */
  saudacao: string;
  /** A frase do dia; null = a linha não aparece. */
  frase: string | null;
  /** Nome completo, para as iniciais do avatar. */
  nome: string;
  /** Foto do perfil (URI); ausente ou null = as iniciais ocupam o mesmo tamanho. */
  foto?: string | null;
  metas: CardMetaInicio[];
  produtividade: IndicadorInicio[];
  /** Para o shell desenhar o sino. */
  sino: ContagemSino;
  /** "Últ. sincronização 20:22"; null se nunca sincronizou. */
  ultimaSincronizacao: string | null;
}

export function useInicioCampo(): VisaoInicioCampo | null {
  const { motor, estado } = useMotorSync();
  const core = useCore();
  const fuso = core.tz;
  const hoje = dataLocal(new Date(), fuso);
  const intervalo = useMemo(() => intervaloDaSelecao(SELECAO_PADRAO, hoje), [hoje]);
  const perf = usePerformance(intervalo, { fuso, hoje });
  const recados = useRecadosETarefas();
  const [frases, setFrases] = useState<FraseDoRodizio[] | null>(null);
  const [foto, setFoto] = useState<string | null>(null);

  useEffect(() => {
    if (!motor) return;
    let ativo = true;
    void motor
      .linhas<FraseDoRodizio & { updated_at: string; deleted_at: string | null }>(ENTIDADE_FRASE_DIA)
      .then((l) => ativo && setFrases(l))
      .catch(() => ativo && setFrases(null));
    return () => {
      ativo = false;
    };
  }, [motor, estado.sincronizado_em]);

  const v = perf.visao;
  const usuario = motor?.ambiente.usuario() ?? null;
  const usuarioId = usuario?.id ?? null;

  // RN-CORE-42: foto do perfil = escolha viva em `usuario_avatar` + arquivo no aparelho; sem ela, iniciais.
  useEffect(() => {
    if (!motor || !usuarioId) return;
    let ativo = true;
    void motor
      .linhas<Omit<AvatarGravado, 'deleted_at'> & { updated_at: string; deleted_at: string | null }>(ENTIDADE_USUARIO_AVATAR)
      .then((l) => fotoDoPerfil(l, usuarioId))
      .catch(() => null)
      .then((uri) => ativo && setFoto(uri));
    return () => {
      ativo = false;
    };
  }, [motor, usuarioId, estado.sincronizado_em]);

  return useMemo(() => {
    if (!v || !usuario) return null;
    return {
      data: linhaDaData(hoje, v.calendario),
      saudacao: saudacaoComNome(saudacaoDoDia(new Date(), fuso), usuario.nome),
      frase: fraseDoPainel(frases, hoje),
      nome: usuario.nome,
      foto,
      metas: cardsDeMetasDoMes(v.resultados, { tipoMetaVenda: v.tipoMetaVenda, perfil: perf.perfil }),
      produtividade: indicadoresDoInicio(v.produtividade),
      sino: contarSino(recados.itens),
      ultimaSincronizacao: textoUltimaSincronizacao(estado.sincronizado_em, fuso),
    };
  }, [v, usuario?.id, usuario?.nome, hoje, fuso, frases, foto, perf.perfil, recados.itens, estado.sincronizado_em]);
}
