import { describe, expect, it } from 'vitest';
import { copiarRota, gerarParadasPorFrequencia, statusDasParadas } from './agenda';
const MANAUS = 'America/Manaus';
const p = (id, cliente_id, sequencia) => ({ id, cliente_id, sequencia, data: '2026-10-12' });
const paradas = [p('p3', 'c3', 3), p('p1', 'c1', 1), p('p2', 'c2', 2)];
const agora = new Date('2026-10-12T15:00:00Z');
const visita = (over) => ({ id: 'v', cliente_id: 'c1', rota_parada_id: null, data_local: '2026-10-12', checkin_em: '2026-10-12T13:00:00Z', checkout_em: null, ...over });
describe('status das paradas da rota do dia (RN-CORE-11)', () => {
    it('sem visitas: primeira parada é a próxima, as outras pendentes, na ordem da sequência', () => {
        const r = statusDasParadas(paradas, [], agora, MANAUS);
        expect(r.map((x) => [x.id, x.status])).toEqual([['p1', 'proxima'], ['p2', 'pendente'], ['p3', 'pendente']]);
    });
    it('visita com checkout = feita; a próxima passa para a seguinte', () => {
        const r = statusDasParadas(paradas, [visita({ rota_parada_id: 'p1', checkout_em: '2026-10-12T14:00:00Z' })], agora, MANAUS);
        expect(r.map((x) => x.status)).toEqual(['feita', 'proxima', 'pendente']);
    });
    it('check-in aberto = em atendimento (casa por cliente se a visita não traz a parada)', () => {
        const r = statusDasParadas(paradas, [visita({ cliente_id: 'c2' })], agora, MANAUS);
        expect(r.map((x) => x.status)).toEqual(['proxima', 'em_atendimento', 'pendente']);
        expect(r[1]?.visita_id).toBe('v');
    });
    it('RN-CORE-11: aberta de ontem (virada do dia passou) conta como feita, não em atendimento', () => {
        const ontem = visita({ rota_parada_id: 'p1', data_local: '2026-10-11', checkin_em: '2026-10-11T20:00:00Z' });
        const r = statusDasParadas(paradas, [ontem], agora, MANAUS);
        expect(r[0]?.status).toBe('feita');
    });
    it('visita de outro dia não marca a parada de hoje', () => {
        const r = statusDasParadas(paradas, [visita({ cliente_id: 'c1', data_local: '2026-10-05' })], agora, MANAUS);
        expect(r[0]?.status).toBe('proxima');
    });
    it('RN-CORE-11: visita ligada a OUTRA parada do mesmo cliente não marca esta parada por cliente+dia', () => {
        const ps = [p('p1', 'c1', 1), p('p2', 'c1', 2)];
        const r = statusDasParadas(ps, [visita({ cliente_id: 'c1', rota_parada_id: 'p2', checkout_em: '2026-10-12T14:00:00Z' })], agora, MANAUS);
        expect(r.map((x) => x.status)).toEqual(['proxima', 'feita']);
    });
    it('virada do dia em São Paulo (03:00Z) fecha a aberta antes do que em Manaus', () => {
        const aberta = visita({ rota_parada_id: 'p1', checkin_em: '2026-10-12T20:00:00Z' });
        const t = new Date('2026-10-13T03:30:00Z');
        expect(statusDasParadas(paradas.map((x) => ({ ...x, data: '2026-10-12' })), [aberta], t, 'America/Sao_Paulo')[0]?.status).toBe('feita');
        expect(statusDasParadas(paradas, [aberta], t, MANAUS)[0]?.status).toBe('em_atendimento');
    });
});
describe('agenda por frequência (RF-CORE-05)', () => {
    const semana = '2026-10-12'; // segunda
    const item = (cliente_id, over = {}) => ({ cliente_id, usuario_id: 'u1', inicio: '2026-09-01', fim: null, frequencia_semanas: 1, dia_semana: 3, ...over });
    it('semanal: gera a parada no dia da semana pedido (3 = quarta)', () => {
        expect(gerarParadasPorFrequencia([item('c1')], semana)).toEqual([{ usuario_id: 'u1', cliente_id: 'c1', data: '2026-10-14' }]);
    });
    it('quinzenal: só nas semanas alternadas a partir do início da vigência', () => {
        const it2 = item('c1', { frequencia_semanas: 2, inicio: '2026-10-05' }); // semana de 05/10 = índice 0
        expect(gerarParadasPorFrequencia([it2], '2026-10-05')).toHaveLength(1);
        expect(gerarParadasPorFrequencia([it2], '2026-10-12')).toHaveLength(0);
        expect(gerarParadasPorFrequencia([it2], '2026-10-19')).toHaveLength(1);
    });
    it('fora da vigência ou sem frequência/dia não gera parada', () => {
        expect(gerarParadasPorFrequencia([item('c1', { fim: '2026-10-13' })], semana)).toEqual([]);
        expect(gerarParadasPorFrequencia([item('c1', { inicio: '2026-10-20' })], semana)).toEqual([]);
        expect(gerarParadasPorFrequencia([item('c1', { frequencia_semanas: null })], semana)).toEqual([]);
        expect(gerarParadasPorFrequencia([item('c1', { dia_semana: null })], semana)).toEqual([]);
    });
    it('segunda a domingo: dia 7 cai no domingo da mesma semana', () => {
        expect(gerarParadasPorFrequencia([item('c1', { dia_semana: 7 })], semana)[0]?.data).toBe('2026-10-18');
    });
    it('resultado ordenado por usuário, data e a ordem recebida', () => {
        const r = gerarParadasPorFrequencia([item('c2', { dia_semana: 2 }), item('c1', { dia_semana: 2 }), item('c3', { dia_semana: 1 })], semana);
        expect(r.map((x) => x.cliente_id)).toEqual(['c3', 'c2', 'c1']);
    });
});
describe('copiar rota para outras datas', () => {
    const origem = [
        { cliente_id: 'c1', sequencia: 1, janela_inicio: '08:00', janela_fim: '09:00' },
        { cliente_id: 'c2', sequencia: 2 },
    ];
    it('copia as paradas na mesma ordem para cada data', () => {
        const r = copiarRota(origem, ['2026-10-13', '2026-10-14']);
        expect(r.copiadas.map((x) => x.data)).toEqual(['2026-10-13', '2026-10-14']);
        expect(r.copiadas[0]?.paradas.map((x) => x.cliente_id)).toEqual(['c1', 'c2']);
        expect(r.copiadas[0]?.paradas[0]).toMatchObject({ sequencia: 1, janela_inicio: '08:00', janela_fim: '09:00' });
    });
    it('não substitui datas que já têm visita feita e informa quais ficaram de fora', () => {
        const r = copiarRota(origem, ['2026-10-13', '2026-10-14'], new Set(['2026-10-13']));
        expect(r.copiadas.map((x) => x.data)).toEqual(['2026-10-14']);
        expect(r.ignoradas).toEqual(['2026-10-13']);
    });
    it('datas repetidas são copiadas uma vez só', () => {
        expect(copiarRota(origem, ['2026-10-13', '2026-10-13']).copiadas).toHaveLength(1);
    });
});
