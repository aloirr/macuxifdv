/**
 * Check-in e checkout pelo aparelho (RF-CORE-06; RN-CORE-10/11/13/14). O estado local muda na hora (offline-first):
 * o comando entra na fila do motor (`visita`, id = id da visita; `visita_checkout`, id = UUID do comando) e a tela
 * recalcula das linhas ⊕ fila. A regra de raio/justificativa (`avaliarCheckin`) e as de checkout (contrato) rodam
 * aqui e de novo na API; um atendimento aberto por vez vem do domínio (`checkCheckin`). A foto da fachada
 * (RN-CORE-14) vai pela fila de arquivos, depois do comando que a referencia (ADR 0010).
 */
import type { MotorSync } from '@macuxi/platform-sdk';

import type { CustomerSummary } from '../../contracts';
import { checkCheckin, RAIO_CHECKIN_PADRAO_M } from '../../domain';
import type { ArmazemCore } from './estado';
import type { LocalVisit } from './route';
import { montarCheckin, montarCheckout, type EntradaCheckoutVisita, type PosicaoGps } from './visita-payload';

/**
 * Resultado do check-in: feito agora, já estava aberto neste cliente, bloqueado por outro atendimento aberto, ou
 * fora do raio e aguardando a justificativa (RN-CORE-10).
 */
export type CheckinResult =
  | { kind: 'created'; visit: LocalVisit; gps: boolean; foraDoRaio: boolean; sugereCoordenada: boolean }
  | { kind: 'existing'; visit: LocalVisit }
  | { kind: 'blocked'; open: LocalVisit }
  | { kind: 'justificar'; distancia_m: number; raio_m: number; posicao: PosicaoGps | null };

export interface CheckoutInput extends Omit<EntradaCheckoutVisita, 'id' | 'visita_id' | 'agora' | 'posicao'> {
  /** Rótulo do cliente para a tela de sync ("Foto da fachada · <cliente>"). */
  cliente?: string;
}

export interface ContextoAcao {
  motor: MotorSync;
  armazem: ArmazemCore;
  tz: string;
  vendedorId: string;
}

export interface OpcoesCheckin {
  /** Justificativa digitada depois do aviso de fora do raio. */
  justificativa?: string | null;
  /** Posição já obtida (a tela guarda a do 1º toque quando pede a justificativa). */
  posicao?: PosicaoGps | null;
  raio_m?: number;
}

export async function fazerCheckin(c: ContextoAcao, customer: CustomerSummary, routeStopId: string | null, op: OpcoesCheckin = {}): Promise<CheckinResult> {
  const check = checkCheckin(c.armazem.obter().visitas, c.vendedorId, customer.id, new Date(), c.tz);
  if (!check.ok) return { kind: 'blocked', open: check.open };
  if (check.existing) return { kind: 'existing', visit: check.existing };
  // RN-CORE-13: o GPS é lido uma vez, neste momento (nunca rastro); sem GPS o atendimento segue, marcado
  const posicao = op.posicao !== undefined ? op.posicao : await c.motor.ambiente.posicaoAgora();
  // a localização pode demorar: confere de novo antes de gravar
  const again = checkCheckin(c.armazem.obter().visitas, c.vendedorId, customer.id, new Date(), c.tz);
  if (!again.ok) return { kind: 'blocked', open: again.open };
  if (again.existing) return { kind: 'existing', visit: again.existing };
  const id = c.motor.ambiente.novoId();
  const feito = montarCheckin({
    id,
    cliente: { id: customer.id, lat: customer.lat, lng: customer.lng },
    rota_parada_id: routeStopId,
    agora: new Date(),
    posicao,
    raio_m: op.raio_m ?? c.armazem.obter().raioCheckinM ?? undefined,
    justificativa: op.justificativa,
    extra: routeStopId === null,
  });
  if (!feito.ok) return { kind: 'justificar', distancia_m: feito.avaliacao.distancia_m ?? 0, raio_m: op.raio_m ?? c.armazem.obter().raioCheckinM ?? RAIO_CHECKIN_PADRAO_M, posicao };
  // id do item = id da visita: reenviar o mesmo check-in é idempotente
  await c.motor.enfileirar({ id, entidade: 'visita', payload: feito.payload, rotulo: 'Check-in', detalhe: customer.trade_name });
  await c.armazem.carregar();
  // lê a visita ANTES de disparar o envio: a leitura não depende de tempo (D-3)
  const visit = c.armazem.obter().visitas.find((v) => v.id === id);
  if (!visit) throw new Error('Não foi possível registrar o check-in neste aparelho. Tente de novo.');
  void c.motor.enviar();
  return { kind: 'created', visit, gps: posicao !== null, foraDoRaio: feito.avaliacao.fora_do_raio, sugereCoordenada: feito.avaliacao.sugere_coordenada };
}

/** Aviso quando a gravação do check-in no aparelho falha (a folha fecha e o vendedor tenta de novo). */
export const MSG_FALHA_CHECKIN = 'Não foi possível registrar o check-in neste aparelho. Toque em Check-in para tentar de novo';

export type TentativaCheckin = CheckinResult | { kind: 'erro'; mensagem: string };

/** `fazerCheckin` que não deixa a tela presa: falha de gravação vira `{ kind: 'erro' }` para a tela fechar a folha e avisar. */
export async function tentarCheckin(c: ContextoAcao, customer: CustomerSummary, routeStopId: string | null, op: OpcoesCheckin = {}): Promise<TentativaCheckin> {
  try {
    return await fazerCheckin(c, customer, routeStopId, op);
  } catch {
    return { kind: 'erro', mensagem: MSG_FALHA_CHECKIN };
  }
}

/**
 * Checkout do atendimento: entra na fila (comando com id novo) e a tela mostra a visita fechada na hora. Cliente
 * fechado (RN-CORE-14): a foto da fachada entra na fila de arquivos DEPOIS do comando que a referencia.
 */
export async function fazerCheckout(c: ContextoAcao, visitId: string, input: CheckoutInput): Promise<LocalVisit | null> {
  const v = c.armazem.obter().visitas.find((x) => x.id === visitId);
  if (!v || v.checkout_at) return null;
  const comando = c.motor.ambiente.novoId();
  const { cliente, ...resto } = input;
  const posicao = await c.motor.ambiente.posicaoAgora();
  const payload = montarCheckout({ ...resto, id: comando, visita_id: visitId, agora: new Date(), posicao });
  await c.motor.enfileirar({
    id: comando,
    entidade: 'visita_checkout',
    payload,
    rotulo: input.resultado === 'cliente_fechado' ? 'Checkout · cliente fechado' : input.resultado === 'pedido' ? 'Checkout com pedido' : input.resultado === 'sem_pedido' ? 'Checkout sem pedido' : 'Checkout',
    detalhe: cliente ?? v.customer_name,
  });
  if (payload.foto_fachada_id) await c.motor.enfileirarArquivo({ id: payload.foto_fachada_id, modulo: 'core', rotulo: `Foto da fachada · ${cliente ?? v.customer_name}` });
  await c.armazem.carregar();
  const fechada = c.armazem.obter().visitas.find((x) => x.id === visitId) ?? null;
  void c.motor.enviar();
  return fechada;
}
