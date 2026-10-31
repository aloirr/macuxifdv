/**
 * Casos da fila de envio da Fase M (`apps/mobile/lib/outbox.test.ts`, 4 dos 6) reescritos sobre o motor de sync
 * que substituiu a outbox do shell (ADR 0003; T-0001 A3). Os títulos são os da Fase M para o rastreio dos 277.
 * Os 2 casos de pedido (`mergeOrders`, `upsertOrder`) foram para `modules/vendedor/app/lib` (dono do pedido).
 */
import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { criarMotorSync, type ItemOutbox } from './motor-sync';
import { FABRICAS_ARMAZENAMENTO } from './motor-sync.fabricas';
import { criarServidorSyncSimulado } from './sync-simulado';
import { criarRegistroSync, definirEntidadeSync, type ItemPush, type ResultadoItemPush } from './sync';

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor'], sync: ['visita'] }),
  defineModule({
    id: 'vendedor',
    versao: '1.0.0',
    depende: ['core'],
    perfis: ['vendedor'],
    sync: ['pedido'],
  }),
];
const uuid = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const AGORA = new Date('2026-10-12T14:00:00.000Z');

const Visita = z.union([
  z.object({ id: z.string(), customer_id: z.string(), checkin_at: z.string() }),
  z.object({ visit_id: z.string(), outcome: z.string(), no_order_reason: z.string().optional() }),
]);

describe.each(FABRICAS_ARMAZENAMENTO)('fila de envio da Fase M [%s]', (_nome, fabrica) => {
  function montar(transporte?: { push: (itens: ItemPush[]) => Promise<ResultadoItemPush[]> }) {
    const registro = criarRegistroSync(manifestos);
    registro.registrar(
      definirEntidadeSync({
        nome: 'visita',
        modulo: 'core',
        direcao: 'ambos',
        conflito: 'servidor_vence',
        schema: Visita,
      }),
    );
    registro.registrar(
      definirEntidadeSync({
        nome: 'pedido',
        modulo: 'vendedor',
        direcao: 'ambos',
        conflito: 'app_edita_ate_status',
        schema: z.object({ customer_id: z.string() }),
      }),
    );
    const servidor = criarServidorSyncSimulado(registro, { modulosAtivos: ['core', 'vendedor'] });
    const motor = criarMotorSync({
      registro,
      armazenamento: fabrica(),
      transporte: transporte ? { push: transporte.push, pull: servidor.pull } : servidor,
      agora: () => AGORA,
    });
    return { motor, servidor };
  }

  const pedido = (n: number) => ({
    id: uuid(n),
    entidade: 'pedido',
    payload: { customer_id: 'c1' },
    rotulo: 'Pedido',
    detalhe: 'Auto Peças Rio Negro',
  });
  const checkin = (n: number) => ({
    id: uuid(n),
    entidade: 'visita',
    payload: { id: uuid(n), customer_id: 'c1', checkin_at: AGORA.toISOString() },
    rotulo: 'Check-in',
  });
  const checkout = (n: number, visitId: string) => ({
    id: uuid(n),
    entidade: 'visita',
    payload: { visit_id: visitId, outcome: 'no_order', no_order_reason: 'Loja fechada' },
    rotulo: 'Checkout sem pedido · Loja fechada',
  });

  describe('outbox', () => {
    it('enfileira em ordem (FIFO) e não duplica a mesma idempotency_key', async () => {
      const { motor } = montar();
      await motor.enfileirar(checkin(1));
      await motor.enfileirar(pedido(2));
      await motor.enfileirar(pedido(2));
      expect(motor.estado().fila.map((i) => i.id)).toEqual([uuid(1), uuid(2)]);
    });

    it('marca tentativa com erro e separa erro definitivo (failed) do envio automático', async () => {
      let falhaDeRede = true;
      const { motor } = montar({
        push: async (itens) => {
          if (falhaDeRede) throw new Error('Sem conexão');
          return itens.map((i): ResultadoItemPush =>
            i.id === uuid(2)
              ? { id: i.id, status: 'rejeitado', codigo: 'RN-VEN-01', mensagem: 'Cliente não encontrado' }
              : { id: i.id, status: 'aceito' },
          );
        },
      });
      await motor.enfileirar(pedido(1));
      await motor.enfileirar(pedido(2));
      await motor.enviar();
      expect(motor.estado().fila.map((i) => [i.tentativas, i.ultimo_erro, i.situacao])).toEqual([
        [1, 'Sem conexão', 'pendente'],
        [1, 'Sem conexão', 'pendente'],
      ]);
      falhaDeRede = false;
      await motor.enviar();
      // o aceito sai; o rejeitado vira "falhou" e o envio automático não o tenta de novo
      expect(motor.estado().fila).toMatchObject([
        { id: uuid(2), tentativas: 2, situacao: 'falhou', codigo: 'RN-VEN-01' },
      ]);
      expect(await motor.enviar()).toEqual([]);
      // o vendedor pede "reenviar": o falho volta a ser enviado
      expect((await motor.enviar({ incluirFalhos: true })).map((r) => r.status)).toEqual(['rejeitado']);
    });

    it('remove pela chave depois do envio', async () => {
      const { motor, servidor } = montar();
      await motor.enfileirar(pedido(1));
      await motor.enfileirar(checkin(2));
      await motor.descartar(uuid(2));
      expect(motor.estado().fila.map((i) => i.id)).toEqual([uuid(1)]);
      await motor.enviar();
      expect(motor.estado().fila).toEqual([]);
      expect([...servidor.recebidos.keys()]).toEqual([uuid(1)]);
    });

    it('check-in e checkout da visita: ids pendentes, descarte (409) e troca de id', async () => {
      const { motor } = montar();
      await motor.enfileirar(checkin(1));
      await motor.enfileirar(pedido(2));
      await motor.enfileirar(checkout(3, uuid(1)));
      await motor.enfileirar(checkout(4, 'v2'));
      const visitas = (fila: readonly ItemOutbox[]) =>
        fila
          .filter((i) => i.entidade === 'visita')
          .map((i) => i.payload as { id?: string; visit_id?: string });
      expect(
        visitas(motor.estado().fila)
          .filter((p) => p.id)
          .map((p) => p.id),
      ).toEqual([uuid(1)]);
      expect(
        visitas(motor.estado().fila)
          .filter((p) => p.visit_id)
          .map((p) => p.visit_id),
      ).toEqual([uuid(1), 'v2']);
      // servidor devolveu o atendimento já aberto (outro id): o checkout da fila passa a apontar para ele
      const co = motor.estado().fila.find((i) => i.id === uuid(3))!;
      await motor.alterar(uuid(3), { payload: { ...(co.payload as object), visit_id: 'srv' } });
      expect(
        visitas(motor.estado().fila)
          .filter((p) => p.visit_id)
          .map((p) => p.visit_id),
      ).toEqual(['srv', 'v2']);
      // servidor recusou o check-in: saem o check-in e o checkout dele; o pedido fica
      await motor.descartar(uuid(1));
      await motor.descartar(uuid(3));
      expect(motor.estado().fila.map((i) => i.id)).toEqual([uuid(2), uuid(4)]);
    });
  });
});
