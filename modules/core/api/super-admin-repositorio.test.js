import { describe, expect, it } from 'vitest';
import { fabricaSuperAdminSql } from './super-admin-repositorio';
describe('super-admin-repositorio (sa_listar_tenants da 0039)', () => {
    it('T-0093: listarEmpresas lê razao_social (não nome) da lista das empresas', async () => {
        const chamadas = [];
        const banco = {
            semTenant: async (fn) => fn({
                query: async (sql) => {
                    chamadas.push(sql);
                    return { rows: [{ r: { itens: [{ id: 'e1', codigo: 'acme', razao_social: 'Acme Ltda', cnpj: null, modulos: [] }] } }] };
                },
            }),
        };
        const lista = await fabricaSuperAdminSql(banco).listarEmpresas('sid');
        expect(lista).toEqual([{ id: 'e1', codigo: 'acme', nome: 'Acme Ltda' }]);
        expect(chamadas[0]).toContain('sa_listar_tenants');
    });
});
