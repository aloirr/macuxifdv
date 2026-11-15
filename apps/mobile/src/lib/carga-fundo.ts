/**
 * ADR 0054 (solução 5, "trabalhar enquanto carrega"; desenho T-catalogo-pacote §2.2; R-20261115-070200): a carga inicial
 * que continua depois da entrada. Puro (roda em Node nos testes); quem usa é `app/(tabs)/_layout.tsx`.
 * - entrada liberada: `sincronizado_em` (carga completa) ou `liberado_em` (os essenciais terminaram). Motor sem a peça
 *   (`liberado_em` ausente): como antes, só `sincronizado_em` libera;
 * - indicador discreto (`IndicadorCargaFundo` do kit, docs/design/carga-em-segundo-plano.md) enquanto `pendentes` não está
 *   vazio: nome curto da etapa em carga, o percentual da carga (o mesmo número da tela de carga, que nunca volta) e "parado"
 *   sem sinal;
 * - retomada: app reaberto no meio (liberado, sem carga completa e nada rodando) volta a puxar o que falta.
 */
import { etapaQueLibera } from '@macuxi/core/app';
import type { EtapaEntrada, EtapaEntradaId, ProgressoEntrada } from '@macuxi/core/contracts';
import type { EstadoMotorSync } from '@macuxi/platform-sdk';

import { percentualDaCarga } from './carga';
import { erroDeSinal } from './entrada';

/**
 * Estado do motor com os campos da entrada enquanto carrega (ADR 0054), lidos por tipo estrutural: o SDK ainda não os
 * declara; sem eles (motor sem a peça) vêm ausentes e vale o comportamento de antes (só a carga completa libera).
 */
export type EstadoComCarga = EstadoMotorSync & { liberado_em?: string | null; pendentes?: readonly string[] };

type EstadoEntrada = Pick<EstadoComCarga, 'sincronizado_em' | 'liberado_em'>;

/** O usuário entra nas abas: carga completa gravada ou os essenciais da carga inicial feitos (ADR 0054). */
export function entradaLiberadaPeloMotor(estado: EstadoEntrada): boolean {
  return Boolean(estado.sincronizado_em || estado.liberado_em);
}

/** Ainda há carga inicial a terminar com o usuário dentro do app (`pendentes` do motor; ausente = motor sem a peça). */
export function cargaEmFundo(estado: Pick<EstadoComCarga, 'pendentes'>): boolean {
  return (estado.pendentes?.length ?? 0) > 0;
}

/**
 * App reaberto no meio da carga inicial: liberado, sem carga completa e nada rodando. O agendador do shell só sincroniza
 * depois de `sincronizado_em` e a tela de carga não abre mais, então as abas pedem a retomada (o motor pula o que já gravou).
 */
export function deveRetomarCarga(estado: Pick<EstadoComCarga, 'sincronizado_em' | 'liberado_em' | 'sincronizando'>): boolean {
  return Boolean(estado.liberado_em) && !estado.sincronizado_em && !estado.sincronizando;
}

/** Nome curto na linha do indicador (spec: "Catálogo 63%"); as demais etapas já têm nome curto. */
const NOME_CURTO: Partial<Record<EtapaEntradaId, string>> = { catalogo_precos: 'Catálogo' };

export interface IndicadorDaCarga {
  etapa: string;
  percentual: number;
  semSinal: boolean;
}

/**
 * Props do `IndicadorCargaFundo`, ou `null` sem carga em fundo. Etapa: a da entidade em curso (pela regra do Core, que nunca
 * volta); antes de a próxima começar (app reaberto, parado), a última etapa do perfil, que é a que segura o fim da carga
 * (RN-CORE-48 revista: Catálogo no Campo, Aprovações na Gestão).
 */
export function indicadorDaCargaFundo(
  estado: Pick<EstadoComCarga, 'pendentes' | 'sincronizando' | 'erro' | 'sincronizado_em' | 'progresso' | 'carga'>,
  progresso: Pick<ProgressoEntrada, 'atual' | 'etapas'>,
  perfil: string | null | undefined,
  offline: boolean,
): IndicadorDaCarga | null {
  if (!cargaEmFundo(estado)) return null;
  const ultima: EtapaEntrada | undefined = progresso.etapas.at(-1);
  // O envio e a etapa que libera (regra do Core) já estão feitos quando a entrada libera: o indicador não os nomeia.
  const jaFeita = progresso.atual.id === 'envio' || progresso.atual.id === etapaQueLibera(perfil);
  const etapa = jaFeita && ultima ? ultima : progresso.atual;
  return {
    etapa: NOME_CURTO[etapa.id] ?? etapa.nome,
    percentual: percentualDaCarga(estado, 'carregando'),
    semSinal: offline || (!estado.sincronizando && erroDeSinal(estado.erro, false)),
  };
}

/** Rota do detalhe da carga (a tela de carga, sem voltar sozinha às abas). */
export const ROTA_DETALHE_CARGA = '/sync?detalhe=1';
