import { describe, expect, it } from 'vitest';
import { Cliente360Schema, ProdutoPrecoSchema, UnidadeProdutoResumoSchema, EnderecoClienteResumoSchema, ClienteEnderecoSyncSchema } from './index';

const U = '0e000000-0000-4000-8000-000000000001';
const base = { id: U, updated_at: '2026-11-02T10:00:00.000000Z', deleted_at: null, external_id: null };
const cliente = {
  ...base, documento: null, razao_social: 'Mercado', nome_fantasia: null, segmento: null, telefone: null, email: null, logradouro: null, numero: null, bairro: null,
  cidade: null, uf: null, cep: null, latitude: null, longitude: null, ativo: true,
};
const resumoVazio = { ultima_compra_em: null, dias_sem_compra: null, ticket_medio_cents: 0, frequencia_media_dias: null, total_12m_cents: 0 };
const completo = { cliente, contatos: [], financeiro: null, titulos: [], historico: [], resumo_compras: resumoVazio, resumo_financeiro: null, ultimas_visitas: [] };
const endereco = {
  ...base, cliente_id: U, tipo: 'principal', descricao: null, logradouro: 'Rua A', numero: '1', complemento: null, bairro: null, cidade: 'Boa Vista', uf: 'RR', cep: '69300000',
  latitude: '2.820000', longitude: '-60.670000', principal: true, ativo: true,
};

describe('RF-CORE-12 / RN-VEN-17: Cliente 360 com endereços de entrega (aditivo)', () => {
  it('RN-VEN-17: a resposta antiga (sem enderecos) continua válida — mudança só aditiva no @1', () => {
    expect(Cliente360Schema.safeParse(completo).success).toBe(true);
  });

  it('RN-VEN-17: aceita a lista de endereços e o id do padrão (ou nulo)', () => {
    const r = Cliente360Schema.parse({ ...completo, enderecos: [endereco], endereco_padrao_id: U });
    expect(r.enderecos).toHaveLength(1);
    expect(r.endereco_padrao_id).toBe(U);
    expect(Cliente360Schema.safeParse({ ...completo, enderecos: [], endereco_padrao_id: null }).success).toBe(true);
  });

  it('RN-VEN-17: o endereço do Cliente 360 é o mesmo formato do pull (tipo fechado em principal/entrega/cobranca)', () => {
    expect(Cliente360Schema.safeParse({ ...completo, enderecos: [{ ...endereco, tipo: 'outro' }] }).success).toBe(false);
    expect(ClienteEnderecoSyncSchema.safeParse(endereco).success).toBe(true);
  });

  it('RN-VEN-17: resumo de endereço para a escolha no pedido (id, tipo, descrição, linha única, padrão)', () => {
    expect(EnderecoClienteResumoSchema.safeParse({ id: U, tipo: 'entrega', descricao: 'Depósito', resumo: 'Rua A, 1 - Boa Vista/RR', padrao: false }).success).toBe(true);
    expect(EnderecoClienteResumoSchema.safeParse({ id: 'x', tipo: 'entrega', descricao: null, resumo: '', padrao: false }).success).toBe(false);
  });
});

describe('RN-VEN-15: unidades de venda no cadastro do produto (aditivo)', () => {
  it('RN-VEN-15: a unidade exige fator inteiro positivo e rótulo', () => {
    expect(UnidadeProdutoResumoSchema.safeParse({ unidade: 'CX', fator: 12, padrao: true, ativo: true, rotulo: 'CX c/ 12' }).success).toBe(true);
    expect(UnidadeProdutoResumoSchema.safeParse({ unidade: 'CX', fator: 0, padrao: true, ativo: true, rotulo: 'CX' }).success).toBe(false);
    expect(UnidadeProdutoResumoSchema.safeParse({ unidade: 'CX', fator: 1.5, padrao: true, ativo: true, rotulo: 'CX' }).success).toBe(false);
  });

  it('RN-VEN-15: o produto do BKO aceita o campo novo `unidades` e continua válido sem ele', () => {
    const p = {
      id: U, sku: 'S1', nome: 'Arroz', unidade: 'UN', ativo: true, custo_cents: null, preco_venda_cents: 1000, desconto_maximo_pct: null, vendavel: true, custo_nao_informado: true,
      margem_pct: null, markup_pct: null, lucro_cents: null, desconto_maximo_aplicavel_pct: 15, preco_minimo_cents: 850, margem_no_minimo_pct: null,
    };
    expect(ProdutoPrecoSchema.safeParse(p).success).toBe(true);
    expect(ProdutoPrecoSchema.safeParse({ ...p, unidades: [{ unidade: 'UN', fator: 1, padrao: true, ativo: true, rotulo: 'UN' }] }).success).toBe(true);
  });
});
