import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { modulosEfetivos } from './modulos-efetivos';
const todos = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'];
const manifestos = [
    defineModule({ id: 'core', versao: '1.0.0', perfis: [...todos] }),
    defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'] }),
    defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], opcionais: ['catalogo'], perfis: ['vendedor'] }),
    defineModule({ id: 'gestor', versao: '1.0.0', depende: ['core', 'vendedor'], perfis: ['supervisor'] }),
    defineModule({ id: 'pesquisa', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'] }),
];
describe('módulos efetivos do usuário', () => {
    it('RN-CORE-01: ativos do tenant ∩ padrão do perfil; core sempre', () => {
        expect(modulosEfetivos({ manifestos, ativosNoTenant: ['catalogo', 'vendedor'], doPerfil: ['vendedor', 'pesquisa'] })).toEqual(['core', 'vendedor']);
        expect(modulosEfetivos({ manifestos, ativosNoTenant: [], doPerfil: [] })).toEqual(['core']);
    });
    it('RN-CORE-01: exceção do usuário só remove (Sprint 0); remover core não tem efeito', () => {
        const base = { manifestos, ativosNoTenant: ['catalogo', 'vendedor'], doPerfil: ['catalogo', 'vendedor'] };
        expect(modulosEfetivos({ ...base, removidosDoUsuario: ['catalogo'] })).toEqual(['core', 'vendedor']);
        expect(modulosEfetivos({ ...base, removidosDoUsuario: ['vendedor', 'core'] })).toEqual(['core', 'catalogo']);
    });
    it('RN-CORE-03: módulo sem dependência obrigatória ativa sai (em cascata); opcional ausente não derruba', () => {
        expect(modulosEfetivos({ manifestos, ativosNoTenant: ['gestor'], doPerfil: ['gestor'] })).toEqual(['core']);
        expect(modulosEfetivos({ manifestos, ativosNoTenant: ['gestor', 'vendedor'], doPerfil: ['gestor', 'vendedor'] })).toEqual(['core', 'vendedor', 'gestor']);
    });
});
