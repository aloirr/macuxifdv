import { describe, expect, it } from 'vitest';
import { Cliente360Schema, DocumentoPermissoesPutSchema, HistoricoNfQuerySchema, NotaDetalheSchema, ROTAS_CLIENTE360_V2, StatusNfSchema } from './index';

const U = '0ea00000-0000-4000-8000-000000000001';
const base = (extra: object = {}) => ({
  cliente: { id: U, updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, external_id: null, documento: null, razao_social: 'X', nome_fantasia: null, segmento: null, telefone: null, email: null, logradouro: null, numero: null, bairro: null, cidade: null, uf: null, cep: null, latitude: null, longitude: null, ativo: true },
  contatos: [], financeiro: null, titulos: [], historico: [],
  resumo_compras: { ultima_compra_em: null, dias_sem_compra: null, ticket_medio_cents: 0, frequencia_media_dias: null, total_12m_cents: 0 },
  resumo_financeiro: null, ultimas_visitas: [], ...extra,
});

describe('T-0186: Cliente360Schema estendido de forma aditiva', () => {
  it('a resposta antiga (sem nenhum campo novo) continua válida para o app antigo', () => {
    const r = Cliente360Schema.safeParse(base());
    expect(r.success ? [] : r.error.issues.map((i) => i.path.join('.'))).toEqual([]);
  });
  it('R-20261119-0440: o contrato não tem campo de alerta financeiro novo', () => {
    expect(Object.keys(Cliente360Schema.shape).filter((k) => /alerta|aviso/.test(k))).toEqual([]);
  });
});

describe('T-0186: Histórico, NF e permissões de documento', () => {
  it('status da NF tem exatamente os cinco valores da spec', () => {
    expect(StatusNfSchema.options).toEqual(['em_atraso', 'em_aberto', 'pago', 'devolvido', 'devolvido_parcial']);
  });
  it('filtros da URL: listas por vírgula e status inválido recusado', () => {
    expect(HistoricoNfQuerySchema.parse({ status: 'em_atraso,pago', forma_pagamento: 'PIX', numero_nf: '4655' })).toMatchObject({ status: ['em_atraso', 'pago'], forma_pagamento: ['PIX'], limite: 200 });
    expect(HistoricoNfQuerySchema.safeParse({ status: 'atrasada' }).success).toBe(false);
  });
  it('detalhe da NF (P17) traz parcelas, itens e PDF só como referência', () => {
    const d = { id: U, numero_nf: '004655', serie: '1', data: '2026-10-10', forma_pagamento: null, status: 'em_atraso', valor_cents: 128_000, devolvido_cents: 0, devolvido_em: null, valor_final_cents: 128_000, em_atraso: true, parcelas: [], itens: [], pdf_arquivo_id: null };
    expect(NotaDetalheSchema.safeParse(d).success).toBe(true);
  });
  it('a matriz só aceita os níveis Não vê, Vê e Vê e envia', () => {
    expect(DocumentoPermissoesPutSchema.safeParse({ matriz: [{ tipo_id: U, perfil: 'vendedor', nivel: 'baixar' }] }).success).toBe(false);
    expect(DocumentoPermissoesPutSchema.safeParse({ matriz: [{ tipo_id: U, perfil: 'vendedor', nivel: 've' }] }).success).toBe(true);
  });
  it('rotas públicas do Cliente 360 v2', () => {
    expect(ROTAS_CLIENTE360_V2.nota).toBe('clientes/:id/notas/:nota_id');
  });
});
