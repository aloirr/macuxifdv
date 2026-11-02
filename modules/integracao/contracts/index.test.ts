import { describe, expect, it } from 'vitest';
import {
  Cursor,
  EXTERNAL_ID_MAX,
  LinhaInvalidaConector,
  ClientePayload,
  EVENTOS_ATUALIZADO,
  ENTIDADES,
  EstoquePayload,
  ChaveConectorCriada,
  LIMITE_LINHAS_INVALIDAS_PADRAO,
  LoteEnvelope,
  PedidoRetornoErpEvento,
  PoliticaVersaoConector,
  RespostaSinal,
  SinalConector,
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
    expect(ProdutoPayload.safeParse({ ...base, external_id: 'x'.repeat(201), sku: 'P', nome: 'n', unidade: 'UN' }).success).toBe(false);
  });

  it('T-0027: external_id aceita até 200 caracteres no registro, no cursor e na linha inválida do Conector (os dois lados iguais)', () => {
    const id200 = 'x'.repeat(EXTERNAL_ID_MAX);
    expect(EXTERNAL_ID_MAX).toBe(200);
    expect(ProdutoPayload.safeParse({ ...base, external_id: id200, sku: 'P', nome: 'n', unidade: 'UN' }).success).toBe(true);
    expect(Cursor.safeParse({ alterado_em: '2026-10-31T10:00:00Z', external_id: id200 }).success).toBe(true);
    expect(LinhaInvalidaConector.safeParse({ external_id: id200, codigo: 'registro_invalido', mensagem: 'x' }).success).toBe(true);
    expect(LinhaInvalidaConector.safeParse({ external_id: `${id200}x`, codigo: 'registro_invalido', mensagem: 'x' }).success).toBe(false);
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

  it('RN-CORE-19: produto aceita embalagem_medida + embalagem_quantidade opcionais (mesma versão); uma sem a outra é recusada', () => {
    const p = { ...base, sku: 'P', nome: 'n', unidade: 'UN' };
    expect(ProdutoPayload.safeParse(p).success).toBe(true);
    expect(ProdutoPayload.parse({ ...p, embalagem_medida: 'CX', embalagem_quantidade: 12 })).toMatchObject({ embalagem_medida: 'CX', embalagem_quantidade: 12 });
    expect(ProdutoPayload.safeParse({ ...p, embalagem_medida: null, embalagem_quantidade: null }).success).toBe(true);
    expect(ProdutoPayload.safeParse({ ...p, embalagem_medida: 'CX' }).success).toBe(false);
    expect(ProdutoPayload.safeParse({ ...p, embalagem_quantidade: 12 }).success).toBe(false);
    expect(ProdutoPayload.safeParse({ ...p, embalagem_medida: 'CX', embalagem_quantidade: 0 }).success).toBe(false);
    expect(ProdutoPayload.safeParse({ ...p, embalagem_medida: 'CX', embalagem_quantidade: 1.5 }).success).toBe(false);
  });

  it('RN-CORE-19: embalagem_quantidade é inteira de 2 a 9999 (mesmo teto do Core e do banco)', () => {
    const p = { ...base, sku: 'P', nome: 'n', unidade: 'UN', embalagem_medida: 'CX' };
    for (const q of [2, 12, 9999]) expect(ProdutoPayload.safeParse({ ...p, embalagem_quantidade: q }).success).toBe(true);
    for (const q of [1, 10000, 2147483648]) expect(ProdutoPayload.safeParse({ ...p, embalagem_quantidade: q }).success).toBe(false);
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
    // RN-INT-08: cancelado vem do ERP, motivo e número são opcionais
    expect(RetornoErp.safeParse({ ...ret, status: 'cancelado' }).success).toBe(true);
    expect(RetornoErp.safeParse({ ...ret, status: 'cancelado', motivo: 'Cliente desistiu' }).success).toBe(true);
  });
});

