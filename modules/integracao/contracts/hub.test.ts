import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { ErroApiSchema } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import {
  CABECALHO_IDEMPOTENCIA,
  CabecalhosConector,
  CabecalhosEnvioLote,
  ChaveIdempotencia,
  ConectorCriar,
  ConectorIdentificador,
  ErroHub,
  InativacaoLote,
  ItemFaturadoDescartado,
  LoteAceito,
  LoteEnvelope,
  LoteRecebidoEvento,
  LoteResultado,
  PedidoAprovadoParaFila,
  QueryConsultaLote,
  QueryPedidosPendentes,
  RecusaEnvelope,
  RecusaLote,
  RecusaRetorno,
  RespostaReconciliacao,
  RespostaSinal,
  RetornoAceito,
  RetornoErp,
  ROTAS_HUB,
  SCHEMA_REGISTRO,
  SinalConector,
  STATUS_HTTP_ERRO_HUB,
} from './index';

const UUID = '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b';
const SHA = 'a'.repeat(64);

describe('RN-INT-09: cabeçalhos do Hub, como o Conector v1.1 os envia', () => {
  it('RN-INT-12 (proposta): Authorization Bearer + X-Macuxi-Conector-Id (minúsculas, como o Fastify entrega) passam', () => {
    const ok = CabecalhosConector.safeParse({
      authorization: 'Bearer chave-de-teste-0123456789abcdef',
      'x-macuxi-conector-id': 'matriz-01',
      'x-macuxi-conector-versao': '1.1.0',
      'user-agent': 'macuxi-conector/1.1.0',
    });
    expect(ok.success).toBe(true);
  });

  it('RN-INT-10 (proposta): sem Bearer, com espaço na chave ou identificador inválido é recusado com mensagem em português', () => {
    for (const authorization of ['', 'Basic abc', 'Bearer curta', 'Bearer com espaco 0123456789abcdef']) {
      expect(CabecalhosConector.safeParse({ authorization, 'x-macuxi-conector-id': 'matriz-01' }).success).toBe(false);
    }
    const r = CabecalhosConector.safeParse({ authorization: 'Bearer chave-de-teste-0123456789abcdef', 'x-macuxi-conector-id': 'matriz 01' });
    expect(r.success).toBe(false);
    expect(ConectorIdentificador.safeParse('a/b').success).toBe(false);
  });

  it('RN-INT-12 (proposta): Idempotency-Key aceita o SHA-256 hex que o Conector envia e recusa chave curta ou com caracteres perigosos', () => {
    expect(ChaveIdempotencia.safeParse(SHA).success).toBe(true);
    expect(ChaveIdempotencia.safeParse('curta').success).toBe(false);
    expect(ChaveIdempotencia.safeParse(`${SHA}\n`).success).toBe(false);
    const h = CabecalhosEnvioLote.safeParse({
      authorization: 'Bearer chave-de-teste-0123456789abcdef',
      'x-macuxi-conector-id': 'matriz-01',
      [CABECALHO_IDEMPOTENCIA.toLowerCase()]: SHA,
    });
    expect(h.success).toBe(true);
  });

  it('RN-INT-11 (proposta): versão do Conector ausente no cabeçalho não é erro (nunca bloquear por engano)', () => {
    expect(CabecalhosConector.safeParse({ authorization: 'Bearer chave-de-teste-0123456789abcdef', 'x-macuxi-conector-id': 'c1' }).success).toBe(true);
  });
});

