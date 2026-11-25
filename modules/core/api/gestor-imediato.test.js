import { describe, expect, it } from 'vitest';
import { gestorImediatoDoUsuario } from './gestor-imediato';
const U = (id, nome, equipe_id, ativo = true) => ({ id, nome, perfil: 'vendedor', equipe_id, ativo });
const bancoFalso = (equipes, usuarios) => ({ query: async (sql) => ({ rows: sql.includes('core.equipe') ? equipes : usuarios, rowCount: 0 }) });
describe('RN-CORE-04: gestor imediato na sessão do usuário', () => {
    const equipes = [{ id: 'e1', equipe_pai_id: null, responsavel_id: 'sup' }];
    it('devolve o responsável da equipe (id e nome) e nada além disso', async () => {
        const db = bancoFalso(equipes, [U('sup', 'Sueli', null), U('v1', 'Vera', 'e1')]);
        expect(await gestorImediatoDoUsuario(db, 'v1')).toEqual({ gestor_imediato: { id: 'sup', nome: 'Sueli' } });
    });
});
