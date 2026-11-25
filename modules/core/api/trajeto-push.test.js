import { describe, expect, it } from 'vitest';
import { PARAMETROS_RASTREAMENTO_PADRAO } from '../contracts';
import { sqlDoPull } from './sync';
import { provedoresSyncTrajeto, TABELAS_SYNC_TRAJETO } from './sync-trajeto';
import { receberPontosTrajeto } from './trajeto-push';
const U = '0e300000-0000-4000-8000-000000000001';
const idn = (n) => `0e300000-0000-4000-8000-0000000001${String(n).padStart(2, '0')}`;
// quinta-feira, 19/11/2026, 10h30 de Manaus
const AGORA = new Date('2026-11-19T14:30:00.000Z');
function ctxFalso(c = {}, perfil = 'vendedor') {
    const sqls = [];
    const logs = [];
    const param = { ...PARAMETROS_RASTREAMENTO_PADRAO, ativo: c.ativo ?? true };
    const db = {
        query: async (sql, valores = []) => {
            sqls.push({ sql, valores });
            if (/from plataforma\.parametro/.test(sql))
                return { rows: [{ modulo: 'core', chave: 'rastreamento', valor: param }], rowCount: 1 };
            if (/from core\.ausencia_usuario/.test(sql))
                return { rows: c.ausencias ?? [], rowCount: (c.ausencias ?? []).length };
            if (/from core\.ponto_trajeto/.test(sql))
                return { rows: [], rowCount: 0 };
            return { rows: [], rowCount: 1 };
        },
    };
    const ctx = {
        usuario: { id: U, tenant_id: 't', perfil },
        agora: () => AGORA,
        fuso: () => 'America/Manaus',
        log: { info: (o) => logs.push(o), warn: () => undefined, error: () => undefined },
        comTenant: async (fn) => fn(db, {}),
    };
    return { ctx, sqls, logs };
}
const ponto = (n, extra = {}) => ({ id: idn(n), capturado_em: '2026-11-19T14:00:00.000Z', latitude: -3.1, longitude: -60.02, precisao_m: 12, velocidade_ms: null, ...extra });
const item = (p, operacao = 'criar') => ({ id: p.id, operacao, payload: p });
const inserts = (s, tabela) => s.sqls.filter((x) => new RegExp(`^\\s*insert into core\\.${tabela}`).test(x.sql));
describe('RN-CORE-13: push de ponto_trajeto', () => {
    it('RN-CORE-13: dentro do portão, grava os pontos num insert só e recalcula o resumo do dia', async () => {
        const s = ctxFalso();
        const r = await receberPontosTrajeto(s.ctx, [item(ponto(1)), item(ponto(2, { capturado_em: '2026-11-19T14:10:00.000Z' }))]);
        expect(r).toEqual([{ id: idn(1), status: 'aceito' }, { id: idn(2), status: 'aceito' }]);
        const ins = inserts(s, 'ponto_trajeto');
        expect(ins).toHaveLength(1);
        expect(ins[0].sql).toContain('on conflict (id) do nothing');
        expect(ins[0].valores[0]).toBe(U);
        expect(ins[0].valores[1]).toEqual([idn(1), idn(2)]);
        const resumo = inserts(s, 'deslocamento_dia');
        expect(resumo).toHaveLength(1);
        expect(resumo[0].valores.slice(0, 2)).toEqual([U, '2026-11-19']);
        expect(resumo[0].sql).toContain("'rastreamento'");
    });
    it('RN-CORE-13: ponto fora do portão é descartado sem gravar e a fila segue (resposta aceito)', async () => {
        const casos = [
            ['tracking desligado', { ativo: false }],
            ['ausência cadastrada', { ausencias: [{ de: '2026-11-19', ate: '2026-11-19' }] }],
        ];
        for (const [nome, c] of casos) {
            const s = ctxFalso(c);
            const r = await receberPontosTrajeto(s.ctx, [item(ponto(1))]);
            expect(r, nome).toEqual([{ id: idn(1), status: 'aceito' }]);
            expect(inserts(s, 'ponto_trajeto'), nome).toHaveLength(0);
            expect(inserts(s, 'deslocamento_dia'), nome).toHaveLength(0);
            expect(JSON.stringify(s.logs), nome).not.toContain('-3.1');
        }
    });
    it('RN-CORE-13: gerente (não é de campo), futuro > 5 min e mais de 90 dias são descartados; o resto do lote passa', async () => {
        const s = ctxFalso({}, 'gerente');
        await receberPontosTrajeto(s.ctx, [item(ponto(1))]);
        expect(inserts(s, 'ponto_trajeto')).toHaveLength(0);
        const v = ctxFalso();
        await receberPontosTrajeto(v.ctx, [item(ponto(1, { capturado_em: '2026-11-19T14:40:00.000Z' })), item(ponto(2, { capturado_em: '2026-08-01T14:00:00.000Z' })), item(ponto(3))]);
        expect(inserts(v, 'ponto_trajeto')[0].valores[1]).toEqual([idn(3)]);
    });
    it('RN-CORE-13: ponto de supervisor dentro do portão é gravado (o cargo decide o app: Gestão)', async () => {
        const s = ctxFalso({}, 'supervisor');
        await receberPontosTrajeto(s.ctx, [item(ponto(1))]);
        expect(inserts(s, 'ponto_trajeto')).toHaveLength(1);
    });
    it('RN-CORE-13: payload inválido ou remoção é rejeitado só naquele item; sem coordenada na mensagem', async () => {
        const s = ctxFalso();
        const r = await receberPontosTrajeto(s.ctx, [item(ponto(1, { latitude: 200 })), item(ponto(2), 'remover'), item(ponto(3))]);
        expect(r[0]).toMatchObject({ id: idn(1), status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO' });
        expect(r[1]).toMatchObject({ id: idn(2), status: 'rejeitado', codigo: 'OPERACAO_NAO_SUPORTADA' });
        expect(r[2]).toEqual({ id: idn(3), status: 'aceito' });
        expect(JSON.stringify(r)).not.toContain('200');
    });
});
describe('entidades e pull do rastreamento', () => {
    const por = (n) => provedoresSyncTrajeto.find((p) => p.entidade.nome === n);
    it('RN-CORE-13: ponto só de envio e ausência só de leitura, no padrão do motor', () => {
        expect(provedoresSyncTrajeto.map((p) => p.entidade.nome)).toEqual(['ponto_trajeto', 'ausencia_usuario']);
        expect(por('ponto_trajeto').entidade).toMatchObject({ direcao: 'push', conflito: 'somente_insercao', modulo: 'core' });
        expect(por('ponto_trajeto').puxar).toBeUndefined();
        expect(por('ausencia_usuario')).toMatchObject({ escopo: 'proprio', entidade: { direcao: 'pull' } });
    });
    it('RN-CORE-13: o pull da ausência filtra o usuário', () => {
        const pedido = { desde: null, ate: '2026-11-19T15:00:00.000Z', limite: 100 };
        expect(sqlDoPull(TABELAS_SYNC_TRAJETO.ausencia_usuario, pedido, new Set([U]), '2026-11-19').sql).toContain('and usuario_id = any($5::uuid[])');
    });
});