describe('RN-INT-08: itens faturados no retorno (campo opcional, continua v1)', () => {
  const ret = { versao_contrato: 'v1', pedido_uuid: UUID, numero_erp: '778', ocorrido_em: '2026-10-31T11:00:00Z' };
  const nota = { numero: '123', emitida_em: '2026-10-31T11:00:00Z', total_cents: 2000 };
  const itens = [{ sequencia: 1, produto_external_id: 'P1', quantidade: 2, valor_cents: 2000 }];

  it('RN-INT-08: faturado_parcial e faturado_total aceitam itens_faturados (sequência, quantidade e valor em centavos)', () => {
    for (const status of ['faturado_parcial', 'faturado_total'] as const) {
      const r = RetornoErp.safeParse({ ...ret, status, nota, itens_faturados: itens });
      expect(r.success).toBe(true);
    }
    // sem o campo continua valendo (compatível com v1)
    expect(RetornoErp.safeParse({ ...ret, status: 'faturado_parcial', nota }).success).toBe(true);
  });

  it('RN-INT-08: itens_faturados em outro status, vazio, com quantidade fracionária ou valor fracionário é recusado', () => {
    expect(RetornoErp.safeParse({ ...ret, status: 'integrado', itens_faturados: itens }).success).toBe(false);
    expect(RetornoErp.safeParse({ ...ret, status: 'faturado_parcial', nota, itens_faturados: [] }).success).toBe(false);
    expect(RetornoErp.safeParse({ ...ret, status: 'faturado_parcial', nota, itens_faturados: [{ sequencia: 1, produto_external_id: 'P1', quantidade: 1.5, valor_cents: 100 }] }).success).toBe(false);
    expect(RetornoErp.safeParse({ ...ret, status: 'faturado_parcial', nota, itens_faturados: [{ sequencia: 1, produto_external_id: 'P1', quantidade: 1, valor_cents: 10.5 }] }).success).toBe(false);
    expect(RetornoErp.safeParse({ ...ret, status: 'faturado_parcial', nota, itens_faturados: [{ sequencia: 1, produto_external_id: 'P1', quantidade: 0, valor_cents: 100 }] }).success).toBe(false);
  });

  it('RN-INT-08: item faturado sem produto_external_id ou sem valor_cents é recusado (obrigatórios)', () => {
    const faturado = (item: object) => RetornoErp.safeParse({ ...ret, status: 'faturado_parcial', nota, itens_faturados: [item] });
    expect(faturado({ sequencia: 1, produto_external_id: 'P1', quantidade: 2, valor_cents: 2000 }).success).toBe(true);
    expect(faturado({ sequencia: 1, quantidade: 2, valor_cents: 2000 }).success).toBe(false);
    expect(faturado({ sequencia: 1, produto_external_id: null, quantidade: 2, valor_cents: 2000 }).success).toBe(false);
    expect(faturado({ sequencia: 1, produto_external_id: 'P1', quantidade: 2 }).success).toBe(false);
    expect(faturado({ sequencia: 1, produto_external_id: 'P1', quantidade: 2, valor_cents: null }).success).toBe(false);
    expect(faturado({ sequencia: 1, produto_external_id: 'P1', quantidade: 2, valor_cents: 0 }).success).toBe(true);
  });

  it('P-4: sequência repetida na mesma nota NÃO recusa o envelope (o domain descarta as linhas da sequência com sequencia_repetida e aceita o retorno)', () => {
    expect(RetornoErp.safeParse({ ...ret, status: 'faturado_parcial', nota, itens_faturados: [...itens, ...itens] }).success).toBe(true);
  });

  it('RN-INT-08: o evento integracao.pedido.retorno_erp@1 repete itens_faturados como opcional', () => {
    const base = { pedido_uuid: UUID, status: 'faturado_parcial', numero_erp: '778', motivo: null, nota, ocorrido_em: '2026-10-31T11:00:00Z' };
    expect(PedidoRetornoErpEvento.safeParse(base).success).toBe(true);
    expect(PedidoRetornoErpEvento.safeParse({ ...base, itens_faturados: itens }).success).toBe(true);
  });
});

