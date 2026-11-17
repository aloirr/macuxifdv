/**
 * Etapas pendentes da visita no BKO (T-0039; RN-CORE-12; docs/design/checkout-pendencia.md §3, docs/desenho/T-0039.md §2.5a):
 * funções puras sem React e sem rede. O formato abaixo estende `VisitaBko` com os campos da tolerância
 * (`etapas_pendentes`, detalhe de `etapas`) enquanto o contrato do Core não os traz; campos ausentes valem 0 / vazio.
 */
import { z } from 'zod';
import { VisitaBkoSchema } from '../../contracts';

export const EtapaVisitaBkoSchema = z.object({
  modulo: z.string(),
  etapa: z.string(),
  situacao: z.enum(['concluida', 'dispensada', 'pendente']),
  rotulo: z.string().nullish(),
  pendente_desde: z.string().nullish(),
  alertada_em: z.string().nullish(),
});
export type EtapaVisitaBko = z.infer<typeof EtapaVisitaBkoSchema>;

export const VisitaComEtapasSchema = VisitaBkoSchema.extend({
  etapas_pendentes: z.number().int().min(0).default(0),
  etapas: z.array(EtapaVisitaBkoSchema).default([]),
});
export type VisitaComEtapas = z.infer<typeof VisitaComEtapasSchema>;
export const VisitasComEtapasListaSchema = z.object({ itens: z.array(VisitaComEtapasSchema) });

/** Filtro "Etapas" da lista (URL `pendente=true|false`). */
export type FiltroEtapas = '' | 'true' | 'false';
export const filtroEtapasDaUrl = (v: string | null): FiltroEtapas => (v === 'true' || v === 'false' ? v : '');

export function filtrarPorEtapas<T extends { etapas_pendentes: number }>(itens: readonly T[], filtro: FiltroEtapas): T[] {
  if (filtro === 'true') return itens.filter((v) => v.etapas_pendentes > 0);
  if (filtro === 'false') return itens.filter((v) => v.etapas_pendentes === 0);
  return [...itens];
}

/** Texto do selo na coluna Sinais (§3.1): "Etapa pendente" ou "2 etapas pendentes". */
export const rotuloSeloEtapas = (n: number): string => (n === 1 ? 'Etapa pendente' : `${n} etapas pendentes`);

export const rotuloAcessivelSelo = (cliente: string): string => `Ver etapas da visita a ${cliente}`;

export const SITUACAO_ETAPA: Record<EtapaVisitaBko['situacao'], { rotulo: string; tom: 'success' | 'neutral' | 'warning' }> = {
  concluida: { rotulo: 'Concluída', tom: 'success' },
  dispensada: { rotulo: 'Dispensada', tom: 'neutral' },
  pendente: { rotulo: 'Pendente', tom: 'warning' },
};

export const TEXTO_VISITA_CONTA = 'A visita conta como concluída. A pendência some sozinha quando a resposta chegar';

/** Título do diálogo: `Etapas · <cliente> · dd/mm hh:mm do check-in` (fuso do tenant). */
export function tituloDialogoEtapas(cliente: string, checkinEm: string, fuso: string): string {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(new Date(checkinEm))
      .map((x) => [x.type, x.value]),
  );
  return `Etapas · ${cliente} · ${p.day}/${p.month} ${p.hour}:${p.minute}`;
}

/** Célula de data do diálogo: `—` quando não há. */
export function dataOuTraco(iso: string | null | undefined, fuso: string): string {
  return iso ? new Intl.DateTimeFormat('pt-BR', { timeZone: fuso, dateStyle: 'short', timeStyle: 'short' }).format(new Date(iso)) : '—';
}

export const temPendente = (etapas: readonly Pick<EtapaVisitaBko, 'situacao'>[]): boolean => etapas.some((e) => e.situacao === 'pendente');

/** Justificativa da dispensa manual: 3..300 caracteres, sem contar espaços nas pontas (desenho §2.5a). */
export const JUSTIFICATIVA_MIN = 3;
export const JUSTIFICATIVA_MAX = 300;
export const ERRO_JUSTIFICATIVA = `Escreva a justificativa com ${JUSTIFICATIVA_MIN} a ${JUSTIFICATIVA_MAX} caracteres`;
export function validarJustificativa(texto: string): { ok: true; valor: string } | { ok: false; erro: string } {
  const valor = texto.trim();
  return valor.length >= JUSTIFICATIVA_MIN && valor.length <= JUSTIFICATIVA_MAX ? { ok: true, valor } : { ok: false, erro: ERRO_JUSTIFICATIVA };
}

/** `POST /v1/core/visitas/:id/etapas/:modulo/:etapa/dispensa` (caminho relativo ao `/v1`). */
export const caminhoDispensa = (visitaId: string, modulo: string, etapa: string): string =>
  `/core/visitas/${encodeURIComponent(visitaId)}/etapas/${encodeURIComponent(modulo)}/${encodeURIComponent(etapa)}/dispensa`;

/** Parâmetro `checkout_pendencia_alerta_h` (§3.4): inteiro de 1 a 168. */
export const ALERTA_H_MIN = 1;
export const ALERTA_H_MAX = 168;
export const ALERTA_H_PADRAO = 24;
export const ERRO_ALERTA_H = 'Use um número de 1 a 168';
export const AJUDA_ALERTA_H = 'De 1 a 168. Depois desse prazo, o vendedor e o supervisor recebem um aviso.';
export function validarAlertaH(texto: string): { ok: true; valor: number } | { ok: false; erro: string } {
  const n = Number(texto);
  return texto.trim() !== '' && Number.isInteger(n) && n >= ALERTA_H_MIN && n <= ALERTA_H_MAX ? { ok: true, valor: n } : { ok: false, erro: ERRO_ALERTA_H };
}
