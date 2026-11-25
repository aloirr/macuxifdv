import { describe, expect, it } from 'vitest';
import { EsqueciSenhaRequestSchema } from '../contracts';
import { criarAutenticacao } from './autenticacao';
import { bancoDeTeste, contextoPublico, estadoInicial, fabricaEmMemoria, SEGREDO, senhasDeTeste } from './apoio-teste';
import { criarLimiteDeFalhas } from './limite-login';
import { repositorioTenantSql } from './repositorio';
describe('RN-CORE-34: Esqueci a senha trava a linha do usuário (D-01)', () => {
    it('RN-CORE-34: pede usuarioPorEmail com travar e grava a temporária dentro do mesmo comTenant', async () => {
        const e = await estadoInicial();
        const base = fabricaEmMemoria(e);
        const pedidos = [];
        let abertos = 0;
        let gravouDentro = false;
        const repos = {
            ...base,
            doTenant: (db) => {
                const r = base.doTenant(db);
                return {
                    ...r,
                    usuarioPorEmail: async (email, o) => {
                        pedidos.push(o);
                        return r.usuarioPorEmail(email, o);
                    },
                    gravarSenhaTemporaria: async (...a) => {
                        gravouDentro = abertos === 1;
                        return r.gravarSenhaTemporaria(...a);
                    },
                };
            },
        };
        const { banco } = bancoDeTeste();
        const bancoContado = {
            ...banco,
            comTenant: async (id, fn) => {
                abertos++;
                try {
                    return await banco.comTenant(id, fn);
                }
                finally {
                    abertos--;
                }
            },
        };
        const t0 = new Date('2026-11-07T12:00:00Z');
        const auth = criarAutenticacao({ segredo: () => SEGREDO, repos, senhas: senhasDeTeste(), limiteLogin: criarLimiteDeFalhas(), limiteEsqueciIp: criarLimiteDeFalhas(5, 900_000), limiteEsqueciChave: criarLimiteDeFalhas(3, 3_600_000) });
        const corpo = EsqueciSenhaRequestSchema.parse({ codigo_empresa: 'alfa', email: 'vendedor@exemplo.com.br' });
        const ctx = { ...contextoPublico(corpo, bancoContado, () => t0), email: { disponivel: () => true, enfileirar: async () => 'enfileirado' } };
        await auth.esqueciSenha(ctx);
        expect(pedidos).toEqual([{ travar: true }]);
        expect(gravouDentro).toBe(true);
    });
    it('RN-CORE-34: o SQL acrescenta for update só quando pedido', async () => {
        const sqls = [];
        const db = { query: async (sql) => (sqls.push(sql), { rows: [], rowCount: 0 }) };
        const r = repositorioTenantSql(db);
        await r.usuarioPorEmail('a@b.com');
        await r.usuarioPorEmail('a@b.com', { travar: true });
        expect(sqls[0]).not.toMatch(/for update/);
        expect(sqls[1]).toMatch(/for update\s*$/);
    });
});