describe('RN-INT-01/03: corpos que o Conector v1.1 envia continuam válidos', () => {
  it('RN-INT-01: lote delta com linhas_invalidas, omitidas e cursor declarado', () => {
    const lote = {
      versao_contrato: 'v1',
      entidade: 'cliente',
      modo: 'delta',
      cursor: { alterado_em: '2026-11-01T10:00:00.000Z', external_id: 'C9' },
      enviado_em: '2026-11-01T10:00:01.000Z',
      conector_id: 'matriz-01',
      versao_conector: '1.1.0',
      linhas_invalidas: [{ external_id: 'C7', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'razao_social ausente' }],
      linhas_invalidas_omitidas: 3,
      registros: [{ external_id: 'C9', alterado_em: '2026-11-01T10:00:00.000Z', razao_social: 'X' }],
    };
    expect(LoteEnvelope.safeParse(lote).success).toBe(true);
  });

  it('RN-INT-11 (proposta): sinal de vida com parado_por_versao e resposta só com a política', () => {
    const sinal = {
      conector_id: 'matriz-01',
      versao_conector: '1.1.0',
      versao_contrato: 'v1',
      em: '2026-11-01T10:00:00.000Z',
      fila: [{ estado: 'pendente', lotes: 2, linhas: 100, maisAntigo: null }],
      entidades: [{ entidade: 'cliente', fase: 'delta', ultimo_sucesso: null, bloqueada: false, lotes_na_fila: 0 }],
      parado_por_versao: true,
    };
    expect(SinalConector.safeParse(sinal).success).toBe(true);
    const resposta = RespostaSinal.parse({ politica_versao: { versao_minima: '1.0.0', versao_recomendada: '1.1.0', mensagem: 'Atualize.' } });
    expect(resposta.politica_versao?.versao_recomendada).toBe('1.1.0');
  });

  it('RN-INT-08: retorno faturado com itens_faturados (produto e valor obrigatórios no item)', () => {
    const base = {
      versao_contrato: 'v1',
      pedido_uuid: UUID,
      status: 'faturado_parcial',
      numero_erp: 'P-100',
      nota: { numero: '123', serie: '1', emitida_em: '2026-11-01T10:00:00Z', total_cents: 1000 },
      ocorrido_em: '2026-11-01T10:00:00Z',
    };
    expect(RetornoErp.safeParse({ ...base, itens_faturados: [{ sequencia: 1, produto_external_id: 'SKU1', quantidade: 2, valor_cents: 1000 }] }).success).toBe(true);
    expect(RetornoErp.safeParse({ ...base, itens_faturados: [{ sequencia: 1, quantidade: 2 }] }).success).toBe(false);
  });
});

