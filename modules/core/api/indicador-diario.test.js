import { describe, expect, it } from 'vitest';
import { gravarPositivadosDoDia } from './indicador-diario';
const U = '0b000000-0000-4000-8000-000000000001';
const C1 = '0d000000-0000-4000-8000-000000000001';
const C2 = '0d000000-0000-4000-8000-000000000002';
function fakeDb(respostas) {
    const chamadas = [];
    const db = {
        query: async (sql, valores = []) => {
            chamadas.push({ sql, valores });
            const rows = (respostas.shift() ?? []);
            return { rows, rowCount: rows.length };
        },
    };
    return { db, chamadas };
}
describe('RN-CORE-20/26: gravação dos clientes positivados do dia', () => {
    it('RN-CORE-20: grava lista e contagem juntas, sem repetir cliente, só de clientes do tenant (RLS + tenant_id explícito)', async () => {
        const { db, chamadas } = fakeDb([[{ clientes_positivados: 2 }]]);
        expect(await gravarPositivadosDoDia(db, { usuarioId: U, dia: '2026-11-10', clienteIds: [C1, C2, C1] })).toBe(2);
        expect(chamadas).toHaveLength(1);
        expect(chamadas[0].valores).toEqual([U, '2026-11-10', [C1, C2]]);
        expect(chamadas[0].sql).toContain('plataforma.tenant_atual()');
        expect(chamadas[0].sql).toContain('clientes_positivados_ids');
        expect(chamadas[0].sql).toMatch(/cardinality\(ids\.lista\)/);
    });
    it('RN-CORE-26: repetir a mesma lista não altera a linha e devolve a contagem que já estava gravada', async () => {
        const { db, chamadas } = fakeDb([[], [{ clientes_positivados: 2 }]]);
        expect(await gravarPositivadosDoDia(db, { usuarioId: U, dia: '2026-11-10', clienteIds: [C1, C2] })).toBe(2);
        expect(chamadas[0].sql).toContain('is distinct from');
        expect(chamadas).toHaveLength(2);
    });
    it('RN-CORE-26: cancelamento que tira o último cliente do dia grava lista vazia e contagem 0', async () => {
        const { db, chamadas } = fakeDb([[{ clientes_positivados: 0 }]]);
        expect(await gravarPositivadosDoDia(db, { usuarioId: U, dia: '2026-11-10', clienteIds: [] })).toBe(0);
        expect(chamadas[0].valores[2]).toEqual([]);
    });
});
