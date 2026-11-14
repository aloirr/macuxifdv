import { describe, expect, it } from 'vitest';
import { publicada, QUEST, TENANT, u } from './util-teste';
import { questionariosParaTarefa, respostaLocalMaisRecente, respostasLocaisDoUsuario } from './tarefa-pesquisa';
const AGORA = '2026-10-31T15:00:00.000Z';
const q = (id = QUEST, arquivado_em = null) => ({ id, tenant_id: TENANT, criado_em: '2026-10-01T00:00:00Z', arquivado_em });
const pub = (perfis = [], equipes = []) => ({ perfis, equipes, segmentos: [], regioes: [], canais: [], clientes: [] });
describe('RN-PES-02: questionários para a tarefa', () => {
    it('RN-PES-02: lista só o vigente, com título e fim; fora da vigência, arquivado e sem versão publicada ficam de fora', () => {
        const ok = { questionario: q(), versoes: [publicada({ titulo: 'Gôndola', vigencia: { inicio: '2026-10-01T00:00:00Z', fim: '2026-11-30T00:00:00Z' } })] };
        const vencida = { questionario: q(u(801)), versoes: [publicada({ questionario_id: u(801), vigencia: { inicio: '2026-09-01T00:00:00Z', fim: '2026-09-30T00:00:00Z' } })] };
        const futura = { questionario: q(u(802)), versoes: [publicada({ questionario_id: u(802), vigencia: { inicio: '2026-12-01T00:00:00Z', fim: null } })] };
        const arquivada = { questionario: q(u(803), '2026-10-02T00:00:00Z'), versoes: [publicada({ questionario_id: u(803) })] };
        const rascunho = { questionario: q(u(804)), versoes: [publicada({ questionario_id: u(804), status: 'rascunho' })] };
        const r = questionariosParaTarefa([ok, vencida, futura, arquivada, rascunho], [{ id: u(1), perfil: 'promotor', equipe_ids: [] }], AGORA);
        expect(r).toEqual([{ questionario_id: QUEST, titulo: 'Gôndola', vigente_ate: '2026-11-30T00:00:00Z', fora_do_publico: [] }]);
    });
    it('RN-PES-02: sem prazo devolve vigente_ate nulo', () => {
        const r = questionariosParaTarefa([{ questionario: q(), versoes: [publicada({ vigencia: { inicio: '2026-10-01T00:00:00Z', fim: null } })] }], [{ id: u(1), perfil: 'promotor', equipe_ids: [] }], AGORA);
        expect(r[0]?.vigente_ate).toBeNull();
    });
    it('RF-PES-02: usuário de perfil ou equipe fora do público entra em fora_do_publico (perfis e equipes valem juntos)', () => {
        const p = { questionario: q(), versoes: [publicada({ publico_alvo: pub(['promotor'], [u(50)]) })] };
        const r = questionariosParaTarefa([p], [
            { id: u(1), perfil: 'promotor', equipe_ids: [u(50)] },
            { id: u(2), perfil: 'vendedor', equipe_ids: [u(50)] },
            { id: u(3), perfil: 'promotor', equipe_ids: [u(51)] },
        ], AGORA);
        expect(r[0]?.fora_do_publico).toEqual([u(2), u(3)]);
    });
    it('RF-PES-02: atributo do usuário desconhecido (null) não é verificável e não marca como fora (não bloqueia por engano)', () => {
        const p = { questionario: q(), versoes: [publicada({ publico_alvo: pub(['promotor'], [u(50)]) })] };
        const r = questionariosParaTarefa([p], [{ id: u(1), perfil: null, equipe_ids: null }, { id: u(2), perfil: 'vendedor', equipe_ids: null }], AGORA);
        expect(r[0]?.fora_do_publico).toEqual([u(2)]);
    });
    it('RN-PES-01: usa a versão vigente (a de maior número publicada)', () => {
        const v1 = publicada({ numero: 1, titulo: 'Antiga' });
        const v2 = publicada({ id: u(701), numero: 2, titulo: 'Nova' });
        const r = questionariosParaTarefa([{ questionario: q(), versoes: [v1, v2] }], [{ id: u(1), perfil: 'promotor', equipe_ids: [] }], AGORA);
        expect(r[0]?.titulo).toBe('Nova');
    });
});
describe('RN-PES-02: resposta local mais recente', () => {
    const r = (id, em, extra = {}) => ({ id: u(id), questionario_id: QUEST, cliente_id: u(60), respondida_em: em, ...extra });
    const base = { questionario_id: QUEST, cliente_id: u(60), desde: '2026-10-31T00:00:00.000Z' };
    it('RN-PES-02: devolve a mais recente a partir de desde (inclusive)', () => {
        expect(respostaLocalMaisRecente([r(1, '2026-10-31T00:00:00.000Z'), r(2, '2026-10-31T10:00:00.000Z'), r(3, '2026-10-30T23:59:59.000Z')], base)).toBe(u(2));
    });
    it('RN-PES-02: outro questionário, outro cliente ou antes de desde não contam; nada = null', () => {
        expect(respostaLocalMaisRecente([r(1, '2026-10-31T10:00:00.000Z', { questionario_id: u(9) }), r(2, '2026-10-31T10:00:00.000Z', { cliente_id: u(61) }), r(3, '2026-10-30T10:00:00.000Z')], base)).toBeNull();
    });
    it('RN-PES-02: cliente nulo na entrada aceita resposta de qualquer cliente (inclusive sem cliente)', () => {
        expect(respostaLocalMaisRecente([r(1, '2026-10-31T10:00:00.000Z', { cliente_id: null }), r(2, '2026-10-31T11:00:00.000Z', { cliente_id: u(61) })], { ...base, cliente_id: null })).toBe(u(2));
    });
    it('RN-PES-02: empate no instante desempata pelo id, de forma estável', () => {
        expect(respostaLocalMaisRecente([r(5, '2026-10-31T10:00:00.000Z'), r(4, '2026-10-31T10:00:00.000Z')], base)).toBe(u(5));
    });
});
describe('respostasLocaisDoUsuario (RN-PES-02)', () => {
    const base = (id, usuario, apagada = null) => ({ id: u(id), questionario_id: QUEST, cliente_id: u(60), respondida_em: '2026-10-31T09:00:00.000Z', usuario_id: u(usuario), deleted_at: apagada });
    it('RN-PES-02: do pull fica só o do usuário e sem apagadas; a fila entra inteira; id repetido vale uma vez', () => {
        const fila = [{ id: u(3), questionario_id: QUEST, cliente_id: null, respondida_em: '2026-10-31T10:00:00.000Z' }, { id: u(1), questionario_id: QUEST, cliente_id: u(60), respondida_em: '2026-10-31T09:00:00.000Z' }];
        const r = respostasLocaisDoUsuario([base(1, 5), base(2, 6), base(4, 5, '2026-10-31T11:00:00Z')], fila, u(5));
        expect(r.map((x) => x.id)).toEqual([u(1), u(3)]);
    });
});
