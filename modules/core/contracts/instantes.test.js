import { describe, expect, it } from 'vitest';
import { CheckinVisitaSchema, CheckoutVisitaSchema, LeituraNotificacaoSchema, VisitaCheckinSchema, VisitaCheckoutSchema } from './index';
const u = '11111111-1111-4111-8111-111111111111';
describe('instantes e datas do contrato (RN-CORE-10/11, regra 4: datas em UTC)', () => {
    it('RN-CORE-11: checkin_em exige ISO UTC com Z', () => {
        expect(CheckinVisitaSchema.safeParse({ id: u, cliente_id: u, checkin_em: '2026-10-12T13:00:00.000Z' }).success).toBe(true);
        expect(CheckinVisitaSchema.safeParse({ id: u, cliente_id: u, checkin_em: 'ontem' }).success).toBe(false);
        expect(CheckinVisitaSchema.safeParse({ id: u, cliente_id: u, checkin_em: '2026-10-12T09:00:00-04:00' }).success).toBe(false);
    });
    it('RN-CORE-12: checkout_em e lida_em exigem datetime', () => {
        expect(CheckoutVisitaSchema.safeParse({ id: u, visita_id: u, checkout_em: '12/10/2026', resultado: 'atendido' }).success).toBe(false);
        expect(LeituraNotificacaoSchema.safeParse({ id: u, notificacao_id: u, lida_em: 'agora' }).success).toBe(false);
    });
    it('RN-CORE-11: payload dos eventos @1 tem formato (datetime e AAAA-MM-DD)', () => {
        const base = { visita_id: u, usuario_id: u, cliente_id: u, rota_parada_id: null, fora_do_raio: false, distancia_m: null, sem_gps: false, extra: false };
        expect(VisitaCheckinSchema.safeParse({ ...base, checkin_em: '2026-10-12T13:00:00Z', data_local: '2026-10-12' }).success).toBe(true);
        expect(VisitaCheckinSchema.safeParse({ ...base, checkin_em: '2026-10-12T13:00:00Z', data_local: '12/10' }).success).toBe(false);
        expect(VisitaCheckoutSchema.safeParse({ visita_id: u, usuario_id: u, cliente_id: u, checkin_em: 'x', checkout_em: '2026-10-12T13:00:00Z', data_local: '2026-10-12', resultado: 'nao_finalizado', motivo_codigo: null, pedido_id: null, fechada_por: 'auto', permanencia_s: 0 }).success).toBe(false);
    });
});
