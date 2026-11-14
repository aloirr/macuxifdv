import { describe, expect, it } from 'vitest';
import { filtrarResumos, respostaNoEscopoDoAparelho, respostasNoEscopo, resumirQuestionario } from './bko';
import { publicada, QUEST, sim_nao, TENANT, u, versao } from './util-teste';
const quest = { id: QUEST, tenant_id: TENANT, criado_em: '2026-10-01T00:00:00Z', arquivado_em: null };
const resposta = (n, usuario, cliente = null) => ({
    id: u(n),
    questionario_id: QUEST,
    versao_id: u(700),
    cliente_id: cliente === null ? null : u(cliente),
    visita_id: null,
    respondida_em: '2026-10-31T13:00:00Z',
    itens: [{ pergunta_id: u(1), tipo: 'sim_nao', valor: true }],
    tenant_id: TENANT,
    usuario_id: u(usuario),
    equipe_id: null,
    recebida_em: '2026-10-31T13:00:01Z',
    suspeita: false,
    motivos_suspeita: [],
});
describe('RN-CORE-04: escopo das respostas nos resultados', () => {
    const lista = [resposta(1, 31), resposta(2, 32), resposta(3, 33)];
    it('RN-CORE-04: analista/admin (tenant) veem tudo; supervisor vê só os usuários visíveis (ele e a equipe)', () => {
        expect(respostasNoEscopo(lista, 'tenant')).toHaveLength(3);
        expect(respostasNoEscopo(lista, new Set([u(31), u(33)])).map((r) => r.id)).toEqual([u(1), u(3)]);
        expect(respostasNoEscopo(lista, new Set())).toEqual([]);
    });
    it('RN-CORE-04 / RN-PES-02: no aparelho chegam as próprias e as dos clientes da carteira (para a frequência por cliente)', () => {
        const carteira = new Set([u(51)]);
        expect(respostaNoEscopoDoAparelho(resposta(1, 31), u(31), carteira)).toBe(true);
        expect(respostaNoEscopoDoAparelho(resposta(2, 32, 51), u(31), carteira)).toBe(true);
        expect(respostaNoEscopoDoAparelho(resposta(3, 32, 52), u(31), carteira)).toBe(false);
        expect(respostaNoEscopoDoAparelho(resposta(4, 32, null), u(31), 'tenant')).toBe(false);
        expect(respostaNoEscopoDoAparelho(resposta(5, 32, 52), u(31), 'tenant')).toBe(true);
    });
});
describe('RF-PES-05: resumo do questionário na lista do BKO', () => {
    it('RF-PES-05: só rascunho → situação rascunho, sem versão vigente', () => {
        const r = resumirQuestionario(quest, [versao({ titulo: 'Gôndola' })], { respostas: 0, atualizado_em: '2026-10-02T00:00:00Z' });
        expect(r).toMatchObject({ id: QUEST, titulo: 'Gôndola', situacao: 'rascunho', versao_vigente: null, tem_rascunho: true, respostas: 0 });
    });
    it('RN-PES-01: com publicada e rascunho aberto, o título e a vigência mostrados são os da vigente', () => {
        const v1 = publicada({ titulo: 'Publicada' });
        const v2 = versao({ id: u(702), numero: 2, titulo: 'Em edição' });
        const r = resumirQuestionario(quest, [v1, v2], { respostas: 7, atualizado_em: '2026-10-03T00:00:00Z' });
        expect(r).toMatchObject({ titulo: 'Publicada', situacao: 'publicada', versao_vigente: 1, tem_rascunho: true, respostas: 7 });
    });
    it('RF-PES-05: arquivado vence tudo', () => {
        const r = resumirQuestionario({ ...quest, arquivado_em: '2026-10-20T00:00:00Z' }, [publicada()], { respostas: 1, atualizado_em: '2026-10-20T00:00:00Z' });
        expect(r.situacao).toBe('arquivado');
    });
    it('filtros da lista: situação e busca no título (sem diferenciar acento e maiúscula)', () => {
        const a = resumirQuestionario(quest, [publicada({ titulo: 'Gôndola do mês', perguntas: [sim_nao(1)] })], { respostas: 0, atualizado_em: '2026-10-02T00:00:00Z' });
        const b = resumirQuestionario({ ...quest, id: u(801) }, [versao({ questionario_id: u(801), titulo: 'Preço' })], { respostas: 0, atualizado_em: '2026-10-04T00:00:00Z' });
        expect(filtrarResumos([a, b], { q: 'gondola' }).map((r) => r.titulo)).toEqual(['Gôndola do mês']);
        expect(filtrarResumos([a, b], { situacao: 'rascunho' }).map((r) => r.titulo)).toEqual(['Preço']);
        expect(filtrarResumos([a, b], {}).map((r) => r.titulo)).toEqual(['Preço', 'Gôndola do mês']);
    });
});
