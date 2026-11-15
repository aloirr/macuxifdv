import { describe, expect, it } from 'vitest';
import { CAMPOS_CADASTRO_CLIENTE, CAMPOS_CADASTRO_PADRAO, CadastroClienteEntradaSchema, CadastroClienteSaidaSchema, CadastroResumoEntradaSchema, CadastroResumoSaidaSchema, ClienteAtualizadoSchema, ClienteEnderecoSyncSchema, ClienteSyncSchema, CONSULTA_CADASTRO_CLIENTE, ParametroCamposObrigatorios, PARAMETRO_CAMPOS_OBRIGATORIOS, ProdutoUnidadeSyncSchema, } from './index';
import * as dominio from '../domain/cadastro';
const U = '11111111-1111-4111-8111-111111111111';
const base = { id: U, updated_at: '2026-11-02T10:00:00.000000Z', deleted_at: null, external_id: null };
const cliente = {
    ...base, documento: null, razao_social: 'X', nome_fantasia: null, segmento: null, telefone: null, email: null, logradouro: null,
    numero: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, ativo: true,
};
describe('RN-CORE-16: contrato do cadastro mínimo', () => {
    it('RN-CORE-16: o domain reexporta a lista do contrato (fonte única)', () => {
        expect(dominio.CAMPOS_CADASTRO_CLIENTE).toBe(CAMPOS_CADASTRO_CLIENTE);
        expect(dominio.CAMPOS_CADASTRO_PADRAO).toBe(CAMPOS_CADASTRO_PADRAO);
        expect(PARAMETRO_CAMPOS_OBRIGATORIOS).toBe('cliente.campos_obrigatorios');
    });
    it('RN-CORE-16: parâmetro aceita só códigos conhecidos, ao menos um', () => {
        expect(ParametroCamposObrigatorios.safeParse(['documento', 'cep']).success).toBe(true);
        expect(ParametroCamposObrigatorios.safeParse([]).success).toBe(false);
        expect(ParametroCamposObrigatorios.safeParse(['inventado']).success).toBe(false);
    });
    it('RN-CORE-16: ClienteSync antigo (sem os campos novos) continua válido; os novos são opcionais', () => {
        expect(ClienteSyncSchema.safeParse(cliente).success).toBe(true);
        const novo = ClienteSyncSchema.parse({ ...cliente, inscricao_estadual: 'ISENTO', observacao: 'x', cadastro_incompleto: true, cadastro_campos_faltantes: ['cep', 'campo_novo_do_tenant'] });
        expect(novo.cadastro_campos_faltantes).toEqual(['cep', 'campo_novo_do_tenant']);
    });
    it('RN-CORE-16: core.cliente.atualizado@1 aceita o cadastro como aditivo opcional', () => {
        const ev = { cliente_id: U, campos: ['cep'], origem: 'erp' };
        expect(ClienteAtualizadoSchema.safeParse(ev).success).toBe(true);
        expect(ClienteAtualizadoSchema.parse({ ...ev, cadastro_incompleto: true, cadastro_campos_faltantes: ['cep'] }).cadastro_incompleto).toBe(true);
    });
    it('RN-PES-05: canal do cliente é aditivo no cadastro_resumo (opcional e nulável) e recusa saída fora do tipo', () => {
        const base = { id: U, razao_social: 'X', nome_fantasia: null, documento: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, ativo: true, external_id: null };
        const ok = (c) => CadastroResumoSaidaSchema.safeParse({ clientes: [{ ...base, ...c }], produtos: [], usuarios: [], enderecos: [] }).success;
        expect(ok({})).toBe(true);
        expect(ok({ canal: null })).toBe(true);
        expect(ok({ canal: 'Atacado' })).toBe(true);
        expect(ok({ canal: 5 })).toBe(false);
    });
    it('RN-CORE-16: core.cadastro_resumo@1 mantém a entrada antiga e aceita os campos opcionais novos', () => {
        expect(CadastroResumoEntradaSchema.parse({ cliente_ids: [U] }).endereco_ids).toEqual([]);
        expect(CadastroResumoEntradaSchema.parse({ cliente_ids: [U] }).produto_external_ids).toEqual([]);
        expect(CadastroResumoEntradaSchema.parse({ produto_ids: [U] }).cliente_external_ids).toEqual([]);
        expect(CadastroResumoEntradaSchema.parse({ cliente_external_ids: ['C-1'] }).cliente_external_ids).toEqual(['C-1']);
        expect(CadastroResumoEntradaSchema.safeParse({ cliente_external_ids: Array.from({ length: 501 }, (_, i) => `C${i}`) }).success).toBe(false);
        expect(CadastroResumoEntradaSchema.safeParse({ cliente_external_ids: [''] }).success).toBe(false);
        expect(CadastroResumoEntradaSchema.parse({ produto_external_ids: ['ERP-1'] }).produto_external_ids).toEqual(['ERP-1']);
        expect(CadastroResumoEntradaSchema.safeParse({ produto_external_ids: Array.from({ length: 501 }, (_, i) => `E${i}`) }).success).toBe(false);
        const saida = CadastroResumoSaidaSchema.parse({
            clientes: [{ id: U, razao_social: 'X', nome_fantasia: null, documento: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, ativo: true, external_id: null, cep: null, cadastro_incompleto: true, cadastro_campos_faltantes: ['documento'] }],
            produtos: [{ id: U, sku: 'A', nome: 'A', unidade: 'UN', ativo: true, external_id: null, unidades: [{ unidade: 'CX', fator: 12, padrao: false, ativo: true, external_id: null }] }],
            usuarios: [],
            enderecos: [{ id: U, cliente_id: U, tipo: 'principal', logradouro: 'Rua A', numero: null, complemento: null, bairro: null, cidade: 'Boa Vista', uf: 'RR', cep: null, principal: true, ativo: true, external_id: null }],
        });
        expect(saida.produtos[0]?.unidades?.[0]?.fator).toBe(12);
        expect(CadastroResumoSaidaSchema.safeParse({ clientes: [], produtos: [], usuarios: [] }).success).toBe(true);
    });
    it('RN-CAT-01: core.cadastro_resumo@1 traz marca, categoria e ean do produto como aditivo opcional (T-0119)', () => {
        const base = { id: U, sku: 'A', nome: 'A', unidade: 'UN', ativo: true, external_id: null };
        expect(CadastroResumoSaidaSchema.safeParse({ clientes: [], usuarios: [], produtos: [base] }).success).toBe(true);
        const p = CadastroResumoSaidaSchema.parse({ clientes: [], usuarios: [], produtos: [{ ...base, marca: 'Acme', categoria: null, ean: '7891234567895' }] }).produtos[0];
        expect(p).toMatchObject({ marca: 'Acme', categoria: null, ean: '7891234567895' });
    });
    it('RN-INT-14: core.cadastro_cliente@1 limita o lote a 500 e responde só chave e nomes de campo', () => {
        expect(CONSULTA_CADASTRO_CLIENTE.nome).toBe('core.cadastro_cliente@1');
        const linha = { chave: 'C1', razao_social: null, nome_fantasia: null, documento: null, inscricao_estadual: null, telefone: null, email: null, logradouro: null, numero: null, complemento: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null };
        expect(CadastroClienteEntradaSchema.safeParse({ clientes: [linha] }).success).toBe(true);
        expect(CadastroClienteEntradaSchema.safeParse({ clientes: Array(501).fill(linha) }).success).toBe(false);
        expect(CadastroClienteEntradaSchema.safeParse({ clientes: [], extra: 1 }).success).toBe(false);
        expect(CadastroClienteSaidaSchema.parse({ resultados: [{ chave: 'C1', completo: false, campos_faltantes: ['documento'] }] }).resultados).toHaveLength(1);
    });
});
describe('RN-VEN-15/17: entidades de unidade e endereço', () => {
    it('RN-VEN-15: produto_unidade exige fator inteiro positivo', () => {
        const l = { ...base, produto_id: U, unidade: 'CX', fator: 12, ean: null, padrao: false, ativo: true };
        expect(ProdutoUnidadeSyncSchema.safeParse(l).success).toBe(true);
        expect(ProdutoUnidadeSyncSchema.safeParse({ ...l, fator: 0 }).success).toBe(false);
        expect(ProdutoUnidadeSyncSchema.safeParse({ ...l, fator: 1.5 }).success).toBe(false);
    });
    it('RN-VEN-17: cliente_endereco valida o tipo e aceita coordenada em texto ou número', () => {
        const l = { ...base, cliente_id: U, tipo: 'entrega', descricao: null, logradouro: 'Rua A', numero: '1', complemento: null, bairro: null, cidade: 'Boa Vista', uf: 'RR', cep: '69300000', latitude: '2.8', longitude: -60.6, principal: false, ativo: true };
        expect(ClienteEnderecoSyncSchema.safeParse(l).success).toBe(true);
        expect(ClienteEnderecoSyncSchema.safeParse({ ...l, tipo: 'outro' }).success).toBe(false);
    });
});
