import { describe, expect, it } from 'vitest';
import { decidirColisaoEscalonada, planejarCadastroCatalogoDoErp, planejarEscalonadaDoErp, planejarEstoqueDoErp, planejarNoDoErp, planejarPrecoDoErp, planejarProdutoNoDoErp, planejarVinculoTabelaDoErp, precoDoErpEhDaBase } from './erp';
const preco = (extra = {}) => ({
    external_id: 'PR-1',
    acao: 'criado',
    registro: { tabela_external_id: 'T1', tabela_nome: 'Atacado', vigencia_inicio: '2026-11-01', vigencia_fim: null, produto_external_id: 'P-1', preco_cents: 1500, ...extra },
});
const estoque = (extra = {}) => ({
    external_id: 'ES-1',
    acao: 'atualizado',
    registro: { deposito_external_id: 'D1', deposito_nome: 'Matriz', produto_external_id: 'P-1', saldo: 12.5, ...extra },
});
describe('RN-INT-02: preço do ERP vira item de tabela do Catálogo', () => {
    it('RN-INT-02: preço válido vira upsert com tabela, produto, vigência e centavos', () => {
        expect(planejarPrecoDoErp(preco())).toEqual({
            tipo: 'upsert',
            linha: { external_id: 'PR-1', tabela_external_id: 'T1', tabela_nome: 'Atacado', produto_external_id: 'P-1', preco_cents: 1500, vigencia_inicio: '2026-11-01', vigencia_fim: null, filial_external_id: null },
        });
    });
    it('RN-INT-02: ação inativado, registro inativo ou preço zerado inativam o item (nunca apagam)', () => {
        expect(planejarPrecoDoErp({ external_id: 'PR-1', acao: 'inativado' })).toEqual({ tipo: 'inativar', external_id: 'PR-1' });
        expect(planejarPrecoDoErp(preco({ ativo: false }))).toEqual({ tipo: 'inativar', external_id: 'PR-1' });
        expect(planejarPrecoDoErp(preco({ preco_cents: 0 }))).toEqual({ tipo: 'inativar', external_id: 'PR-1' });
    });
    it('RN-INT-02: evento sem registro e sem ser inativação é ignorado', () => {
        expect(planejarPrecoDoErp({ external_id: 'PR-1', acao: 'atualizado' })).toEqual({ tipo: 'ignorar' });
    });
    it('RN-INT-02: nome da tabela vazio usa o código da tabela', () => {
        const p = planejarPrecoDoErp(preco({ tabela_nome: '  ' }));
        expect(p.tipo === 'upsert' && p.linha.tabela_nome).toBe('T1');
    });
});
describe('RN-INT-02 / RF-CAT-03: saldo de estoque do ERP', () => {
    it('RF-CAT-03: saldo vira upsert por depósito e produto; nome do depósito ausente usa o código', () => {
        expect(planejarEstoqueDoErp(estoque({ deposito_nome: null }))).toEqual({
            tipo: 'upsert',
            linha: { external_id: 'ES-1', deposito_external_id: 'D1', deposito_nome: 'D1', produto_external_id: 'P-1', saldo: 12.5 },
        });
    });
    it('RN-INT-02: inativado ou registro inativo zera/inativa o saldo; sem registro é ignorado', () => {
        expect(planejarEstoqueDoErp({ external_id: 'ES-1', acao: 'inativado' })).toEqual({ tipo: 'inativar', external_id: 'ES-1' });
        expect(planejarEstoqueDoErp(estoque({ ativo: false }))).toEqual({ tipo: 'inativar', external_id: 'ES-1' });
        expect(planejarEstoqueDoErp({ external_id: 'ES-1', acao: 'criado' })).toEqual({ tipo: 'ignorar' });
    });
});
describe('RF-CAT-04: árvore do catálogo vinda do ERP (integracao.catalogo_no.atualizado@1)', () => {
    const no = (extra = {}) => ({
        external_id: 'N-2',
        acao: 'criado',
        registro: { codigo: ' REF ', nome: ' Refrigerantes ', pai_external_id: 'N-1', nivel: 2, ordem: 3, ...extra },
    });
    it('RF-CAT-04: nó válido vira upsert com código e nome aparados e o pai pelo external_id', () => {
        expect(planejarNoDoErp(no())).toEqual({ tipo: 'upsert', linha: { external_id: 'N-2', codigo: 'REF', nome: 'Refrigerantes', pai_external_id: 'N-1', nivel: 2, ordem: 3 } });
    });
    it('RF-CAT-04: sem pai é raiz de nível 1', () => {
        expect(planejarNoDoErp(no({ pai_external_id: null, nivel: 1 }))).toMatchObject({ tipo: 'upsert', linha: { pai_external_id: null, nivel: 1 } });
    });
    it('RF-CAT-04: raiz com nível diferente de 1, ou filho no nível 1, é ignorado (o banco recusaria; o dado do ERP não trava a fila)', () => {
        expect(planejarNoDoErp(no({ pai_external_id: null, nivel: 2 }))).toEqual({ tipo: 'ignorar' });
        expect(planejarNoDoErp(no({ nivel: 1 }))).toEqual({ tipo: 'ignorar' });
    });
    it('RF-CAT-04: nó inativado pelo ERP some da árvore (soft delete), nunca é apagado', () => {
        expect(planejarNoDoErp({ external_id: 'N-2', acao: 'inativado' })).toEqual({ tipo: 'inativar', external_id: 'N-2' });
        expect(planejarNoDoErp(no({ ativo: false }))).toEqual({ tipo: 'inativar', external_id: 'N-2' });
    });
    it('RF-CAT-04: evento sem registro e sem ser inativação é ignorado; nome vazio também', () => {
        expect(planejarNoDoErp({ external_id: 'N-2', acao: 'atualizado' })).toEqual({ tipo: 'ignorar' });
        expect(planejarNoDoErp(no({ nome: '  ' }))).toEqual({ tipo: 'ignorar' });
    });
});
describe('RF-CAT-04: vínculo produto → nó (campo catalogo_no_external_id de integracao.produto.atualizado@1)', () => {
    it('RF-CAT-04: produto com nó vira vínculo; o external_id do vínculo é determinístico (reentrega não duplica)', () => {
        expect(planejarProdutoNoDoErp({ external_id: 'P-1', acao: 'atualizado', registro: { catalogo_no_external_id: 'N-2' } })).toEqual({ tipo: 'vincular', produto_external_id: 'P-1', no_external_id: 'N-2', external_id: 'P-1' });
    });
    it('RF-CAT-04: produto sem nó, ou inativado, solta o vínculo', () => {
        expect(planejarProdutoNoDoErp({ external_id: 'P-1', acao: 'atualizado', registro: { catalogo_no_external_id: null } })).toEqual({ tipo: 'desvincular', produto_external_id: 'P-1' });
        expect(planejarProdutoNoDoErp({ external_id: 'P-1', acao: 'inativado' })).toEqual({ tipo: 'desvincular', produto_external_id: 'P-1' });
    });
    it('RF-CAT-04: evento sem registro e sem ser inativação é ignorado', () => {
        expect(planejarProdutoNoDoErp({ external_id: 'P-1', acao: 'atualizado' })).toEqual({ tipo: 'ignorar' });
    });
});
describe('RN-CAT-11 / RN-CAT-09: cadastro do Catálogo vindo do ERP (aplicação, oferece junto, etiquetas)', () => {
    const evento = (registro, acao = 'atualizado') => ({ external_id: 'P1', acao, ...(registro ? { registro } : {}) });
    const plano = (registro, max = 2000, acao = 'atualizado') => planejarCadastroCatalogoDoErp(evento(registro, acao), { aplicacaoMax: max });
    it('RN-CAT-11: campo ausente não altera nada; null ou vazio limpa a aplicação', () => {
        expect(plano({})).toEqual({});
        expect(plano({ aplicacao: null })).toEqual({ aplicacao: null });
        expect(plano({ aplicacao: '   ' })).toEqual({ aplicacao: null });
    });
    it('RN-CAT-11: corta de novo no aplicacao_max_cadastro do tenant, sem aviso', () => {
        expect(plano({ aplicacao: 'x'.repeat(300) }, 100).aplicacao).toHaveLength(100);
        expect(plano({ aplicacao: ' Fiat Uno 2010–2014 ' }).aplicacao).toBe('Fiat Uno 2010–2014');
    });
    it('RN-CAT-09: oferece junto fica nos 5 primeiros, sem repetir e sem o próprio produto', () => {
        expect(plano({ oferece_junto: ['A', 'B', 'A', 'P1', 'C', 'D', 'E', 'F', 'G'] }).ofereceJunto).toEqual(['A', 'B', 'C', 'D', 'E']);
        expect(plano({ oferece_junto: null })).toEqual({ ofereceJunto: [] });
    });
    it('RN-CAT-09: etiquetas ficam nas 4 primeiras, de até 20 caracteres', () => {
        expect(plano({ etiquetas: ['Dianteira', 'Novo', 'x'.repeat(25), 'D', 'E'] }).etiquetas).toEqual(['Dianteira', 'Novo', 'x'.repeat(20), 'D']);
    });
    it('RN-CAT-11: produto inativado ou evento sem registro não altera o cadastro', () => {
        expect(plano({ aplicacao: 'x' }, 2000, 'inativado')).toEqual({});
        expect(planejarCadastroCatalogoDoErp(evento(undefined), { aplicacaoMax: 2000 })).toEqual({});
    });
});
describe('RN-VEN-15 (nova): preço do ERP com unidade diferente da base não vira preço da UN', () => {
    it('RN-VEN-15: a linha com unidade segue no plano com a sigla, para o consumidor conferir com a base do produto e avisar', () => {
        const p = planejarPrecoDoErp(preco({ unidade: ' CX ' }));
        expect(p.tipo === 'upsert' && p.linha.unidade).toBe('CX');
    });
    it('RN-VEN-15: unidade vazia ou ausente = unidade base (sem o campo na linha)', () => {
        for (const u of [undefined, null, '  '])
            expect(planejarPrecoDoErp(preco({ unidade: u }))).toMatchObject({ tipo: 'upsert' });
        const p = planejarPrecoDoErp(preco({ unidade: '  ' }));
        expect(p.tipo === 'upsert' && 'unidade' in p.linha).toBe(false);
    });
    it('RN-VEN-15: só vale como preço da UN a unidade igual à base do produto (sem diferenciar maiúsculas)', () => {
        expect(precoDoErpEhDaBase('UN', 'un')).toBe(true);
        expect(precoDoErpEhDaBase(undefined, 'UN')).toBe(true);
        expect(precoDoErpEhDaBase('CX', 'UN')).toBe(false);
        expect(precoDoErpEhDaBase('CX', null)).toBe(false);
    });
});
const escalonada = (extra = {}) => ({
    external_id: 'ESC-1',
    acao: 'criado',
    registro: { produto_external_id: 'P-1', medida: 'FD', quantidade_minima: 10, preco_unidade_cents: 900, vigencia_inicio: '2026-11-01', vigencia_fim: null, tabela_external_id: null, ...extra },
});
describe('RN-VEN-23: tabela escalonada do ERP vira faixa do Catálogo', () => {
    it('RN-VEN-23: faixa válida vira upsert com produto, medida, mínimo, preço da unidade base, vigência e tabela', () => {
        expect(planejarEscalonadaDoErp(escalonada({ tabela_external_id: 'T1' }))).toEqual({
            tipo: 'upsert',
            linha: { external_id: 'ESC-1', produto_external_id: 'P-1', medida: 'FD', quantidade_minima: 10, preco_unidade_cents: 900, vigencia_inicio: '2026-11-01', vigencia_fim: null, tabela_external_id: 'T1', filial_external_id: null },
        });
    });
    it('RN-VEN-23: medida e tabela ausentes = unidade base e todas as tabelas', () => {
        const p = planejarEscalonadaDoErp(escalonada({ medida: undefined, tabela_external_id: undefined }));
        expect(p.tipo === 'upsert' && [p.linha.medida, p.linha.tabela_external_id]).toEqual([null, null]);
    });
    it('RN-VEN-23: ação inativado ou registro inativo inativam a faixa (nunca apagam)', () => {
        expect(planejarEscalonadaDoErp({ external_id: 'ESC-1', acao: 'inativado' })).toEqual({ tipo: 'inativar', external_id: 'ESC-1' });
        expect(planejarEscalonadaDoErp(escalonada({ ativo: false }))).toEqual({ tipo: 'inativar', external_id: 'ESC-1' });
    });
    it('RN-VEN-23: faixa inválida para o Catálogo (preço zero, fim antes do início) inativa em vez de gravar', () => {
        expect(planejarEscalonadaDoErp(escalonada({ preco_unidade_cents: 0 }))).toEqual({ tipo: 'inativar', external_id: 'ESC-1' });
        expect(planejarEscalonadaDoErp(escalonada({ vigencia_fim: '2026-10-31' }))).toEqual({ tipo: 'inativar', external_id: 'ESC-1' });
    });
    it('RN-VEN-23: evento sem registro e sem ser inativação é ignorado', () => {
        expect(planejarEscalonadaDoErp({ external_id: 'ESC-1', acao: 'atualizado' })).toEqual({ tipo: 'ignorar' });
    });
});
describe('RN-VEN-23: colisão da faixa do ERP na chave do índice único', () => {
    it('RN-VEN-23: sem colisão ou a mesma linha = nenhuma ação', () => {
        expect(decidirColisaoEscalonada(null, 'ESC-1', false)).toBe('nenhuma');
        expect(decidirColisaoEscalonada('ESC-1', 'ESC-1', true)).toBe('nenhuma');
    });
    it('RN-VEN-23: faixa manual na mesma chave é adotada pelo ERP', () => {
        expect(decidirColisaoEscalonada(null, 'ESC-1', true)).toBe('adotar');
    });
    it('RN-VEN-23: faixa de outro registro do ERP na mesma chave é substituída pela nova (nunca recusa nem repete)', () => {
        expect(decidirColisaoEscalonada('ESC-0', 'ESC-1', true)).toBe('substituir');
    });
});
describe('RN-CAT-06: vínculo cliente -> tabela de preço vindo do ERP (T-0120)', () => {
    const cli = (registro, acao = 'atualizado') => ({ external_id: 'C-1', acao, ...(registro ? { registro } : {}) });
    it('RN-CAT-06: campo com a chave da tabela vira vínculo do cliente', () => {
        expect(planejarVinculoTabelaDoErp(cli({ tabela_preco_external_id: ' TAB-A ' }))).toEqual({ tipo: 'vincular', cliente_external_id: 'C-1', tabela_external_id: 'TAB-A' });
    });
    it('RN-CAT-06: null desvincula (volta à tabela padrão)', () => {
        expect(planejarVinculoTabelaDoErp(cli({ tabela_preco_external_id: null }))).toEqual({ tipo: 'desvincular', cliente_external_id: 'C-1' });
    });
    it('RN-CAT-06: campo ausente não altera o vínculo', () => {
        expect(planejarVinculoTabelaDoErp(cli({}))).toEqual({ tipo: 'ignorar' });
        expect(planejarVinculoTabelaDoErp(cli(undefined))).toEqual({ tipo: 'ignorar' });
    });
    it('RN-CAT-06: cliente inativado no ERP ou chave vazia não mexem no vínculo', () => {
        expect(planejarVinculoTabelaDoErp(cli({ tabela_preco_external_id: 'TAB-A' }, 'inativado'))).toEqual({ tipo: 'ignorar' });
        expect(planejarVinculoTabelaDoErp(cli({ tabela_preco_external_id: '   ' }))).toEqual({ tipo: 'ignorar' });
    });
});
describe('RN-CORE-39: filial_external_id no preço, no estoque e na escalonada do ERP (T-0149)', () => {
    const preco = { tabela_external_id: 'TAB-A', tabela_nome: 'Atacado', vigencia_inicio: '2026-11-01', produto_external_id: 'P-1', preco_cents: 1000 };
    const linhaPreco = (registro) => {
        const p = planejarPrecoDoErp({ external_id: 'PR-1', acao: 'criado', registro: { ...preco, ...registro } });
        return p.tipo === 'upsert' ? p.linha.filial_external_id : 'nao-upsert';
    };
    it('RN-CORE-39: preço com filial_external_id leva a chave da filial; ausente ou nulo = filial padrão (null no plano)', () => {
        expect(linhaPreco({ filial_external_id: ' FIL-2 ' })).toBe('FIL-2');
        expect(linhaPreco({})).toBeNull();
        expect(linhaPreco({ filial_external_id: null })).toBeNull();
    });
    const est = { deposito_external_id: 'DEP-1', produto_external_id: 'P-1', saldo: 5 };
    const filialEstoque = (registro) => {
        const p = planejarEstoqueDoErp({ external_id: 'E-1', acao: 'criado', registro: { ...est, ...registro } });
        return p.tipo === 'upsert' ? p.linha.filial_external_id : 'nao-upsert';
    };
    it('RN-CORE-39: estoque distingue filial ausente (depósito conhecido não muda) de nula (padrão) e informada', () => {
        expect(filialEstoque({})).toBeUndefined();
        expect(filialEstoque({ filial_external_id: null })).toBeNull();
        expect(filialEstoque({ filial_external_id: 'FIL-2' })).toBe('FIL-2');
    });
    const esc = { produto_external_id: 'P-1', quantidade_minima: 10, preco_unidade_cents: 900, vigencia_inicio: '2026-11-01' };
    const filialEsc = (registro) => {
        const p = planejarEscalonadaDoErp({ external_id: 'ESC-1', acao: 'criado', registro: { ...esc, ...registro } });
        return p.tipo === 'upsert' ? p.linha.filial_external_id : 'nao-upsert';
    };
    it('RN-CORE-39: escalonada sem filial vale para todas (null); com filial leva a chave', () => {
        expect(filialEsc({})).toBeNull();
        expect(filialEsc({ filial_external_id: 'FIL-2' })).toBe('FIL-2');
    });
});
