/**
 * Etapa de carga do Gestor no sync do motor da plataforma (RN-CORE-23: é a ÚNICA via de atualização das telas; roda no
 * ritmo do shell — sync_auto_min, ao abrir e ao voltar ao primeiro plano — e no "puxar para baixo"), só com o módulo efetivo:
 * visão da equipe, fila de aprovação e alertas vão para o cache do módulo. Sem sinal ou API sem o Gestor (403/404):
 * a etapa não derruba a sincronização e o aparelho segue com o que tinha (offline-first).
 */
import type { EtapaSync } from '@macuxi/platform-sdk';
import { atualizarCache, criarCache } from './lib/cache';

export const etapaGestor: EtapaSync = {
  id: 'gestor-equipe',
  rotulo: 'Painel da equipe',
  modulo: 'gestor',
  async executar(ctx) {
    const r = await atualizarCache(ctx.http, criarCache(ctx.armazenamento), ctx.agora);
    if (r.semConexao) return; // o motor já trata a falta de sinal; o cache fica como está
  },
};

export const etapasGestor: readonly EtapaSync[] = [etapaGestor];
