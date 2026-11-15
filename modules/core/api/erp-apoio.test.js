import { describe, expect, it } from 'vitest';
import { comMedidaAusente, ReferenciaAusenteErp } from './erp-apoio';
const pgErro = (code, constraint) => Object.assign(new Error('pg'), { code, constraint });
describe('T-0063: FK de medida nos consumidores do ERP', () => {
    it('RN-INT-04: 23503 em *_medida_fk vira ReferenciaAusenteErp(medida) para a outbox repetir', async () => {
        for (const c of ['produto_unidade_medida_fk', 'produto_medida_fk']) {
            const r = comMedidaAusente(() => Promise.reject(pgErro('23503', c)));
            await expect(r).rejects.toBeInstanceOf(ReferenciaAusenteErp);
            await expect(comMedidaAusente(() => Promise.reject(pgErro('23503', c)))).rejects.toMatchObject({ entidade: 'medida' });
        }
    });
    it('RN-INT-04: outras FKs e outros erros seguem como estão; sucesso devolve o resultado', async () => {
        const outra = pgErro('23503', 'produto_unidade_produto_fk');
        await expect(comMedidaAusente(() => Promise.reject(outra))).rejects.toBe(outra);
        const outro = pgErro('23505', 'x_medida_fk');
        await expect(comMedidaAusente(() => Promise.reject(outro))).rejects.toBe(outro);
        await expect(comMedidaAusente(() => Promise.resolve(7))).resolves.toBe(7);
    });
});