describe('RN-INT-01/03/06: respostas do Hub compatíveis com o Conector', () => {
  const resultado = {
    lote_id: UUID,
    entidade: 'cliente',
    modo: 'completo',
    status: 'concluido',
    contagens: { recebidas: 3, duplicadas_no_lote: 0, com_erro: 0, novas: 3, atualizadas: 0, inalteradas: 0 },
    erros: [],
    avisos: [],
    cursor: null,
    recebido_em: '2026-11-01T10:00:00Z',
    concluido_em: '2026-11-01T10:00:05Z',
  };

  it('RN-INT-06: inativacao aguardando_confirmacao no resultado do último lote da sessão', () => {
    const r = LoteResultado.parse({ ...resultado, inativacao: { situacao: 'aguardando_confirmacao', motivo: 'excede_limite_inativacao', candidatos: 400, percentual: 40 } });
    expect(r.inativacao?.situacao).toBe('aguardando_confirmacao');
    expect(InativacaoLote.safeParse({ situacao: 'qualquer' }).success).toBe(false);
  });

  it('RN-INT-03: resultado sem os campos novos continua válido (compatível com v1)', () => {
    expect(LoteResultado.safeParse(resultado).success).toBe(true);
  });

  it('RN-INT-12 (proposta): replay de Idempotency-Key devolve o mesmo LoteAceito com repetido=true', () => {
    const aceito = LoteAceito.parse({ lote_id: UUID, status: 'recebido', entidade: 'cliente', modo: 'delta', recebidos: 4, repetido: true, consulta: `/integracao/v1/lotes/${UUID}` });
    expect(aceito.repetido).toBe(true);
  });

  it('RN-INT-12 (proposta): recusa de lote (409/413/426) é lida pelo Conector v1.1 como RecusaEnvelope e também é o erro padrão', () => {
    const corpo = {
      codigo: 'chave_idempotencia_reutilizada',
      mensagem: 'A Idempotency-Key já foi usada com outro conteúdo.',
      erros: [{ codigo: 'chave_idempotencia_reutilizada', campo: 'Idempotency-Key', mensagem: 'A Idempotency-Key já foi usada com outro conteúdo.' }],
    };
    expect(RecusaLote.safeParse(corpo).success).toBe(true);
    expect(RecusaEnvelope.safeParse(corpo).success).toBe(true);
    expect(ErroApiSchema.safeParse(corpo).success).toBe(true);
  });

  it('RN-INT-08: recusa do retorno traz codigo/mensagem no topo (o Conector lê j.codigo) e erros[]', () => {
    const corpo = {
      codigo: 'transicao_invalida',
      mensagem: 'Transição inválida do pedido no ERP: faturado_total → integrado.',
      erros: [{ codigo: 'transicao_invalida', campo: 'status', mensagem: 'Transição inválida do pedido no ERP: faturado_total → integrado.' }],
    };
    expect(RecusaRetorno.safeParse(corpo).success).toBe(true);
    expect(RecusaRetorno.safeParse({ ...corpo, codigo: 'inventado' }).success).toBe(false);
  });

  it('P-4: RetornoAceito sem itens_descartados continua válido (Conector 1.2.0) e aceita a lista de descartados (campo novo opcional)', () => {
    const base = { pedido_uuid: '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b', status: 'faturado_parcial', repetido: false };
    expect(RetornoAceito.safeParse(base).success).toBe(true);
    const descartado = {
      indice: 1, sequencia: 9, produto_external_id: 'SKU9', quantidade: 1, codigo: 'sequencia_inexistente', codigos: ['sequencia_inexistente'],
      campo: 'itens_faturados[1].sequencia', motivo: 'A sequência 9 não existe no pedido enviado ao ERP.',
    };
    expect(RetornoAceito.safeParse({ ...base, itens_descartados: [descartado] }).success).toBe(true);
    expect(RetornoAceito.safeParse({ ...base, itens_descartados: [{ ...descartado, codigo: 'inventado' }] }).success).toBe(false);
  });

  it('RN-INT-12 (proposta): erro padrão do Hub tem o mesmo formato do ErroApi da plataforma', () => {
    const e = ErroHub.parse({ codigo: 'limite_de_taxa', mensagem: 'Muitas chamadas. Tente de novo em 12 s.', detalhes: { retry_after_s: 12 } });
    expect(ErroApiSchema.safeParse(e).success).toBe(true);
  });
});

describe('RN-INT-12 (proposta): parâmetros de rota e query', () => {
  it('limite_erros e limite de pedidos têm padrão e teto', () => {
    expect(QueryConsultaLote.parse({}).limite_erros).toBe(1000);
    expect(QueryConsultaLote.parse({ limite_erros: '200' }).limite_erros).toBe(200);
    expect(QueryConsultaLote.safeParse({ limite_erros: '999999' }).success).toBe(false);
    expect(QueryPedidosPendentes.parse({}).limite).toBe(50);
    expect(QueryPedidosPendentes.safeParse({ limite: '0' }).success).toBe(false);
  });

  it('cadastro de Conector: tipo padrão conector e IPs opcionais', () => {
    const c = ConectorCriar.parse({ conector_id: 'matriz-01', nome: 'Matriz' });
    expect(c.tipo).toBe('conector');
    expect(c.ips_permitidos).toEqual([]);
    expect(c.recebe_pedidos).toBe(true);
  });

  it('RN-INT-01: evento interno integracao.lote.recebido@1 não leva linhas nem dado pessoal', () => {
    const e = LoteRecebidoEvento.parse({ lote_id: UUID, conector_id: 'matriz-01', entidade: 'cliente', modo: 'delta', recebidas: 4, recebido_em: '2026-11-01T10:00:00Z', registros: [{ razao_social: 'X' }] });
    expect(Object.keys(e).sort()).toEqual(['conector_id', 'entidade', 'lote_id', 'modo', 'recebidas', 'recebido_em']);
  });

  it('RN-INT-07: reconciliação provisória (lote em aberto) é comparada depois', () => {
    const r = RespostaReconciliacao.parse({ situacao: 'pendente', entidade: 'preco', data_referencia: '2026-11-01', divergente: false, motivos: [], contagem: { erp: 10, macuxi: 8, diferenca: -2, dentro: false }, soma: null });
    expect(r.situacao).toBe('pendente');
    expect(RespostaReconciliacao.parse({ ...r, situacao: undefined }).situacao).toBe('comparada');
  });
});

