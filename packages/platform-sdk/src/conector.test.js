import { describe, expect, it } from 'vitest';
import { definirModuloApi } from './api';
import { caminhoConectorParaRoteador, definirApiConector, ErroConector, problemasApiConector, RespostaConector, } from './conector';
import { defineModule } from './manifesto';
const integracao = defineModule({ id: 'integracao', versao: '1.0.0', depende: ['core'], perfis: ['admin', 'analista'], apps: { conector: {} } });
const catalogo = defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: ['admin'] });
const rota = (r = {}) => ({ id: 'sinal', metodo: 'POST', caminho: '/sinal', executar: async () => ({}), ...r });
const api = (rotas) => ({ autenticar: async () => ({ ok: false, status: 401, codigo: 'credencial_invalida', mensagem: 'x' }), rotas });
describe('rotas de Conector no SDK (ADR 0013)', () => {
    it('aceita a declaração do módulo com apps.conector', () => {
        const m = definirModuloApi({
            manifesto: integracao,
            conector: api([rota(), rota({ id: 'consultar_lote', metodo: 'GET', caminho: '/lotes/{id}' }), rota({ id: 'enviar_lote', caminho: '/lotes', status: 202, limiteCorpoBytes: 8 * 1024 * 1024, maxElementosCorpo: 1_000_000 })]),
        });
        expect(m.conector?.rotas).toHaveLength(3);
    });
    it('só módulo com apps.conector declara rotas de Conector', () => {
        expect(() => definirModuloApi({ manifesto: catalogo, conector: api([rota()]) })).toThrow(/apps\.conector/);
    });
    it('recusa id repetido, método+caminho repetido, caminho fora do formato e limites fora da faixa', () => {
        const p = problemasApiConector(integracao, api([
            rota(),
            rota({ caminho: '/outro' }),
            rota({ id: 'b', caminho: '/lotes/{id}', metodo: 'GET' }),
            rota({ id: 'c', caminho: '/lotes/{lote}', metodo: 'GET' }),
            rota({ id: 'd', caminho: 'sem-barra' }),
            rota({ id: 'e', caminho: '/x/:id' }),
            rota({ id: 'f', caminho: '/f', limiteCorpoBytes: 64 * 1024 * 1024 }),
            rota({ id: 'g', caminho: '/g', maxElementosCorpo: 0 }),
            rota({ id: 'Maiuscula', caminho: '/h' }),
        ]));
        expect(p.join('\n')).toMatch(/id sinal repetido/);
        expect(p.join('\n')).toMatch(/GET \/integracao\/v1\/lotes\/\{lote\}: método e caminho repetidos/);
        expect(p.filter((x) => x.includes('caminho inválido'))).toHaveLength(2);
        expect(p.join('\n')).toMatch(/limiteCorpoBytes/);
        expect(p.join('\n')).toMatch(/maxElementosCorpo/);
        expect(p.join('\n')).toMatch(/id da rota inválido/);
        expect(problemasApiConector(integracao, api([]))).toEqual(['conector: declare ao menos uma rota']);
        expect(problemasApiConector(integracao, undefined)).toEqual([]);
    });
    it('caminho {param} vira :param para o roteador', () => {
        expect(caminhoConectorParaRoteador('/pedidos/{pedido_uuid}/retorno')).toBe('/pedidos/:pedido_uuid/retorno');
    });
    it('ErroConector: status do Hub, corpo ErroApi com extras, Retry-After obrigatório em 429/503', () => {
        const e = new ErroConector(422, { codigo: 'envelope_invalido', mensagem: 'Lote inválido.', erros: [{ codigo: 'x', campo: null, mensagem: 'y' }] });
        expect(e.corpo.erros).toHaveLength(1);
        expect(new ErroConector(429, { codigo: 'limite_de_taxa', mensagem: 'Aguarde.' }, { 'Retry-After': '3' }).cabecalhos).toEqual({ 'retry-after': '3' });
        expect(() => new ErroConector(429, { codigo: 'limite_de_taxa', mensagem: 'Aguarde.' })).toThrow(/retry-after/);
        expect(() => new ErroConector(503, { codigo: 'servico_indisponivel', mensagem: 'x' }, { 'retry-after': '0' })).toThrow(/retry-after/);
        expect(() => new ErroConector(500, { codigo: 'x', mensagem: 'y' })).toThrow(/não é de rota de Conector/);
        expect(() => new ErroConector(400, { codigo: '', mensagem: 'y' })).toThrow(/codigo/);
        expect(() => new ErroConector(400, { codigo: 'x', mensagem: 'y', detalhes: [] })).toThrow(/detalhes/);
        expect(() => new ErroConector(400, { codigo: 'x', mensagem: 'y', requisicao_id: 'r' })).toThrow(/plataforma/);
    });
    it('RespostaConector só com status de sucesso; definirApiConector preserva a declaração', () => {
        expect(new RespostaConector({ a: 1 }, { status: 202, cabecalhos: { 'idempotent-replay': 'true' } }).opcoes.status).toBe(202);
        expect(() => new RespostaConector({}, { status: 409 })).toThrow(/sucesso/);
        const a = api([rota()]);
        expect(definirApiConector(a)).toBe(a);
    });
});
