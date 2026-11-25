import { describe, expect, it } from 'vitest';
import { licencaDoTenant } from './licenca-tenant';
const dbCom = (modulos) => {
    const chamadas = [];
    const db = {
        query: async (sql) => {
            chamadas.push(sql);
            const rows = modulos.map((modulo) => ({ modulo }));
            return { rows: rows, rowCount: rows.length };
        },
    };
    return { db, chamadas };
};
describe('RN-CORE-27: licença do tenant da fonte de positivação (Início e Farol)', () => {
    it('RN-CORE-27: uma consulta só, só módulos ativos e não apagados; Vendedor e Integração independentes', async () => {
        const { db, chamadas } = dbCom(['vendedor']);
        expect(await licencaDoTenant(db)).toEqual({ integracaoNoTenant: false, vendedorNoTenant: true });
        expect(chamadas).toHaveLength(1);
        expect(chamadas[0]).toMatch(/from plataforma\.tenant_modulo/);
        expect(chamadas[0]).toMatch(/and ativo and deleted_at is null/);
        expect(await licencaDoTenant(dbCom(['integracao', 'vendedor']).db)).toEqual({ integracaoNoTenant: true, vendedorNoTenant: true });
        expect(await licencaDoTenant(dbCom([]).db)).toEqual({ integracaoNoTenant: false, vendedorNoTenant: false });
    });
});