describe('RN-INT-09: tabela de rotas do Hub', () => {
  it('as 7 rotas do Conector, com status de sucesso e erros declarados; só o sinal é liberado abaixo da mínima', () => {
    expect(ROTAS_HUB.map((r) => `${r.metodo} ${r.caminho}`)).toEqual([
      'POST /lotes',
      'GET /lotes/{id}',
      'GET /cursores/{entidade}',
      'POST /reconciliacoes',
      'GET /pedidos/pendentes',
      'POST /pedidos/{pedido_uuid}/retorno',
      'POST /sinal',
    ]);
    expect(ROTAS_HUB.find((r) => r.id === 'enviar_lote')?.sucesso.status).toBe(202);
    expect(ROTAS_HUB.filter((r) => r.liberadaAbaixoDaMinima).map((r) => r.id)).toEqual(['sinal']);
    for (const r of ROTAS_HUB) for (const s of r.erros) expect(Object.values(STATUS_HTTP_ERRO_HUB)).toContain(s);
  });

  it('o doc hub-api.md descreve cada rota (contrato e documento não se afastam)', () => {
    const doc = readFileSync(resolve(__dirname, '../../../docs/modulos/integracao/hub-api.md'), 'utf8');
    for (const r of ROTAS_HUB) expect(doc, `${r.metodo} /integracao/v1${r.caminho}`).toContain(`\`${r.metodo} /integracao/v1${r.caminho}\``);
  });
});

describe('RN-INT-08: pedido aprovado que entra na fila', () => {
  it('traz o código da condição do Macuxi (o de-para vira condicao_pagamento_erp no Hub)', () => {
    const p = PedidoAprovadoParaFila.parse({
      pedido_uuid: UUID,
      cliente_external_id: 'C1',
      vendedor_external_id: 'V1',
      condicao_pagamento_codigo: '30DD',
      criado_em: '2026-11-01T09:00:00Z',
      aprovado_em: '2026-11-01T10:00:00Z',
      itens: [{ sequencia: 1, produto_external_id: 'SKU1', quantidade: 2, preco_unitario_cents: 500, total_cents: 1000 }],
      total_cents: 1000,
    });
    expect(p.desconto_total_cents).toBe(0);
    expect(PedidoAprovadoParaFila.safeParse({ ...p, itens: [] }).success).toBe(false);
  });
});

describe('P-4 (decisão do gerente): sequência repetida em itens_faturados não recusa mais o retorno', () => {
  const base = { versao_contrato: 'v1', pedido_uuid: '3f2b8c1e-5a4d-4e6f-9a1b-2c3d4e5f6a7b', status: 'faturado_parcial', numero_erp: 'P-1', nota: { numero: '100', serie: '1', emitida_em: '2026-11-01T10:00:00Z', total_cents: 200 }, ocorrido_em: '2026-11-01T10:00:00Z' };
  const it1 = { sequencia: 1, produto_external_id: 'SKU1', quantidade: 1, valor_cents: 100 };
  it('P-4: o envelope com a mesma sequência duas vezes é válido (o domain descarta as linhas e aceita o status)', () => {
    expect(RetornoErp.safeParse({ ...base, itens_faturados: [it1, it1] }).success).toBe(true);
  });
  it('P-4: sequencia_repetida é código de item descartado e de RetornoAceito', () => {
    expect(ItemFaturadoDescartado.safeParse({ indice: 0, sequencia: 1, produto_external_id: 'SKU1', quantidade: 1, codigo: 'sequencia_repetida', codigos: ['sequencia_repetida'], campo: 'itens_faturados[0].sequencia', motivo: 'repetida' }).success).toBe(true);
  });
});

