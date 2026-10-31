import { describe, expect, it } from 'vitest';
import {
  ClientePayload,
  EVENTOS_ATUALIZADO,
  ENTIDADES,
  EstoquePayload,
  LoteEnvelope,
  LoteResultado,
  NOMES_EVENTO_ATUALIZADO,
  NotaPayload,
  PedidoParaErp,
  PrecoPayload,
  ProdutoPayload,
  RetornoErp,
  RotaPayload,
  SCHEMA_REGISTRO,
  TituloPayload,
  VendedorPayload,
} from './index';

const base = { external_id: 'X1', alterado_em: '2026-10-31T10:00:00Z' };
const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';

describe('RN-INT-09: contrato canônico v1 por entidade', () => {
  it('cada entidade aceita um registro mínimo válido e aplica padrões', () => {
    expect(VendedorPayload.parse({ ...base, nome: 'Ana' }).ativo).toBe(true);
    expect(ClientePayload.parse({ ...base, razao_social: 'Mercado Sol Ltda' })).toMatchObject({ ativo: true, bloqueado: false, contatos: [] });
    expect(ProdutoPayload.parse({ ...base, sku: 'P1', nome: 'Café 500g', unidade: 'UN' }).ean).toBeUndefined();
    expect(EstoquePayload.parse({ ...base, deposito_external_id: 'D1', produto_external_id: 'P1', saldo: 12.5 }).saldo).toBe(12.5);
    expect(RotaPayload.parse({ ...base, nome: 'Seg', vendedor_external_id: 'V1' }).paradas).toEqual([]);
    expect(NotaPayload.parse({ ...base, cliente_external_id: 'C1', tipo: 'devolucao', numero: '10', emitida_em: '2026-10-30T12:00:00Z', total_cents: 1000 }).cancelada).toBe(false);
    expect(TituloPayload.parse({ ...base, cliente_external_id: 'C1', numero: 'T1', vencimento: '2026-11-30', valor_cents: 5000, saldo_cents: 5000, situacao: 'aberto' }).situacao).toBe('aberto');
  });

  it('todas as entidades têm schema e evento .atualizado@1', () => {
    expect(Object.keys(SCHEMA_REGISTRO).sort()).toEqual([...ENTIDADES].sort());
    expect(NOMES_EVENTO_ATUALIZADO).toContain('integracao.rota.atualizado@1');
    expect(Object.keys(EVENTOS_ATUALIZADO)).toHaveLength(ENTIDADES.length);
  });

  it('external_id é obrigatório, não vazio e limitado', () => {
    expect(ProdutoPayload.safeParse({ ...base, external_id: undefined, sku: 'P', nome: 'n', unidade: 'UN' }).success).toBe(false);
    expect(ProdutoPayload.safeParse({ ...base, external_id: '   ', sku: 'P', nome: 'n', unidade: 'UN' }).success).toBe(false);
    expect(ProdutoPayload.safeParse({ ...base, external_id: 'x'.repeat(101), sku: 'P', nome: 'n', unidade: 'UN' }).success).toBe(false);
  });

  it('dinheiro só em centavos inteiros', () => {
    const t = { ...base, cliente_external_id: 'C1', numero: 'T1', vencimento: '2026-11-30', saldo_cents: 0, situacao: 'aberto' };
    expect(TituloPayload.safeParse({ ...t, valor_cents: 10.5 }).success).toBe(false);
    expect(TituloPayload.safeParse({ ...t, valor_cents: 1050 }).success).toBe(true);
  });

  it('datas-hora só ISO 8601 UTC com Z', () => {
    const v = { nome: 'Ana' };
    expect(VendedorPayload.safeParse({ ...v, external_id: 'V', alterado_em: '2026-10-31T10:00:00Z' }).success).toBe(true);
    expect(VendedorPayload.safeParse({ ...v, external_id: 'V', alterado_em: '2026-10-31T10:00:00-04:00' }).success).toBe(false);
    expect(VendedorPayload.safeParse({ ...v, external_id: 'V', alterado_em: '31/10/2026' }).success).toBe(false);
    expect(VendedorPayload.safeParse({ ...v, external_id: 'V' }).success).toBe(false);
  });

  it('campo novo desconhecido é ignorado (compatível); vigência invertida é recusada', () => {
    const p = ProdutoPayload.parse({ ...base, sku: 'P', nome: 'n', unidade: 'UN', campo_futuro: 1 });
    expect('campo_futuro' in p).toBe(false);
    const preco = { ...base, tabela_external_id: 'T', tabela_nome: 'Atacado', vigencia_inicio: '2026-11-10', produto_external_id: 'P1', preco_cents: 990 };
    expect(PrecoPayload.safeParse(preco).success).toBe(true);
    expect(PrecoPayload.safeParse({ ...preco, vigencia_fim: '2026-11-01' }).success).toBe(false);
    expect(PrecoPayload.safeParse({ ...preco, vigencia_inicio: '2026-02-30' }).success).toBe(false);
  });
});

