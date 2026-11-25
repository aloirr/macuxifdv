import { describe, expect, it } from 'vitest';
import { fatorValido, planejarProdutoUnidadeDoErp, rotuloDaUnidade, unidadePadraoDoProduto, unidadesDoProduto } from './produto-unidade';
const base = { external_id: 'PU-1', ocorrido_em: '2026-11-02T12:00:00Z' };
const registro = { external_id: 'PU-1', alterado_em: '2026-11-02T11:00:00Z', ativo: true, produto_external_id: 'P-100', unidade: ' cx ', fator: 12, ean: '7891234567895', padrao: false };
const ev = (o = {}) => ({ ...base, acao: 'atualizado', registro, ...o });
describe('RN-VEN-15: unidades de venda do produto vindas do ERP (integracao.produto_unidade.atualizado@1)', () => {
    it('RN-VEN-15: criado e atualizado fazem upsert por external_id com sigla normalizada em maiúsculas', () => {
        for (const acao of ['criado', 'atualizado']) {
            expect(planejarProdutoUnidadeDoErp(ev({ acao }))).toEqual({
                tipo: 'upsert',
                linha: { external_id: 'PU-1', produto_external_id: 'P-100', unidade: 'CX', fator: 12, ean: '7891234567895', padrao: false, ativo: true },
                desmarcar_outras_padrao: false,
            });
        }
    });
    it('RN-VEN-15: marcar padrao pede para desmarcar a padrão anterior do produto (no máximo uma viva)', () => {
        const p = planejarProdutoUnidadeDoErp(ev({ registro: { ...registro, padrao: true } }));
        expect(p).toMatchObject({ tipo: 'upsert', linha: { padrao: true }, desmarcar_outras_padrao: true });
    });
    it('RN-VEN-15: unidade inativa nunca é padrão (a regra padrao => ativo do banco)', () => {
        const p = planejarProdutoUnidadeDoErp(ev({ registro: { ...registro, padrao: true, ativo: false } }));
        expect(p).toMatchObject({ tipo: 'upsert', linha: { padrao: false, ativo: false }, desmarcar_outras_padrao: false });
    });
    it('RN-INT-06: inativado só marca ativo=false (nunca apaga) e não precisa de registro', () => {
        expect(planejarProdutoUnidadeDoErp({ ...base, acao: 'inativado' })).toEqual({ tipo: 'inativar', external_id: 'PU-1' });
    });
    it('RN-INT-02: reentrega do mesmo evento é idempotente (mesmo plano)', () => {
        expect(planejarProdutoUnidadeDoErp(ev())).toEqual(planejarProdutoUnidadeDoErp(ev()));
    });
    it('RN-VEN-15: fator não inteiro ou menor que 1 é ignorado (o banco recusa e o lote não trava)', () => {
        for (const fator of [0, -2, 1.5, Number.NaN]) {
            expect(planejarProdutoUnidadeDoErp(ev({ registro: { ...registro, fator } }))).toEqual({ tipo: 'ignorar', motivo: 'fator_invalido' });
        }
    });
    it('RN-VEN-15: sigla fora de 1 a 6 letras/números é ignorada', () => {
        expect(planejarProdutoUnidadeDoErp(ev({ registro: { ...registro, unidade: 'CAIXA-GRANDE' } }))).toEqual({ tipo: 'ignorar', motivo: 'unidade_invalida' });
        expect(planejarProdutoUnidadeDoErp(ev({ registro: { ...registro, unidade: '  ' } }))).toEqual({ tipo: 'ignorar', motivo: 'unidade_invalida' });
    });
    it('RN-VEN-15: EAN que o banco não aceita (8 a 14 dígitos) entra como nulo, sem derrubar a unidade', () => {
        expect(planejarProdutoUnidadeDoErp(ev({ registro: { ...registro, ean: 'abc' } }))).toMatchObject({ linha: { ean: null } });
        expect(planejarProdutoUnidadeDoErp(ev({ registro: { ...registro, ean: '  ' } }))).toMatchObject({ linha: { ean: null } });
    });
    it('RN-INT-02: criado/atualizado sem registro é ignorado (defeito do Hub)', () => {
        expect(planejarProdutoUnidadeDoErp({ ...base, acao: 'criado' })).toEqual({ tipo: 'ignorar', motivo: 'sem_registro' });
    });
});
describe('RN-VEN-15: unidade padrão e lista de unidades do produto (leitura pública, offline)', () => {
    const linha = (o) => ({ id: String(o.unidade), produto_id: 'p1', unidade: 'UN', fator: 1, padrao: false, ativo: true, deleted_at: null, ...o });
    it('RN-VEN-15: fator válido = inteiro maior que zero', () => {
        expect(fatorValido(1)).toBe(true);
        expect(fatorValido(12)).toBe(true);
        for (const f of [0, -1, 2.5, '12', null, undefined, Number.NaN])
            expect(fatorValido(f)).toBe(false);
    });
    it('RN-CORE-19: rótulo mostra só a sigla com fator 1 e "CX c/ 12" com fator maior', () => {
        expect(rotuloDaUnidade('UN', 1)).toBe('UN');
        expect(rotuloDaUnidade('CX', 12)).toBe('CX c/ 12');
    });
    it('RN-VEN-15: unidade padrão = a marcada; sem marcada, a unidade base com fator 1', () => {
        expect(unidadePadraoDoProduto([linha({ unidade: 'UN' }), linha({ unidade: 'CX', fator: 12, padrao: true })], 'UN')).toEqual({ unidade: 'CX', fator: 12 });
        expect(unidadePadraoDoProduto([linha({ unidade: 'CX', fator: 12 })], 'LT')).toEqual({ unidade: 'LT', fator: 1 });
        expect(unidadePadraoDoProduto([], null)).toEqual({ unidade: 'UN', fator: 1 });
    });
    it('RN-VEN-15: a marcada inativa, removida ou com fator inválido não vale como padrão', () => {
        expect(unidadePadraoDoProduto([linha({ unidade: 'CX', fator: 12, padrao: true, ativo: false })])).toEqual({ unidade: 'UN', fator: 1 });
        expect(unidadePadraoDoProduto([linha({ unidade: 'CX', fator: 12, padrao: true, deleted_at: '2026-11-01T00:00:00Z' })])).toEqual({ unidade: 'UN', fator: 1 });
        expect(unidadePadraoDoProduto([linha({ unidade: 'CX', fator: 0, padrao: true })])).toEqual({ unidade: 'UN', fator: 1 });
    });
    it('RN-VEN-15: lista só as ativas do produto, a padrão primeiro, depois por fator; com rótulo', () => {
        const r = unidadesDoProduto([linha({ unidade: 'CX', fator: 12 }), linha({ unidade: 'UN', padrao: true }), linha({ unidade: 'FD', fator: 24, ativo: false }), linha({ unidade: 'PCT', fator: 6, produto_id: 'outro' })], 'p1');
        expect(r.map((u) => [u.unidade, u.rotulo])).toEqual([
            ['UN', 'UN'],
            ['CX', 'CX c/ 12'],
        ]);
    });
    it('RN-VEN-15: produto sem unidade cadastrada devolve a unidade base como única opção', () => {
        const r = unidadesDoProduto([], 'p1', 'KG');
        expect(r).toHaveLength(1);
        expect(r[0]).toMatchObject({ unidade: 'KG', fator: 1, padrao: true, rotulo: 'KG' });
    });
});