describe('T-0186 (Cliente 360): campos opcionais e aditivos em titulo e nota', () => {
  const base = { external_id: 'X-1', alterado_em: '2026-11-05T12:30:00Z', cliente_external_id: 'C1' };
  const titulo = { ...base, numero: '5531', vencimento: '2026-11-20', valor_cents: 1000, saldo_cents: 1000, situacao: 'aberto' };
  const nota = { ...base, tipo: 'devolucao', numero: '9', emitida_em: '2026-11-05T12:30:00Z', total_cents: 500 };

  it('título e nota antigos (sem os campos novos) continuam válidos', () => {
    expect(SCHEMA_REGISTRO.titulo.safeParse(titulo).success).toBe(true);
    expect(SCHEMA_REGISTRO.nota.safeParse(nota).success).toBe(true);
  });

  it('título com NF e forma de pagamento passa, com espaços aparados', () => {
    const r = SCHEMA_REGISTRO.titulo.parse({ ...titulo, nf_numero: ' 8841 ', nf_serie: '1', forma_pagamento: ' Boleto 28 dias ' });
    expect(r).toMatchObject({ nf_numero: '8841', nf_serie: '1', forma_pagamento: 'Boleto 28 dias' });
  });

  it('nota com forma de pagamento e NF original da devolução passa; null também vale', () => {
    const r = SCHEMA_REGISTRO.nota.parse({ ...nota, forma_pagamento: 'Boleto 28 dias', nf_origem_numero: '8841', nf_origem_serie: '1' });
    expect(r).toMatchObject({ forma_pagamento: 'Boleto 28 dias', nf_origem_numero: '8841', nf_origem_serie: '1' });
    expect(SCHEMA_REGISTRO.nota.safeParse({ ...nota, nf_origem_numero: null, nf_origem_serie: null, forma_pagamento: null }).success).toBe(true);
  });

  it('tipos e limites são recusados', () => {
    expect(SCHEMA_REGISTRO.titulo.safeParse({ ...titulo, nf_numero: 8841 }).success).toBe(false);
    expect(SCHEMA_REGISTRO.titulo.safeParse({ ...titulo, nf_numero: 'x'.repeat(41) }).success).toBe(false);
    expect(SCHEMA_REGISTRO.titulo.safeParse({ ...titulo, nf_serie: 'x'.repeat(11) }).success).toBe(false);
    expect(SCHEMA_REGISTRO.titulo.safeParse({ ...titulo, forma_pagamento: 'x'.repeat(120) }).success).toBe(true);
    expect(SCHEMA_REGISTRO.nota.safeParse({ ...nota, forma_pagamento: 'x'.repeat(120) }).success).toBe(true);
    expect(SCHEMA_REGISTRO.titulo.safeParse({ ...titulo, forma_pagamento: 'x'.repeat(121) }).success).toBe(false);
    expect(SCHEMA_REGISTRO.nota.safeParse({ ...nota, forma_pagamento: 'x'.repeat(121) }).success).toBe(false);
    expect(SCHEMA_REGISTRO.nota.safeParse({ ...nota, nf_origem_numero: 'x'.repeat(41) }).success).toBe(false);
    expect(SCHEMA_REGISTRO.nota.safeParse({ ...nota, nf_origem_serie: 'x'.repeat(11) }).success).toBe(false);
  });

  it('RN-INT-NF-ORIGEM: NF de origem em nota que não é devolução é recusada (mesmo motivo do CHECK nota_erp_nf_origem_so_devolucao)', () => {
    const fat = { ...nota, tipo: 'faturamento' };
    expect(SCHEMA_REGISTRO.nota.safeParse(fat).success).toBe(true);
    expect(SCHEMA_REGISTRO.nota.safeParse({ ...fat, nf_origem_numero: null, nf_origem_serie: '' }).success).toBe(true);
    const a = SCHEMA_REGISTRO.nota.safeParse({ ...fat, nf_origem_numero: '8841' });
    expect(a.success).toBe(false);
    expect(SCHEMA_REGISTRO.nota.safeParse({ ...fat, nf_origem_serie: '1' }).success).toBe(false);
  });
});
