import { describe, expect, it } from 'vitest';
import { modelosDePerfil } from '@macuxi/platform-sdk';
import { aplicarCopiarDe, conferirTravaOtimista, montarCatalogoPorArea, } from './perfis-cargo';
const modelos = modelosDePerfil([]);
const cat = [
    { chave: 'acesso.bko', area: 'acesso', modulo: 'core', descricao: 'BKO' },
    { chave: 'dados.escopo', area: 'dados', modulo: 'core', descricao: 'Escopo', nivel: 'escopo' },
    { chave: 'pesquisa.responder', area: 'pesquisa', modulo: 'pesquisa', descricao: 'Responder' },
];
describe('catálogo por área (RN-CORE-02, RN-CORE-35)', () => {
    it('RN-CORE-35: agrupa por área na ordem do catálogo e rotula', () => {
        const r = montarCatalogoPorArea(cat, new Set(['core', 'pesquisa']), 3);
        expect(r.versao).toBe(3);
        expect(r.areas.map((a) => a.area)).toEqual(['acesso', 'dados', 'pesquisa']);
        expect(r.areas[0].rotulo).toBeTruthy();
        expect(r.areas[1].chaves[0]).toMatchObject({ nivel: 'escopo', alvos: false, disponivel: true, motivo: null });
    });
    it('RN-CORE-35: chave de módulo sem licença vem indisponível com o motivo; o Core é sempre licenciado', () => {
        const r = montarCatalogoPorArea(cat, new Set(), 1);
        expect(r.areas.find((a) => a.area === 'pesquisa').chaves[0]).toMatchObject({ disponivel: false, motivo: 'MODULO_SEM_LICENCA' });
        expect(r.areas[0].chaves[0].disponivel).toBe(true);
    });
});
describe('copiar de (RN-CORE-35)', () => {
    it('RN-CORE-35: copia as permissões de um modelo, sem vínculo com a origem', () => {
        const r = aplicarCopiarDe({ modelo: 'vendedor' }, 'vendedor', { modelos, perfis: [] });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.permissoes).toEqual(modelos.vendedor.permissoes);
            expect(r.permissoes).not.toBe(modelos.vendedor.permissoes);
        }
    });
    it('RN-CORE-35: a origem não é mutada pela cópia (nem pelo teto do cargo)', () => {
        const perfis = [{ codigo: 'g', permissoes: { 'acesso.campo': {}, 'pedido.criar': {}, 'dados.escopo': { nivel: 'tenant' } } }];
        const antes = JSON.stringify(perfis);
        aplicarCopiarDe({ perfil: 'g' }, 'promotor', { modelos, perfis });
        expect(JSON.stringify(perfis)).toBe(antes);
    });
    it('RN-PRO-01: copiar perfil com pedido.criar para o cargo promotor não leva a escrita de pedido', () => {
        const perfis = [{ codigo: 'v', permissoes: { 'acesso.campo': {}, 'pedido.criar': {} } }];
        const r = aplicarCopiarDe({ perfil: 'v' }, 'promotor', { modelos, perfis });
        expect(r).toEqual({ ok: true, permissoes: { 'acesso.campo': {} } });
    });
    it('RN-CORE-33: copiar o modelo supervisor para o cargo vendedor não leva acesso.gestao nem acesso ao BKO', () => {
        const r = aplicarCopiarDe({ modelo: 'supervisor' }, 'vendedor', { modelos, perfis: [] });
        expect(r.ok).toBe(true);
        if (r.ok) {
            expect(r.permissoes['acesso.gestao']).toBeUndefined();
            expect(r.permissoes['acesso.bko']).toBeUndefined();
        }
    });
    it('RN-CORE-04: o escopo acima do teto do cargo desce ao teto', () => {
        const perfis = [{ codigo: 'g', permissoes: { 'acesso.campo': {}, 'dados.escopo': { nivel: 'tenant' } } }];
        const r = aplicarCopiarDe({ perfil: 'g' }, 'vendedor', { modelos, perfis });
        expect(r).toEqual({ ok: true, permissoes: { 'acesso.campo': {}, 'dados.escopo': { nivel: 'carteira' } } });
    });
    it('RN-CORE-35: copia de um perfil do tenant e recusa perfil inexistente', () => {
        const perfis = [{ codigo: 'a', cargo: 'vendedor', ativo: true, permissoes: { 'acesso.campo': {} } }];
        expect(aplicarCopiarDe({ perfil: 'a' }, 'vendedor', { modelos, perfis })).toEqual({ ok: true, permissoes: { 'acesso.campo': {} } });
        expect(aplicarCopiarDe({ perfil: 'x' }, 'vendedor', { modelos, perfis })).toEqual({ ok: false, codigo: 'PERFIL_NAO_ENCONTRADO' });
    });
});
describe('trava otimista (RN-CORE-35)', () => {
    it('RN-CORE-35: igual passa; diferente vira 409 PERFIL_ALTERADO', () => {
        expect(conferirTravaOtimista('2026-11-25T10:00:00.000Z', '2026-11-25T10:00:00Z')).toEqual({ ok: true });
        expect(conferirTravaOtimista('2026-11-25T10:00:01.000Z', '2026-11-25T10:00:00.000Z')).toEqual({ ok: false, status: 409, codigo: 'PERFIL_ALTERADO' });
    });
});