describe('RN-INT-01/05/06: envelope de lote', () => {
  it('aceita delta com cursor e completo com sessão', () => {
    const r = LoteEnvelope.safeParse({
      versao_contrato: 'v1',
      entidade: 'cliente',
      modo: 'completo',
      sessao: { id: UUID, parte: 1, ultimo: false },
      cursor: { alterado_em: '2026-10-31T10:00:00Z', external_id: 'C9' },
      registros: [{}],
    });
    expect(r.success).toBe(true);
  });
  it('modo inválido e registros ausentes são recusados', () => {
    expect(LoteEnvelope.safeParse({ versao_contrato: 'v1', entidade: 'cliente', modo: 'tudo', registros: [] }).success).toBe(false);
    expect(LoteEnvelope.safeParse({ versao_contrato: 'v1', entidade: 'cliente', modo: 'delta' }).success).toBe(false);
  });
  it('resultado do lote traz erros por linha e contagens', () => {
    const r = LoteResultado.parse({
      lote_id: UUID,
      entidade: 'cliente',
      modo: 'delta',
      status: 'concluido_com_erros',
      contagens: { recebidas: 2, duplicadas_no_lote: 0, com_erro: 1, novas: 1, atualizadas: 0, inalteradas: 0 },
      erros: [{ indice: 1, external_id: 'C2', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'Informe razao_social.', reprocessavel: false }],
      avisos: [],
      cursor: null,
      recebido_em: '2026-10-31T10:00:00Z',
      concluido_em: null,
    });
    expect(r.inativadas).toBe(0);
  });
});

describe('RN-INT-08: pedido ao ERP e retorno', () => {
  const pedido = {
    versao_contrato: 'v1',
    pedido_uuid: UUID,
    cliente_external_id: 'C1',
    vendedor_external_id: 'V1',
    criado_em: '2026-10-31T09:00:00Z',
    aprovado_em: '2026-10-31T09:30:00Z',
    itens: [{ sequencia: 1, produto_external_id: 'P1', quantidade: 2, preco_unitario_cents: 1000, total_cents: 2000 }],
    total_cents: 2000,
  };
  it('pedido para o ERP em centavos, com itens e UUID', () => {
    const p = PedidoParaErp.parse(pedido);
    expect(p.desconto_total_cents).toBe(0);
    expect(p.tentativa).toBe(1);
    expect(PedidoParaErp.safeParse({ ...pedido, itens: [] }).success).toBe(false);
    expect(PedidoParaErp.safeParse({ ...pedido, pedido_uuid: 'abc' }).success).toBe(false);
  });
  const ret = { versao_contrato: 'v1', pedido_uuid: UUID, ocorrido_em: '2026-10-31T11:00:00Z' };
  it('retorno exige nº ERP ao integrar, motivo ao rejeitar e nota ao faturar', () => {
    expect(RetornoErp.safeParse({ ...ret, status: 'integrado' }).success).toBe(false);
    expect(RetornoErp.safeParse({ ...ret, status: 'integrado', numero_erp: '778' }).success).toBe(true);
    expect(RetornoErp.safeParse({ ...ret, status: 'rejeitado_erp' }).success).toBe(false);
    expect(RetornoErp.safeParse({ ...ret, status: 'rejeitado_erp', motivo: 'Cliente bloqueado' }).success).toBe(true);
    expect(RetornoErp.safeParse({ ...ret, status: 'faturado_total', numero_erp: '778' }).success).toBe(false);
    const nota = { numero: '123', emitida_em: '2026-10-31T11:00:00Z', total_cents: 2000 };
    expect(RetornoErp.safeParse({ ...ret, status: 'faturado_total', numero_erp: '778', nota }).success).toBe(true);
    expect(RetornoErp.safeParse({ ...ret, status: 'enviado', numero_erp: '778' }).success).toBe(false);
  });
});