describe('RN-INT-03: linhas inválidas do Conector no lote (campo opcional, continua v1)', () => {
  const env = { versao_contrato: 'v1', entidade: 'cliente', modo: 'delta', registros: [{ external_id: 'C1' }] };
  it('RN-INT-03: o lote sem linhas_invalidas continua válido e o padrão é 500 por lote', () => {
    expect(LoteEnvelope.safeParse(env).success).toBe(true);
    expect(LIMITE_LINHAS_INVALIDAS_PADRAO).toBe(500);
  });
  it('RN-INT-03: linha inválida leva external_id, campo e mensagem; omitidas vira só contagem', () => {
    const r = LoteEnvelope.safeParse({
      ...env,
      conector_id: 'cnx-loja-01',
      versao_conector: '1.1.0',
      linhas_invalidas: [{ external_id: 'C9', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'campo obrigatório sem valor' }],
      linhas_invalidas_omitidas: 37,
    });
    expect(r.success).toBe(true);
    expect(LoteEnvelope.safeParse({ ...env, linhas_invalidas: [{ codigo: 'falha_processamento', mensagem: 'x' }] }).success).toBe(false);
    expect(LoteEnvelope.safeParse({ ...env, linhas_invalidas_omitidas: -1 }).success).toBe(false);
  });
  it('RN-INT-03: o resultado do lote marca a origem do erro e as omitidas', () => {
    const r = LoteResultado.parse({
      lote_id: UUID, entidade: 'cliente', modo: 'delta', status: 'concluido_com_erros',
      contagens: { recebidas: 1, duplicadas_no_lote: 0, com_erro: 1, novas: 0, atualizadas: 0, inalteradas: 0 },
      erros: [{ indice: 0, external_id: 'C9', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'campo obrigatório sem valor', reprocessavel: false, origem: 'conector' }],
      avisos: [], cursor: null, invalidas_omitidas: 12, recebido_em: '2026-10-31T10:00:00Z', concluido_em: null,
    });
    expect(r.erros[0]?.origem).toBe('conector');
    expect(r.invalidas_omitidas).toBe(12);
  });
});

describe('RN-INT-09: política de versão do Conector e chave por Conector (aditivo, continua v1)', () => {
  it('RN-INT-09: política exige semver; resposta do sinal aceita ausência de política', () => {
    const p = { versao_minima: '1.0.0', versao_recomendada: '1.2.0', mensagem: 'Atualize.' };
    expect(PoliticaVersaoConector.safeParse(p).success).toBe(true);
    expect(PoliticaVersaoConector.safeParse({ ...p, versao_minima: '1.0' }).success).toBe(false);
    expect(PoliticaVersaoConector.safeParse({ ...p, versao_recomendada: 'v1.2.0' }).success).toBe(false);
    expect(RespostaSinal.safeParse({}).success).toBe(true);
    expect(RespostaSinal.parse({ politica_versao: p }).politica_versao?.versao_minima).toBe('1.0.0');
  });
  it('RN-INT-09: pacote assinado exige SHA-256 de 64 hexadecimais', () => {
    const ok = { versao_minima: '1.0.0', versao_recomendada: '1.2.0', pacote: { versao: '1.2.0', sha256: 'a'.repeat(64), assinatura: 'YXNzaW5hdHVyYQ==' } };
    expect(PoliticaVersaoConector.safeParse(ok).success).toBe(true);
    expect(PoliticaVersaoConector.safeParse({ ...ok, pacote: { ...ok.pacote, sha256: 'xyz' } }).success).toBe(false);
  });
  it('RN-INT-09: sinal informa o Conector e a versão dele; chave nasce com escopo só da integração', () => {
    const sinal = { conector_id: 'cnx-1', versao_conector: '1.1.0', versao_contrato: 'v1', em: '2026-10-31T10:00:00Z', fila: [], entidades: [] };
    expect(SinalConector.safeParse(sinal).success).toBe(true);
    expect(SinalConector.safeParse({ ...sinal, versao_conector: 'abc' }).success).toBe(false);
    const chave = { conector_id: 'cnx-1', tenant_id: UUID, escopo: 'integracao.v1', chave: 'x'.repeat(40), prefixo: 'mxk_1234', criada_em: '2026-10-31T10:00:00Z' };
    expect(ChaveConectorCriada.safeParse(chave).success).toBe(true);
    expect(ChaveConectorCriada.safeParse({ ...chave, escopo: 'api.tudo' }).success).toBe(false);
  });
});
