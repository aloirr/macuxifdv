/**
 * T-0026 × Postgres: limite de FALHAS de login por IP real (atrás do túnel todos chegam pelo mesmo proxy).
 * Entradas certas não consomem o limite; falhas do mesmo IP + empresa + e-mail bloqueiam (429); IPs diferentes
 * não se bloqueiam. Falhas usam e-mail inexistente (não mexe em tentativas de usuário real dos outros testes).
 */
import { comTenant, DOIS_TENANTS } from '@macuxi/db/teste';
import { banco, semBanco } from '@macuxi/db/teste/estado';
import { ErroHttpModulo } from '@macuxi/platform-sdk';
import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { LoginSenhaRequestSchema, SessaoRespostaSchema } from '../contracts';
import { contextoPublico, SEGREDO } from './apoio-teste';
import { criarAutenticacao } from './autenticacao';
const A = DOIS_TENANTS.A;
const SENHA = process.env.MACUXI_SENHA_TESTE ?? 'Teste@1234';
describe.skipIf(semBanco())('T-0026 × Postgres: limite de falhas de login por IP real', () => {
    let pool;
    let acesso;
    beforeAll(() => {
        pool = new pg.Pool({ connectionString: banco().urlApp, max: 4 });
        acesso = {
            comTenant: (tenantId, fn) => comTenant(pool, tenantId, (c) => fn(c)),
            semTenant: async (fn) => {
                const c = await pool.connect();
                try {
                    await c.query('begin');
                    const r = await fn(c);
                    await c.query('commit');
                    return r;
                }
                catch (e) {
                    await c.query('rollback').catch(() => undefined);
                    throw e;
                }
                finally {
                    c.release();
                }
            },
        };
    });
    afterAll(async () => {
        await pool?.end();
    });
    const entrar = (auth, ip, email, senha = SENHA) => auth.login(contextoPublico(LoginSenhaRequestSchema.parse({ codigo_empresa: A.codigo, email, senha }), acesso, () => new Date(), ip));
    const status = async (p) => {
        try {
            await p;
            return 200;
        }
        catch (e) {
            if (e instanceof ErroHttpModulo)
                return e.status;
            throw e;
        }
    };
    it('RF-CORE-01 (T-0026): 10 logins certos seguidos do mesmo IP não dão 429', async () => {
        const auth = criarAutenticacao({ segredo: () => SEGREDO });
        for (let i = 0; i < 10; i++) {
            const r = SessaoRespostaSchema.parse(await entrar(auth, '203.0.113.10', 'gerente@exemplo.com.br'));
            expect(r.usuario.perfil).toBe('gerente');
        }
    });
    it('RF-CORE-01 (T-0026): falhas seguidas do mesmo IP + e-mail bloqueiam (429), mesmo com a senha certa depois; outro IP segue livre', async () => {
        const auth = criarAutenticacao({ segredo: () => SEGREDO });
        const ruim = 'ninguem-t0026@exemplo.com.br';
        for (let i = 0; i < 10; i++)
            expect(await status(entrar(auth, '203.0.113.20', ruim))).toBe(401);
        expect(await status(entrar(auth, '203.0.113.20', ruim))).toBe(429);
        // dois IPs atrás do mesmo proxy não se bloqueiam
        expect(await status(entrar(auth, '203.0.113.21', ruim))).toBe(401);
        expect(await status(entrar(auth, '203.0.113.21', 'gerente@exemplo.com.br'))).toBe(200);
        // o IP bloqueado entra normalmente com OUTRO e-mail (a chave inclui o e-mail)
        expect(await status(entrar(auth, '203.0.113.20', 'gerente@exemplo.com.br'))).toBe(200);
    });
});
