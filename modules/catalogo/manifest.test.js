import { describe, expect, it } from 'vitest';
import manifest from './manifest';
describe('manifesto do catalogo', () => {
    it('é válido no platform-sdk e oferece produto.acoes', () => {
        expect(manifest.id).toBe('catalogo');
        expect(manifest.ofereceExtensoes).toContain('produto.acoes');
    });
    it('ADR-0005: produto base é do Core; o Catálogo sincroniza preço, estoque e conteúdo', () => {
        expect(manifest.sync).not.toContain('produto');
        expect(manifest.sync).toEqual(expect.arrayContaining(['tabela_preco', 'tabela_preco_item', 'deposito', 'estoque_saldo', 'categoria', 'marca', 'produto_atributo', 'produto_midia', 'produto_conteudo', 'sinonimo']));
    });
    it('ADR-0005 + T-0061: o cadastro do produto é do Core; o Catálogo lê do evento de produto só o nó da árvore (RF-CAT-04) e reage a preço, estoque e árvore', () => {
        expect(manifest.consome).toEqual(expect.arrayContaining(['integracao.preco.atualizado@1', 'integracao.estoque.atualizado@1', 'integracao.catalogo_no.atualizado@1', 'integracao.produto.atualizado@1']));
        expect(manifest.sync).toEqual(expect.arrayContaining(['catalogo_no', 'produto_no']));
    });
    it('doc 03 §2: consulta para os perfis de campo e de gestão', () => {
        for (const acao of ['produto.consultar', 'produto.perguntar']) {
            expect(manifest.acoes[acao]?.perfis, acao).toEqual(expect.arrayContaining(['vendedor', 'promotor', 'supervisor', 'gerente', 'analista']));
        }
    });
    it('doc 03 §2: conteúdo, sinônimos, destaques e termos sem resultado só para analista e admin', () => {
        for (const acao of ['produto.enriquecer', 'sinonimo.gerenciar', 'destaque.gerenciar', 'busca.ver_sem_resultado']) {
            expect([...(manifest.acoes[acao]?.perfis ?? [])].sort(), acao).toEqual(['admin', 'analista']);
        }
    });
    it('todo perfil com ação do Catálogo está entre os perfis do módulo', () => {
        const perfis = new Set(manifest.perfis);
        for (const [acao, def] of Object.entries(manifest.acoes))
            for (const p of def.perfis)
                expect(perfis.has(p), `${acao}: ${p}`).toBe(true);
    });
    it('RN-PRO-01: o Catálogo não declara nenhuma ação de pedido (é do Vendedor, via produto.acoes)', () => {
        expect(Object.keys(manifest.acoes).filter((a) => /^pedido/.test(a))).toEqual([]);
    });
});
