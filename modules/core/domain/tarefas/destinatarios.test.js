import { describe, expect, it } from 'vitest';
import { TAREFA_DESTINATARIOS_MAX, TIPOS_TAREFA } from '../../contracts/tarefa';
import { expandirDestinatarios, tipoPermitidoParaPerfil, TIPO_ENVOLVE_PEDIDO } from './destinatarios';
const u = (n) => `0c000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const EQ_NORTE = '0e000000-0000-4000-8000-000000000001';
const EQ_SUL = '0e000000-0000-4000-8000-000000000002';
const ANA = { id: u(1), perfil: 'vendedor', ativo: true, equipe_id: EQ_NORTE };
const BRUNO = { id: u(2), perfil: 'promotor', ativo: true, equipe_id: EQ_NORTE };
const CAIO = { id: u(3), perfil: 'vendedor', ativo: false, equipe_id: EQ_NORTE };
const DORA = { id: u(4), perfil: 'supervisor', ativo: true, equipe_id: EQ_NORTE };
const EVA = { id: u(5), perfil: 'vendedor', ativo: true, equipe_id: EQ_SUL };
const VISIVEIS = [ANA, BRUNO, CAIO, DORA, EVA];
const entrada = (p) => ({
    destino: { alvo: 'todos' },
    tipo: 'simples',
    visiveis: VISIVEIS,
    com_cliente_na_carteira: null,
    ...p,
});
describe('RN-CORE-TAR-01: expandirDestinatarios (equipe do dia da criação, D2)', () => {
    it('RN-CORE-TAR-01: "todos" = consultores (vendedor ou promotor) ativos do escopo de quem cria', () => {
        expect(expandirDestinatarios(entrada({}))).toEqual({ ok: true, usuario_ids: [ANA.id, BRUNO.id, EVA.id] });
    });
    it('RN-CORE-TAR-01: "equipe" = consultores ativos da equipe hoje; quem entrar depois não recebe (a lista sai na criação)', () => {
        const hoje = expandirDestinatarios(entrada({ destino: { alvo: 'equipe', equipe_id: EQ_NORTE } }));
        expect(hoje).toEqual({ ok: true, usuario_ids: [ANA.id, BRUNO.id] });
        const depois = expandirDestinatarios(entrada({ destino: { alvo: 'equipe', equipe_id: EQ_NORTE }, visiveis: [...VISIVEIS, { ...EVA, equipe_id: EQ_NORTE }] }));
        expect(depois).toEqual({ ok: true, usuario_ids: [ANA.id, BRUNO.id, EVA.id] });
        expect(hoje.ok && hoje.usuario_ids).not.toContain(EVA.id);
    });
    it('RN-CORE-TAR-01: equipe sem consultor ativo no escopo = DESTINATARIO_VAZIO', () => {
        expect(expandirDestinatarios(entrada({ destino: { alvo: 'equipe', equipe_id: '0e000000-0000-4000-8000-000000000009' } }))).toEqual({
            ok: false,
            status: 422,
            codigo: 'DESTINATARIO_VAZIO',
            usuario_ids: [],
        });
    });
    it('RN-CORE-TAR-01: "usuarios" sem repetir a mesma pessoa', () => {
        expect(expandirDestinatarios(entrada({ destino: { alvo: 'usuarios', usuario_ids: [EVA.id, ANA.id, EVA.id] } }))).toEqual({ ok: true, usuario_ids: [ANA.id, EVA.id] });
    });
    it('RN-CORE-04: pessoa fora do escopo de quem cria = 403 FORA_DO_ESCOPO', () => {
        const fora = '0c000000-0000-4000-8000-000000000099';
        expect(expandirDestinatarios(entrada({ destino: { alvo: 'usuarios', usuario_ids: [ANA.id, fora] } }))).toEqual({ ok: false, status: 403, codigo: 'FORA_DO_ESCOPO', usuario_ids: [fora] });
    });
    it('RN-CORE-TAR-10: usuário inativo não pode ser escolhido (422)', () => {
        expect(expandirDestinatarios(entrada({ destino: { alvo: 'usuarios', usuario_ids: [CAIO.id] } }))).toEqual({ ok: false, status: 422, codigo: 'RN-CORE-TAR-10', usuario_ids: [CAIO.id] });
    });
    it('RN-CORE-TAR-01: só consultor recebe tarefa (supervisor escolhido = 422)', () => {
        expect(expandirDestinatarios(entrada({ destino: { alvo: 'usuarios', usuario_ids: [DORA.id] } }))).toEqual({ ok: false, status: 422, codigo: 'RN-CORE-TAR-01', usuario_ids: [DORA.id] });
    });
    it('RN-CORE-TAR-01: no máximo 500 destinatários por criação', () => {
        const muitos = Array.from({ length: TAREFA_DESTINATARIOS_MAX + 1 }, (_, i) => ({ id: u(1000 + i), perfil: 'vendedor', ativo: true, equipe_id: null }));
        expect(expandirDestinatarios(entrada({ visiveis: muitos }))).toMatchObject({ ok: false, status: 422, codigo: 'RN-CORE-TAR-01', usuario_ids: [] });
        expect(expandirDestinatarios(entrada({ visiveis: muitos.slice(1) })).ok).toBe(true);
    });
});
describe('RN-CORE-TAR-04: tarefa com cliente', () => {
    const carteira = new Set([ANA.id, EVA.id]);
    it('RN-CORE-TAR-04: "usuarios" exige o cliente na carteira de todos (422 com quem não tem)', () => {
        expect(expandirDestinatarios(entrada({ destino: { alvo: 'usuarios', usuario_ids: [ANA.id, BRUNO.id] }, com_cliente_na_carteira: carteira }))).toEqual({
            ok: false,
            status: 422,
            codigo: 'RN-CORE-TAR-04',
            usuario_ids: [BRUNO.id],
        });
    });
    it('RN-CORE-TAR-04: "equipe" e "todos" vão só a quem tem o cliente na carteira', () => {
        expect(expandirDestinatarios(entrada({ com_cliente_na_carteira: carteira }))).toEqual({ ok: true, usuario_ids: [ANA.id, EVA.id] });
        expect(expandirDestinatarios(entrada({ destino: { alvo: 'equipe', equipe_id: EQ_SUL }, com_cliente_na_carteira: new Set([ANA.id]) }))).toMatchObject({
            ok: false,
            codigo: 'DESTINATARIO_VAZIO',
        });
    });
});
describe('RN-CORE-TAR-03: tarefa de pesquisa', () => {
    it('RN-CORE-TAR-03: todo destinatário precisa poder responder (Pesquisa efetiva e no público), em qualquer destino', () => {
        const podem = new Set([ANA.id]);
        expect(expandirDestinatarios(entrada({ tipo: 'pesquisa', podem_responder_pesquisa: podem }))).toEqual({
            ok: false,
            status: 422,
            codigo: 'RN-CORE-TAR-03',
            usuario_ids: [BRUNO.id, EVA.id],
        });
        expect(expandirDestinatarios(entrada({ tipo: 'pesquisa', destino: { alvo: 'usuarios', usuario_ids: [ANA.id] }, podem_responder_pesquisa: podem })).ok).toBe(true);
    });
    it('RN-CORE-TAR-03: sem a lista de quem pode responder, ninguém pode (o tipo some sem a Pesquisa)', () => {
        expect(expandirDestinatarios(entrada({ tipo: 'pesquisa', destino: { alvo: 'usuarios', usuario_ids: [ANA.id] } }))).toMatchObject({ ok: false, codigo: 'RN-CORE-TAR-03' });
    });
});
describe('RN-PRO-01 / RN-CORE-TAR-12: tipoPermitidoParaPerfil (pelo perfil, não pelo módulo)', () => {
    it('RN-PRO-01: nenhum tipo de hoje envolve pedido; o promotor recebe os três', () => {
        for (const t of TIPOS_TAREFA) {
            expect(TIPO_ENVOLVE_PEDIDO[t]).toBe(false);
            expect(tipoPermitidoParaPerfil(t, 'promotor')).toBe(true);
        }
    });
    it('RN-PRO-01: um tipo que envolva pedido é recusado para o promotor e aceito para o vendedor', () => {
        const regra = { ...TIPO_ENVOLVE_PEDIDO, simples: true };
        expect(tipoPermitidoParaPerfil('simples', 'promotor', regra)).toBe(false);
        expect(tipoPermitidoParaPerfil('simples', 'vendedor', regra)).toBe(true);
    });
    it('RN-PRO-01: promotor escolhido para um tipo com pedido = 403; no grupo, ele fica de fora', () => {
        const regra = { ...TIPO_ENVOLVE_PEDIDO, simples: true };
        expect(expandirDestinatarios(entrada({ destino: { alvo: 'usuarios', usuario_ids: [BRUNO.id] } }), regra)).toEqual({ ok: false, status: 403, codigo: 'RN-PRO-01', usuario_ids: [BRUNO.id] });
        expect(expandirDestinatarios(entrada({}), regra)).toEqual({ ok: true, usuario_ids: [ANA.id, EVA.id] });
    });
});
