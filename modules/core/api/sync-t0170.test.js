/**
 * Provedores de sync da T-0170 sem banco: declaração das entidades (direção, escopo, conflito), o texto do SQL do pull (janela,
 * escopo e ordem do cursor) e a poda local espelhando a janela do servidor (ADR 0009 §5).
 */
import { describe, expect, it } from 'vitest';
import { sqlDoPull } from './sync';
import { JANELAS_T0170, provedoresSyncT0170, TABELAS_SYNC_T0170 } from './sync-t0170';
const HOJE = '2026-11-13';
const pedido = { desde: null, ate: '2026-11-13T12:00:00.000Z', limite: 100 };
describe('entidades da T-0170', () => {
    const por = (n) => provedoresSyncT0170.find((p) => p.entidade.nome === n);
    it('declara as 6 entidades do Core com direção, escopo e conflito do desenho', () => {
        expect(provedoresSyncT0170.map((p) => p.entidade.nome)).toEqual(['tarefa', 'tarefa_conclusao', 'frase_dia', 'usuario_avatar', 'meta_produtividade', 'deslocamento_dia']);
        expect(por('tarefa')).toMatchObject({ escopo: 'proprio', entidade: { direcao: 'pull', conflito: 'servidor_vence', modulo: 'core' } });
        expect(por('tarefa_conclusao').entidade).toMatchObject({ direcao: 'push', conflito: 'somente_insercao', modulo: 'core' });
        expect(por('frase_dia')).toMatchObject({ escopo: 'tenant', entidade: { direcao: 'pull' } });
        expect(por('usuario_avatar')).toMatchObject({ escopo: 'usuarios', entidade: { direcao: 'ambos', conflito: 'servidor_vence' } });
        expect(por('meta_produtividade')).toMatchObject({ escopo: 'tenant', entidade: { direcao: 'pull' } });
        expect(por('deslocamento_dia')).toMatchObject({ escopo: 'usuarios', entidade: { direcao: 'pull' } });
    });
    it('só a conclusão e o avatar recebem comando; só o que o aparelho lê tem pull', () => {
        expect(provedoresSyncT0170.filter((p) => p.receber).map((p) => p.entidade.nome)).toEqual(['tarefa_conclusao', 'usuario_avatar']);
        expect(provedoresSyncT0170.filter((p) => p.puxar).map((p) => p.entidade.nome)).toEqual(['tarefa', 'frase_dia', 'usuario_avatar', 'meta_produtividade', 'deslocamento_dia']);
    });
    it('a poda local existe só onde o servidor tem janela (tarefa e deslocamento_dia)', () => {
        expect(por('tarefa').entidade.naJanela).toBeTypeOf('function');
        expect(por('deslocamento_dia').entidade.naJanela).toBeTypeOf('function');
        expect(por('frase_dia').entidade.naJanela).toBeUndefined();
        expect(por('meta_produtividade').entidade.naJanela).toBeUndefined();
    });
});
describe('SQL do pull', () => {
    it('tarefa: lê pelo destinatário, filtra o usuário, deixa as removidas passarem e aplica a janela de 30 dias com a data do tenant', () => {
        const { sql, valores } = sqlDoPull(TABELAS_SYNC_T0170.tarefa, pedido, new Set(['u1']), HOJE);
        expect(sql).toContain('from core.tarefa_destinatario d join core.tarefa t');
        expect(sql).toContain('and usuario_id = any($5::uuid[])');
        expect(sql).toContain("(deleted_at is not null or ((concluida_ts is null and cancelada_ts is null) or greatest(concluida_ts, cancelada_ts)::date >= date '2026-11-13' - 30))");
        expect(sql).toContain('order by updated_at, id');
        expect(valores[4]).toEqual(['u1']);
    });
    it('frase_dia e meta_produtividade: do tenant inteiro, sem janela e sem filtro de usuário (as removidas vão junto)', () => {
        for (const t of [TABELAS_SYNC_T0170.frase_dia, TABELAS_SYNC_T0170.meta_produtividade]) {
            const { sql, valores } = sqlDoPull(t, pedido, 'tenant', HOJE);
            expect(sql).not.toContain('deleted_at is null');
            expect(sql).not.toContain('= any($5');
            expect(valores).toHaveLength(4);
        }
    });
    it('usuario_avatar e deslocamento_dia: só os usuários visíveis; o km usa a janela do mês passado inteiro', () => {
        expect(sqlDoPull(TABELAS_SYNC_T0170.usuario_avatar, pedido, new Set(['u1', 'u2']), HOJE).sql).toContain('and usuario_id = any($5::uuid[])');
        const km = sqlDoPull(TABELAS_SYNC_T0170.deslocamento_dia, pedido, new Set(['u1']), HOJE).sql;
        expect(km).toContain("least(date '2026-11-13' - 40, date_trunc('month', date '2026-11-13' - interval '1 month')::date)");
        expect(() => sqlDoPull(TABELAS_SYNC_T0170.tarefa, pedido, new Set(['u1']))).toThrow(/data de hoje/);
    });
});
describe('poda local espelha a janela do servidor', () => {
    const dias = (n) => new Date(Date.parse(`${HOJE}T12:00:00Z`) + n * 86_400_000).toISOString();
    it('tarefa: aberta e não cancelada fica sempre; concluída ou cancelada fica por 30 dias (vale a mais recente das duas datas)', () => {
        const t = JANELAS_T0170.tarefa;
        expect(t({ concluida_em: null, cancelada_em: null }, HOJE)).toBe(true);
        expect(t({ concluida_em: dias(-30), cancelada_em: null }, HOJE)).toBe(true);
        expect(t({ concluida_em: dias(-31), cancelada_em: null }, HOJE)).toBe(false);
        expect(t({ concluida_em: null, cancelada_em: dias(-45) }, HOJE)).toBe(false);
        expect(t({ concluida_em: dias(-45), cancelada_em: dias(-2) }, HOJE)).toBe(true);
    });
    it('deslocamento_dia: vale a data mais antiga entre hoje − 40 e o início do mês anterior', () => {
        const d = JANELAS_T0170.deslocamento_dia;
        expect(d({ data: '2026-10-01' }, HOJE)).toBe(true); // início do mês anterior
        expect(d({ data: '2026-09-30' }, HOJE)).toBe(false);
        expect(d({ data: '2026-10-05' }, '2026-11-30')).toBe(true); // hoje − 40 = 21/10, mas o mês passado inteiro vale
        expect(d({ data: '2026-09-29' }, '2026-11-30')).toBe(false);
        expect(d({}, HOJE)).toBe(true); // sem o campo, fica
    });
});
