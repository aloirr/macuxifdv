import { describe, expect, it } from 'vitest';
import { CONSULTA_PRODUTIVIDADE_EQUIPE, PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO, ProdutividadeEquipeEntradaSchema, ProdutividadeEquipeSaidaSchema } from '../contracts';
import { consultaProdutividadeEquipe, registrarContatoDoAparelho } from './produtividade-equipe';
const U1 = '0b000000-0000-4000-8000-000000000001';
const U2 = '0b000000-0000-4000-8000-000000000002';
function banco(parametros, usuarios) {
    const chamadas = [];
    const db = {
        query: async (sql, valores = []) => {
            chamadas.push({ sql, valores });
            const chaves = (valores[0] ?? []);
            const rows = /from plataforma\.parametro/.test(sql) ? chaves.filter((c) => parametros[c] !== undefined).map((c) => ({ modulo: 'core', chave: c, valor: parametros[c] })) : /from core\.usuario u/.test(sql) ? usuarios : [];
            return { rows: rows, rowCount: rows.length };
        },
    };
    return { db, chamadas };
}
const consultar = (db, ids) => consultaProdutividadeEquipe.executar(ProdutividadeEquipeEntradaSchema.parse({ usuario_ids: ids }), { db });
describe('RN-CORE-26: consulta core.produtividade_equipe@1', () => {
    it('RN-CORE-26: entrada estrita de 1 a 500 ids e o contrato tem o nome certo', () => {
        expect(CONSULTA_PRODUTIVIDADE_EQUIPE.nome).toBe('core.produtividade_equipe@1');
        expect(ProdutividadeEquipeEntradaSchema.safeParse({ usuario_ids: [] }).success).toBe(false);
        expect(ProdutividadeEquipeEntradaSchema.safeParse({ usuario_ids: [U1], extra: 1 }).success).toBe(false);
        expect(ProdutividadeEquipeEntradaSchema.safeParse({ usuario_ids: Array.from({ length: 501 }, () => U1) }).success).toBe(false);
    });
    it('RN-CORE-26 e RN-CORE-44: sem parâmetros salvos devolve parado 60, padrões D6 e almoço 12:00 às 13:00; o contato vem do banco', async () => {
        const { db } = banco({}, [{ id: U1, almoco_inicio_min: null, almoco_fim_min: null, ultimo_contato_em: '2026-11-15T14:00:00.000Z' }, { id: U2, almoco_inicio_min: null, almoco_fim_min: null, ultimo_contato_em: null }]);
        const r = await consultar(db, [U1, U2]);
        expect(ProdutividadeEquipeSaidaSchema.safeParse(r).success).toBe(true);
        expect(r.parado_min).toBe(60);
        expect(r.alertas).toEqual(PARAMETROS_ALERTAS_PRODUTIVIDADE_PADRAO);
        expect(r.usuarios).toEqual([
            { id: U1, ultimo_contato_em: '2026-11-15T14:00:00.000Z', almoco_inicio_min: 720, almoco_fim_min: 780 },
            { id: U2, ultimo_contato_em: null, almoco_inicio_min: 720, almoco_fim_min: 780 },
        ]);
    });
    it('RN-CORE-44: o almoço vem resolvido (o do usuário, senão o padrão da empresa) e o parado_min vem de inicio.parado_min', async () => {
        const { db } = banco({ 'jornada.almoco_padrao': { inicio_min: 690, fim_min: 750 }, 'inicio.parado_min': 45 }, [
            { id: U1, almoco_inicio_min: 780, almoco_fim_min: 840, ultimo_contato_em: null },
            { id: U2, almoco_inicio_min: null, almoco_fim_min: null, ultimo_contato_em: null },
        ]);
        const r = await consultar(db, [U1, U2]);
        expect(r.parado_min).toBe(45);
        expect(r.usuarios.map((u) => [u.almoco_inicio_min, u.almoco_fim_min])).toEqual([[780, 840], [690, 750]]);
    });
    it('RN-CORE-03: só consulta usuários não removidos pelos ids pedidos, na transação do tenant (RLS: id de outro tenant some)', async () => {
        const { db, chamadas } = banco({}, []);
        const r = await consultar(db, [U1]);
        expect(r.usuarios).toEqual([]);
        const sql = chamadas.find((c) => /from core\.usuario u/.test(c.sql));
        expect(sql.sql).toContain('u.deleted_at is null');
        expect(sql.sql).toContain('u.id = any($1::uuid[])');
        expect(sql.valores[0]).toEqual([U1]);
    });
});
describe('RN-CORE-03 e RN-AUD-01: contatoDoAparelho grava só em core.usuario_contato', () => {
    it('RN-CORE-03: upsert do usuário da requisição com ctx.agora() e trava de 1 minuto no SQL; não toca em core.usuario', async () => {
        const { db, chamadas } = banco({}, []);
        const ctx = { usuario: { id: U1 }, agora: () => new Date('2026-11-15T14:00:00Z'), comTenant: (fn) => fn(db) };
        await registrarContatoDoAparelho(ctx);
        expect(chamadas).toHaveLength(1);
        expect(chamadas[0].valores).toEqual([U1, '2026-11-15T14:00:00.000Z']);
        expect(chamadas[0].sql).toContain('insert into core.usuario_contato');
        expect(chamadas[0].sql).toContain("interval '1 minute'");
        expect(chamadas[0].sql).not.toMatch(/update core\.usuario\b(?!_)/);
    });
});
