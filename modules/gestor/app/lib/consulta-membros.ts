/**
 * Consulta `gestor.membros_da_equipe@1` no aparelho (ADR 0012; RN-VEN-35, RN-CORE-04): lê a visão da equipe do cache do
 * módulo (sem rede) e converte pela função pura do domain. O contexto da consulta não expõe o armazenamento do módulo, então
 * a etapa de sync e o hook das telas registram aqui o armazenamento (`registrarArmazenamentoGestor`); sem registro ou sem cache, lista vazia.
 */
import { implementarConsultaAparelho, type ArmazenamentoSync } from '@macuxi/platform-sdk';
import { CONSULTA_MEMBROS_DA_EQUIPE } from '../../contracts';
import { membrosDaEquipeDaVisao } from '../../domain/membros-da-equipe';
import { criarCache } from './cache';

let armazenamento: ArmazenamentoSync | null = null;

export function registrarArmazenamentoGestor(arm: ArmazenamentoSync | null): void {
  armazenamento = arm;
}

export const consultaMembrosDaEquipeAparelho = implementarConsultaAparelho(CONSULTA_MEMBROS_DA_EQUIPE, async (_entrada, ctx) => {
  const usuario = ctx.usuario();
  if (!armazenamento || !usuario) return { membros: [], equipes: [] };
  return membrosDaEquipeDaVisao(await criarCache(armazenamento).ler('visao'), usuario.id);
});
