import { criarPermissoes, verificarAcao } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { perfisDeFabrica } from '../domain';
import { manifest } from '../manifest';
import { criarRotaDeCep, rotasDeCep } from './cep';
const BRASIL = { street: 'Av. Djalma Batista', neighborhood: 'Flores', city: 'Manaus', state: 'AM' };
const VIA = { logradouro: 'Av. Djalma Batista', bairro: 'Flores', localidade: 'Manaus', uf: 'AM' };
const ESPERADO = { logradouro: 'Av. Djalma Batista', bairro: 'Flores', cidade: 'Manaus', uf: 'AM' };
/** `fetch` falso por host: nenhuma chamada sai para a rede. */
function falso(brasil, via) {
    const urls = [];
    const f = (async (url) => {
        urls.push(url);
        const r = url.includes('brasilapi') ? brasil : via;
        if (r === 'cai')
            throw new Error('timeout');
        return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => r.corpo };
    });
    return { f, urls };
}
const chamar = (f, cep) => {
    const r = criarRotaDeCep(f);
    return r.executar({ query: r.query.parse({ cep }) });
};
const falha = async (p) => p.then(() => null, (e) => ({ status: e.status, codigo: e.codigo }));
describe('RN-CORE-75: GET /core/cep?cep= (pesquisa de CEP do usuário)', () => {
    it('200 com a BrasilAPI e sem tocar no ViaCEP', async () => {
        const { f, urls } = falso({ status: 200, corpo: BRASIL }, { status: 500 });
        expect(await chamar(f, '69053-000')).toEqual(ESPERADO);
        expect(urls).toEqual(['https://brasilapi.com.br/api/cep/v1/69053000']);
    });
    it('cai para o ViaCEP quando a BrasilAPI está fora ou não acha', async () => {
        for (const brasil of ['cai', { status: 503 }, { status: 404 }]) {
            const { f, urls } = falso(brasil, { status: 200, corpo: VIA });
            expect(await chamar(f, '69053000')).toEqual(ESPERADO);
            expect(urls[1]).toBe('https://viacep.com.br/ws/69053000/json/');
        }
    });
    it('404 CEP_NAO_ENCONTRADO quando nenhum dos dois acha', async () => {
        expect(await falha(chamar(falso({ status: 404 }, { status: 200, corpo: { erro: true } }).f, '69053000'))).toEqual({ status: 404, codigo: 'CEP_NAO_ENCONTRADO' });
    });
    it('422 CEP_INVALIDO sem chamar a rede (menos de 8 dígitos), com o texto do formulário', async () => {
        for (const cep of ['123', '69053-00', 'abc']) {
            const { f, urls } = falso({ status: 200, corpo: BRASIL }, { status: 200, corpo: VIA });
            expect(await falha(chamar(f, cep))).toEqual({ status: 422, codigo: 'CEP_INVALIDO' });
            expect(urls).toEqual([]);
        }
    });
    it('RN-CORE-75: 00000000 tem 8 dígitos: segue para a pesquisa e volta 404, nunca a mensagem de 8 dígitos', async () => {
        const { f, urls } = falso({ status: 404 }, { status: 200, corpo: { erro: true } });
        const e = await chamar(f, '00000000').catch((x) => x);
        expect(e).toMatchObject({ status: 404, codigo: 'CEP_NAO_ENCONTRADO' });
        expect(urls.length).toBe(2);
    });
    it('503 CEP_SERVICO_INDISPONIVEL quando os dois estão fora', async () => {
        expect(await falha(chamar(falso('cai', { status: 502 }).f, '69053000'))).toEqual({
            status: 503,
            codigo: 'CEP_SERVICO_INDISPONIVEL',
        });
    });
    it('regra 8: o CEP vai na query, nunca no caminho, (o log de acesso corta a query)', () => {
        const r = rotasDeCep[0];
        expect(r.caminho).toBe('cep');
        expect(r.caminho).not.toContain(':');
        expect(r.params).toBeUndefined();
        expect(r.query).toBeDefined();
    });
    it('RN-CORE-35: a rota pede a ação usuario.ver (perfil, escopo e licença do módulo pelo motor)', () => {
        expect(rotasDeCep).toHaveLength(1);
        expect(rotasDeCep[0].acao).toBe('usuario.ver');
        const p = criarPermissoes([manifest]);
        const admin = {
            id: 'x',
            tenant_id: 'y',
            perfil: 'admin',
            modulos: ['core'],
            perfis: perfisDeFabrica('admin'),
        };
        expect(verificarAcao(admin, p, 'usuario.ver').ok).toBe(true);
        expect(verificarAcao({ ...admin, modulos: [] }, p, 'usuario.ver').ok).toBe(false);
    });
});
