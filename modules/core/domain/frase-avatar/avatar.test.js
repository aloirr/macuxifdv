import { describe, expect, it } from 'vitest';
import { aplicarTrocaAvatar, escolhaAtual } from './avatar';
const U = '0a000000-0000-4000-8000-000000000001';
const OUTRO = '0a000000-0000-4000-8000-000000000002';
const T1 = '0a000000-0000-4000-8000-0000000000a1';
const T2 = '0a000000-0000-4000-8000-0000000000a2';
const ARQ = '0a000000-0000-4000-8000-0000000000f1';
const AGORA = new Date('2026-11-13T12:00:00Z');
const troca = (p = {}) => ({
    id: T2,
    usuario_id: U,
    tipo: 'avatar',
    avatar_codigo: 'f2',
    arquivo_id: null,
    alterado_em: '2026-11-13T11:00:00.000Z',
    ...p,
});
const viva = (p = {}) => ({
    id: T1,
    usuario_id: U,
    tipo: 'foto',
    avatar_codigo: null,
    arquivo_id: ARQ,
    alterado_em: '2026-11-13T10:00:00.000Z',
    ...p,
});
const app = { usuario_id: U, pode_trocar_outro: false, agora: AGORA };
describe('RN-CORE-42: aplicarTrocaAvatar (a última troca vence pelo alterado_em)', () => {
    it('RN-CORE-42: caso normal apaga a viva (e a foto dela) e grava a nova como viva', () => {
        expect(aplicarTrocaAvatar(viva(), [], troca(), app)).toEqual({
            acao: 'substituir',
            alterado_em: '2026-11-13T11:00:00.000Z',
            apagar_id: T1,
            apagar_arquivo_id: ARQ,
        });
    });
    it('RN-CORE-42: sem escolha anterior (iniciais), só grava', () => {
        expect(aplicarTrocaAvatar(null, [], troca(), app)).toEqual({ acao: 'substituir', alterado_em: '2026-11-13T11:00:00.000Z', apagar_id: null, apagar_arquivo_id: null });
    });
    it('RN-CORE-42: a viva sendo avatar, não há arquivo para apagar', () => {
        expect(aplicarTrocaAvatar(viva({ tipo: 'avatar', avatar_codigo: 'm1', arquivo_id: null }), [], troca(), app)).toMatchObject({ apagar_arquivo_id: null });
    });
    it('RN-CORE-42: id já gravado = aceito sem mudança (reenvio da fila)', () => {
        expect(aplicarTrocaAvatar(viva(), [T2], troca(), app)).toEqual({ acao: 'nada' });
    });
    it('RN-CORE-42: troca do aparelho offline mais antiga que a viva (BKO trocou depois) fica gravada como superada', () => {
        const r = aplicarTrocaAvatar(viva({ alterado_em: '2026-11-13T11:30:00.000Z' }), [], troca(), app);
        expect(r).toEqual({ acao: 'gravar_superada', alterado_em: '2026-11-13T11:00:00.000Z' });
    });
    it('RN-CORE-42: no empate do alterado_em, vale a que chegou por último', () => {
        expect(aplicarTrocaAvatar(viva({ alterado_em: '2026-11-13T11:00:00.000Z' }), [], troca(), app).acao).toBe('substituir');
    });
    it('RN-CORE-42: relógio do aparelho mais de 24 h adiantado grava com o horário do servidor', () => {
        const r = aplicarTrocaAvatar(viva(), [], troca({ alterado_em: '2026-11-15T00:00:00.000Z' }), app);
        expect(r).toMatchObject({ acao: 'substituir', alterado_em: AGORA.toISOString() });
        expect(aplicarTrocaAvatar(viva(), [], troca({ alterado_em: '2026-11-14T11:59:00.000Z' }), app)).toMatchObject({ alterado_em: '2026-11-14T11:59:00.000Z' });
    });
    it('RN-CORE-42: compara instantes, não textos (fuso diferente no alterado_em)', () => {
        const r = aplicarTrocaAvatar(viva({ alterado_em: '2026-11-13 10:30:00+00' }), [], troca({ alterado_em: '2026-11-13T07:00:00.000-04:00' }), app);
        expect(r.acao).toBe('substituir');
    });
    it('RN-CORE-42: o vendedor troca só a própria (FORA_DO_ESCOPO)', () => {
        expect(aplicarTrocaAvatar(null, [], troca({ usuario_id: OUTRO }), app)).toEqual({ acao: 'recusar', codigo: 'FORA_DO_ESCOPO' });
    });
    it('RN-CORE-42: quem edita usuários no BKO troca a de outro', () => {
        expect(aplicarTrocaAvatar(null, [], troca({ usuario_id: OUTRO }), { ...app, pode_trocar_outro: true }).acao).toBe('substituir');
    });
    it('RN-CORE-42: a viva tem de ser do mesmo usuário da troca', () => {
        expect(() => aplicarTrocaAvatar(viva({ usuario_id: OUTRO }), [], troca(), app)).toThrow(RangeError);
    });
});
describe('RN-CORE-42: escolhaAtual (o que o Início mostra)', () => {
    it('RN-CORE-42: padrão = iniciais (sem linha viva)', () => {
        expect(escolhaAtual([], U)).toEqual({ tipo: 'iniciais' });
    });
    it('RN-CORE-42: avatar e foto', () => {
        expect(escolhaAtual([viva({ tipo: 'avatar', avatar_codigo: 'm3', arquivo_id: null })], U)).toEqual({ tipo: 'avatar', avatar_codigo: 'm3' });
        expect(escolhaAtual([viva()], U)).toEqual({ tipo: 'foto', arquivo_id: ARQ });
    });
    it('RN-CORE-42: a linha "iniciais" é a volta ao padrão', () => {
        expect(escolhaAtual([viva({ tipo: 'iniciais', arquivo_id: null })], U)).toEqual({ tipo: 'iniciais' });
    });
    it('RN-CORE-42: ignora removidas e as de outros usuários; mais de uma viva = a de maior alterado_em', () => {
        const linhas = [
            { ...viva({ id: T1, tipo: 'avatar', avatar_codigo: 'f1', arquivo_id: null }), deleted_at: '2026-11-13T10:00:00Z' },
            viva({ id: T2, usuario_id: OUTRO, tipo: 'avatar', avatar_codigo: 'm1', arquivo_id: null }),
            viva({ id: '0a000000-0000-4000-8000-0000000000a3', tipo: 'avatar', avatar_codigo: 'm2', arquivo_id: null, alterado_em: '2026-11-12T10:00:00Z' }),
            viva({ id: '0a000000-0000-4000-8000-0000000000a4', tipo: 'avatar', avatar_codigo: 'f3', arquivo_id: null, alterado_em: '2026-11-13T09:00:00Z' }),
        ];
        expect(escolhaAtual(linhas, U)).toEqual({ tipo: 'avatar', avatar_codigo: 'f3' });
    });
});
