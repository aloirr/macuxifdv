import { describe, expect, it } from 'vitest';
import { matrizDeFabrica, perfilDeFabrica, PERFIS } from '@macuxi/platform-sdk';
import { avaliarEstadoDePerfis, codigoDoPerfil, diffAuditavelDePerfil, sobreposicoesDoDesejado, validarNomeDoPerfil } from './perfis';
const matriz = matrizDeFabrica([]);
const fabrica = PERFIS.map(perfilDeFabrica);
const admin = { id: 'u-admin', ativo: true, perfis: ['admin'] };
const estado = (perfis, usuarios = [admin]) => ({ perfis, usuarios });
describe('perfis de acesso (RN-CORE-35)', () => {
    it('RN-CORE-35: o código do perfil vem do nome, sem acento nem espaço, e nunca colide com o formato', () => {
        expect(codigoDoPerfil('Vendedor Sênior')).toBe('vendedor_senior');
        expect(codigoDoPerfil('  Gerente -- Norte!  ')).toBe('gerente_norte');
        expect(codigoDoPerfil('2024')).toBe('p_2024');
        expect(codigoDoPerfil('x'.repeat(60)).length).toBe(40);
    });
    it('RN-CORE-35: nome vazio ou longo e descrição longa são recusados com a frase da tela', () => {
        expect(validarNomeDoPerfil('  ', null)).toEqual([{ campo: 'nome', mensagem: 'Dê um nome ao perfil.' }]);
        expect(validarNomeDoPerfil('a'.repeat(41), null)[0]?.campo).toBe('nome');
        expect(validarNomeDoPerfil('Ok', 'd'.repeat(201))[0]?.campo).toBe('descricao');
        expect(validarNomeDoPerfil('Ok', 'Para quem vende')).toEqual([]);
    });
    it('RN-CORE-35: só vira sobreposição o que difere da fábrica da base', () => {
        const desejado = { ...matriz.vendedor };
        expect(sobreposicoesDoDesejado('vendedor', desejado, matriz)).toEqual([]);
        const sem = { ...matriz.vendedor };
        delete sem['acesso.campo'];
        expect(sobreposicoesDoDesejado('vendedor', sem, matriz)).toEqual([{ chave: 'acesso.campo', concedida: false }]);
        const mais = { ...matriz.vendedor, 'dados.escopo': { nivel: 'proprio' } };
        expect(sobreposicoesDoDesejado('vendedor', mais, matriz)).toEqual([{ chave: 'dados.escopo', concedida: true, nivel: 'proprio' }]);
    });
    it('RN-CORE-33: vendedor com acesso ao BKO é recusado como TRAVA_DO_PERFIL', () => {
        const v = { ...perfilDeFabrica('vendedor'), sobreposicoes: [{ chave: 'acesso.bko', concedida: true }] };
        const r = avaliarEstadoDePerfis({ atorId: 'u-admin', antes: estado(fabrica), depois: estado([...fabrica.filter((p) => p.codigo !== 'vendedor'), v]), matriz });
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.violacoes[0]).toMatchObject({ codigo: 'TRAVA_DO_PERFIL', regra: 'RN-CORE-33' });
    });
    it('RN-PRO-01: promotor com pedido.criar é recusado', () => {
        const p = { ...perfilDeFabrica('promotor'), sobreposicoes: [{ chave: 'pedido.criar', concedida: true }] };
        const r = avaliarEstadoDePerfis({ atorId: 'u-admin', antes: estado(fabrica), depois: estado([...fabrica.filter((x) => x.codigo !== 'promotor'), p]), matriz });
        expect(r.ok).toBe(false);
    });
    it('RN-CORE-04: escopo acima da base é recusado', () => {
        const v = { ...perfilDeFabrica('vendedor'), sobreposicoes: [{ chave: 'dados.escopo', concedida: true, nivel: 'tenant' }] };
        const r = avaliarEstadoDePerfis({ atorId: 'u-admin', antes: estado(fabrica), depois: estado([...fabrica.filter((x) => x.codigo !== 'vendedor'), v]), matriz });
        expect(r.ok === false && r.violacoes[0]?.codigo).toBe('ESCOPO_ACIMA_DA_BASE');
    });
    it('RN-CORE-35: o admin não tira de si a gestão de perfis (AUTOGESTAO) e a mensagem é a da tela', () => {
        const a = { ...perfilDeFabrica('admin'), sobreposicoes: [{ chave: 'perfil.gerir', concedida: false }] };
        const outro = { id: 'u-outro', ativo: true, perfis: ['admin'] };
        const r = avaliarEstadoDePerfis({ atorId: 'u-admin', antes: estado(fabrica, [admin, outro]), depois: estado([...fabrica.filter((x) => x.codigo !== 'admin'), a], [admin, outro]), matriz });
        expect(r.ok).toBe(false);
        if (!r.ok)
            expect(r.violacoes.map((v) => v.codigo)).toContain('AUTOGESTAO');
    });
    it('RN-CORE-35: a empresa não fica sem admin com a gestão do acesso (ULTIMO_ADMIN)', () => {
        const a = { ...perfilDeFabrica('admin'), sobreposicoes: [{ chave: 'usuario.criar', concedida: false }] };
        const r = avaliarEstadoDePerfis({ antes: estado(fabrica), depois: estado([...fabrica.filter((x) => x.codigo !== 'admin'), a]), matriz });
        expect(r.ok === false && r.violacoes.map((v) => v.codigo)).toContain('ULTIMO_ADMIN');
        expect(r.ok === false && r.violacoes.find((v) => v.codigo === 'ULTIMO_ADMIN')?.mensagem).toMatch(/ficaria sem admin/);
    });
    it('RN-CORE-35: perfil de fábrica não é desativado', () => {
        const v = { ...perfilDeFabrica('vendedor'), ativo: false };
        const r = avaliarEstadoDePerfis({ antes: estado(fabrica), depois: estado([...fabrica.filter((x) => x.codigo !== 'vendedor'), v]), matriz });
        expect(r.ok === false && r.violacoes.map((x) => x.codigo)).toContain('PERFIL_FABRICA_AUSENTE');
    });
    it('RN-CORE-01: desativar perfil que é o único de alguém é recusado (USUARIO_SEM_PERFIL / PERFIL_INDISPONIVEL)', () => {
        const base = { codigo: 'norte', base: 'vendedor', ativo: true, fabrica: false, sobreposicoes: [] };
        const ana = { id: 'u-ana', ativo: true, perfis: ['norte'] };
        const antes = estado([...fabrica, base], [admin, ana]);
        const depois = estado([...fabrica, { ...base, ativo: false }], [admin, ana]);
        const r = avaliarEstadoDePerfis({ atorId: 'u-admin', antes, depois, matriz });
        expect(r.ok).toBe(false);
    });
    it('RN-CORE-35: estado sem violação passa', () => {
        expect(avaliarEstadoDePerfis({ atorId: 'u-admin', antes: estado(fabrica), depois: estado(fabrica), matriz })).toEqual({ ok: true });
    });
    it('RN-AUD-01: o diff da auditoria traz só o que mudou, nas sobreposições', () => {
        const antes = { nome: 'Norte', descricao: null, ativo: true, sobreposicoes: [{ chave: 'a.b', concedida: false }] };
        const depois = { nome: 'Norte', descricao: 'x', ativo: false, sobreposicoes: [{ chave: 'a.b', concedida: false }, { chave: 'c.d', concedida: true, nivel: 'equipe' }] };
        const d = diffAuditavelDePerfil(antes, depois);
        expect(d.campos_alterados).toEqual(['descricao', 'ativo', 'sobreposicoes']);
        expect(d.depois.sobreposicoes).toHaveLength(2);
        expect(d.antes).not.toHaveProperty('nome');
    });
});
