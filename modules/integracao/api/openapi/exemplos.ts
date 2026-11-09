/**
 * Exemplos do OpenAPI do Hub (T-0087). Fonte única: o gerador publica estes valores, o guia (`docs/guia-api-hub.md`) usa os
 * mesmos e `openapi.test.ts` prova que cada um passa no contrato Zod e no JSON Schema gerado.
 *
 * Dados fictícios: CNPJ 11222333000181 (formato válido, não é de empresa real), nomes genéricos, domínio example.com,
 * dinheiro em centavos, datas UTC com `Z`, UUID v4.
 */
import type { z } from 'zod';
import type {
  CursorEntidade,
  LoteAceito,
  LoteEnvelope,
  LoteResultado,
  PedidoParaErp,
  PedidosPendentes,
  ReconciliacaoEnvio,
  RespostaReconciliacao,
  RespostaSinal,
  RetornoAceito,
  RetornoErp,
  SinalConector,
  SCHEMA_REGISTRO,
  Entidade,
} from '../../contracts';

export interface Exemplo<T = unknown> {
  /** Chave do exemplo no OpenAPI (`examples.<chave>`). */
  chave: string;
  resumo: string;
  valor: T;
}

const ex = <T>(chave: string, resumo: string, valor: T): Exemplo<T> => ({ chave, resumo, valor });

export const CONECTOR_ID_EXEMPLO = 'erp-matriz';
export const VERSAO_CONECTOR_EXEMPLO = '1.2.1';
export const CHAVE_IDEMPOTENCIA_EXEMPLO = '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08';
export const REQUISICAO_ID_EXEMPLO = 'req-7f3a9c2e41d8';
export const LOTE_ID_EXEMPLO = '5b1d7c42-9a3e-4f68-8c10-2e7a94d3b6f1';
export const PEDIDO_UUID_EXEMPLO = '3f2b8c1e-7a4d-4e5b-9c6a-1d2e3f4a5b6c';
export const SESSAO_ID_EXEMPLO = 'c0a8e3d2-5b71-4a96-b4f0-7d19e8a2c635';

const ALTERADO_EM = '2026-11-05T13:45:10Z';
const ENVIADO_EM = '2026-11-05T13:46:00Z';

// ------------------------------------------------------------------------------------------------ um registro por entidade

type RegistroEntrada = { [E in Entidade]: z.input<(typeof SCHEMA_REGISTRO)[E]> };

export const EXEMPLO_REGISTRO: RegistroEntrada = {
  vendedor: { external_id: 'V001', alterado_em: ALTERADO_EM, ativo: true, nome: 'Vendedor Exemplo', email: 'vendedor@example.com', telefone: '+55 95 3000-0001' },
  cliente: {
    external_id: 'C000123',
    alterado_em: ALTERADO_EM,
    ativo: true,
    razao_social: 'Mercado Exemplo Ltda',
    nome_fantasia: 'Mercado Exemplo',
    documento: '11222333000181',
    vendedor_external_id: 'V001',
    endereco: { logradouro: 'Rua das Palmeiras', numero: '100', bairro: 'Centro', cidade: 'Boa Vista', uf: 'RR', cep: '69301000' },
    latitude: 2.8235,
    longitude: -60.6758,
    telefone: '+55 95 3000-0002',
    email: 'compras@example.com',
    limite_credito_cents: 5000000,
    inscricao_estadual: 'ISENTO',
    bloqueado: false,
    contatos: [{ nome: 'Contato Exemplo', cargo: 'Comprador', telefone: '+55 95 3000-0003', email: 'contato@example.com' }],
    prazo_medio_max_dias: 60,
    formas_pagamento: ['BOL', 'PIX'],
  },
  produto: {
    external_id: 'P000045',
    alterado_em: ALTERADO_EM,
    ativo: true,
    sku: 'REF-0045',
    ean: '7891234567895',
    nome: 'Refrigerante Cola 2 L',
    marca: 'Marca Exemplo',
    categoria: 'Bebidas',
    unidade: 'UN',
    embalagem_medida: 'CX',
    embalagem_quantidade: 6,
    catalogo_no_external_id: 'N010',
    custo_cents: 450,
    preco_venda_cents: 790,
    desconto_maximo_pct: 5,
  },
  preco: {
    external_id: 'TAB01:P000045',
    alterado_em: ALTERADO_EM,
    ativo: true,
    tabela_external_id: 'TAB01',
    tabela_nome: 'Tabela Atacado',
    vigencia_inicio: '2026-11-01',
    vigencia_fim: null,
    produto_external_id: 'P000045',
    preco_cents: 790,
    unidade: 'UN',
  },
  estoque: {
    external_id: 'DEP01:P000045',
    alterado_em: ALTERADO_EM,
    ativo: true,
    deposito_external_id: 'DEP01',
    deposito_nome: 'Depósito Central',
    produto_external_id: 'P000045',
    saldo: 1250,
  },
  titulo: {
    external_id: 'TIT-2026-5531-1',
    alterado_em: ALTERADO_EM,
    ativo: true,
    cliente_external_id: 'C000123',
    numero: '5531',
    parcela: 1,
    emissao: '2026-10-20',
    vencimento: '2026-11-20',
    valor_cents: 125000,
    saldo_cents: 125000,
    situacao: 'aberto',
    baixado_em: null,
  },
  nota: {
    external_id: 'NF-1-8841',
    alterado_em: ALTERADO_EM,
    ativo: true,
    cliente_external_id: 'C000123',
    vendedor_external_id: 'V001',
    tipo: 'faturamento',
    numero: '8841',
    serie: '1',
    emitida_em: '2026-11-05T12:30:00Z',
    total_cents: 125000,
    quantidade_itens: 12,
    pedido_uuid: PEDIDO_UUID_EXEMPLO,
    cancelada: false,
  },
  rota: {
    external_id: 'R-SEG-01',
    alterado_em: ALTERADO_EM,
    ativo: true,
    nome: 'Rota Segunda Centro',
    vendedor_external_id: 'V001',
    dia_semana: 1,
    paradas: [
      { ordem: 1, cliente_external_id: 'C000123' },
      { ordem: 2, cliente_external_id: 'C000124' },
    ],
  },
  catalogo_no: { external_id: 'N010', alterado_em: ALTERADO_EM, ativo: true, codigo: 'BEB-REF', nome: 'Refrigerantes', pai_external_id: 'N001', nivel: 2, ordem: 1 },
  produto_unidade: { external_id: 'P000045:CX', alterado_em: ALTERADO_EM, ativo: true, produto_external_id: 'P000045', unidade: 'CX', fator: 6, ean: '17891234567892', padrao: false },
  cliente_endereco: {
    external_id: 'C000123:ENT1',
    alterado_em: ALTERADO_EM,
    ativo: true,
    cliente_external_id: 'C000123',
    tipo: 'entrega',
    descricao: 'Depósito dos fundos',
    logradouro: 'Avenida das Flores',
    numero: '250',
    bairro: 'Industrial',
    cidade: 'Boa Vista',
    uf: 'RR',
    cep: '69313000',
    principal: false,
  },
  transportadora: { external_id: 'T001', alterado_em: ALTERADO_EM, ativo: true, nome: 'Transportadora Exemplo', documento: '11222333000181', telefone: '+55 95 3000-0004' },
  forma_pagamento: { external_id: 'FP-BOL', alterado_em: ALTERADO_EM, ativo: true, codigo: 'BOL', nome: 'Boleto', ordem: 1 },
  prazo_pagamento: {
    external_id: 'PZ-30-60-90',
    alterado_em: ALTERADO_EM,
    ativo: true,
    forma_external_id: 'FP-BOL',
    codigo: '306090',
    descricao: '30/60/90 dias',
    parcelas_dias: [30, 60, 90],
    prazo_medio_dias: 60,
    ordem: 2,
  },
  tabela_escalonada: {
    external_id: 'ESC:P000045:CX:12',
    alterado_em: ALTERADO_EM,
    ativo: true,
    produto_external_id: 'P000045',
    medida: 'CX',
    quantidade_minima: 12,
    preco_unidade_cents: 740,
    vigencia_inicio: '2026-11-01',
    vigencia_fim: null,
    tabela_external_id: 'TAB01',
  },
};

const RESUMO_ENTIDADE: Record<Entidade, string> = {
  vendedor: 'Vendedores (delta)',
  cliente: 'Clientes (delta)',
  produto: 'Produtos (delta)',
  preco: 'Preços: um registro por item de tabela (delta)',
  estoque: 'Estoque: um registro por depósito e produto (delta)',
  titulo: 'Títulos financeiros (delta)',
  nota: 'Notas fiscais e devoluções (delta)',
  rota: 'Rotas com as paradas (delta)',
  catalogo_no: 'Árvore do catálogo (delta)',
  produto_unidade: 'Medidas e embalagens do produto (delta)',
  cliente_endereco: 'Endereços de entrega e cobrança do cliente (delta)',
  transportadora: 'Transportadoras (delta)',
  forma_pagamento: 'Formas de pagamento (delta)',
  prazo_pagamento: 'Prazos de pagamento com as parcelas em dias (delta)',
  tabela_escalonada: 'Tabela escalonada: preço da unidade por quantidade mínima (delta)',
};

const loteDelta = (entidade: Entidade): z.input<typeof LoteEnvelope> => ({
  versao_contrato: 'v1',
  entidade,
  modo: 'delta',
  cursor: { alterado_em: ALTERADO_EM, external_id: EXEMPLO_REGISTRO[entidade].external_id },
  enviado_em: ENVIADO_EM,
  conector_id: CONECTOR_ID_EXEMPLO,
  versao_conector: VERSAO_CONECTOR_EXEMPLO,
  registros: [EXEMPLO_REGISTRO[entidade]],
});

const ORDEM_ENTIDADES: readonly Entidade[] = ['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota', 'catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora', 'forma_pagamento', 'prazo_pagamento', 'tabela_escalonada'];

/** `POST /lotes`: um exemplo por entidade, carga completa em partes (sessão) e lote só com linhas inválidas. */
export const EXEMPLOS_LOTE: readonly Exemplo<z.input<typeof LoteEnvelope>>[] = [
  ...ORDEM_ENTIDADES.map((e) => ex(e, RESUMO_ENTIDADE[e], loteDelta(e))),
  ex('carga_completa_parte_1', 'Carga completa, parte 1 de 2 (sessão aberta)', {
    versao_contrato: 'v1',
    entidade: 'vendedor',
    modo: 'completo',
    sessao: { id: SESSAO_ID_EXEMPLO, parte: 1, ultimo: false },
    enviado_em: ENVIADO_EM,
    conector_id: CONECTOR_ID_EXEMPLO,
    versao_conector: VERSAO_CONECTOR_EXEMPLO,
    registros: [EXEMPLO_REGISTRO.vendedor],
  }),
  ex('carga_completa_ultima_parte', 'Carga completa, última parte (ultimo: true fecha a sessão)', {
    versao_contrato: 'v1',
    entidade: 'vendedor',
    modo: 'completo',
    sessao: { id: SESSAO_ID_EXEMPLO, parte: 2, ultimo: true },
    enviado_em: '2026-11-05T13:47:00Z',
    conector_id: CONECTOR_ID_EXEMPLO,
    versao_conector: VERSAO_CONECTOR_EXEMPLO,
    registros: [{ ...EXEMPLO_REGISTRO.vendedor, external_id: 'V002', nome: 'Outro Vendedor Exemplo', email: null, telefone: null }],
  }),
  ex('so_linhas_invalidas', 'Lote só com linhas que o Conector recusou (aceito, termina com erros)', {
    versao_contrato: 'v1',
    entidade: 'cliente',
    modo: 'delta',
    enviado_em: ENVIADO_EM,
    conector_id: CONECTOR_ID_EXEMPLO,
    versao_conector: VERSAO_CONECTOR_EXEMPLO,
    registros: [],
    linhas_invalidas: [
      { external_id: 'C000999', codigo: 'campo_obrigatorio', campo: 'razao_social', mensagem: 'razao_social está vazio no ERP.' },
      { external_id: null, codigo: 'registro_invalido', mensagem: 'Linha sem código do cliente; não foi possível identificá-la.' },
    ],
    linhas_invalidas_omitidas: 0,
  }),
];

// ---------------------------------------------------------------------------------------------------------- demais corpos

export const EXEMPLOS_RECONCILIACAO: readonly Exemplo<z.input<typeof ReconciliacaoEnvio>>[] = [
  ex('estoque', 'Estoque: contagem e soma de controle (saldo)', { versao_contrato: 'v1', entidade: 'estoque', data_referencia: '2026-11-05', contagem: 1250, soma: 48230500 }),
  ex('so_contagem', 'Entidade só com contagem (soma nula)', { versao_contrato: 'v1', entidade: 'cliente', data_referencia: '2026-11-05', contagem: 842, soma: null }),
];

const ITENS_FATURADOS = [
  { sequencia: 1, produto_external_id: 'P000045', quantidade: 24, valor_cents: 6000 },
  { sequencia: 2, produto_external_id: 'P000051', quantidade: 10, valor_cents: 19000 },
];

export const EXEMPLOS_RETORNO: readonly Exemplo<z.input<typeof RetornoErp>>[] = [
  ex('integrado', 'Pedido gravado no ERP (informe o número)', {
    versao_contrato: 'v1',
    pedido_uuid: PEDIDO_UUID_EXEMPLO,
    status: 'integrado',
    numero_erp: 'PV-004512',
    ocorrido_em: '2026-11-05T14:02:00Z',
  }),
  ex('rejeitado_erp', 'ERP recusou o pedido (o motivo é obrigatório)', {
    versao_contrato: 'v1',
    pedido_uuid: PEDIDO_UUID_EXEMPLO,
    status: 'rejeitado_erp',
    motivo: 'Cliente com bloqueio financeiro no ERP.',
    ocorrido_em: '2026-11-05T14:02:00Z',
  }),
  ex('faturado_parcial', 'Faturamento parcial: nota e itens faturados NESTA nota', {
    versao_contrato: 'v1',
    pedido_uuid: PEDIDO_UUID_EXEMPLO,
    status: 'faturado_parcial',
    numero_erp: 'PV-004512',
    nota: { numero: '8841', serie: '1', emitida_em: '2026-11-05T16:30:00Z', total_cents: 6000 },
    itens_faturados: [ITENS_FATURADOS[0] as (typeof ITENS_FATURADOS)[number]],
    ocorrido_em: '2026-11-05T16:31:00Z',
  }),
  ex('faturado_total', 'Faturamento total: última nota do pedido', {
    versao_contrato: 'v1',
    pedido_uuid: PEDIDO_UUID_EXEMPLO,
    status: 'faturado_total',
    numero_erp: 'PV-004512',
    nota: { numero: '8855', serie: '1', emitida_em: '2026-11-06T10:15:00Z', total_cents: 19000 },
    itens_faturados: [ITENS_FATURADOS[1] as (typeof ITENS_FATURADOS)[number]],
    ocorrido_em: '2026-11-06T10:16:00Z',
  }),
  ex('cancelado', 'Cancelamento feito no ERP (o Macuxi nunca cancela no ERP)', {
    versao_contrato: 'v1',
    pedido_uuid: PEDIDO_UUID_EXEMPLO,
    status: 'cancelado',
    motivo: 'Cancelado pelo cliente.',
    ocorrido_em: '2026-11-06T11:00:00Z',
  }),
];

export const EXEMPLOS_SINAL: readonly Exemplo<z.input<typeof SinalConector>>[] = [
  ex('sinal', 'Sinal de vida a cada minuto', {
    conector_id: CONECTOR_ID_EXEMPLO,
    versao_conector: VERSAO_CONECTOR_EXEMPLO,
    versao_contrato: 'v1',
    em: '2026-11-05T14:00:00Z',
    fila: [{ estado: 'pendente', lotes: 1, linhas: 320, maisAntigo: '2026-11-05T13:59:10Z' }],
    entidades: [{ entidade: 'produto', fase: 'delta', ultimo_sucesso: '2026-11-05T13:58:00Z', bloqueada: false, lotes_na_fila: 1 }],
    parado_por_versao: false,
  }),
];

// ------------------------------------------------------------------------------------------------------------ sucessos

const CONTAGENS_ZERO = { recebidas: 0, duplicadas_no_lote: 0, com_erro: 0, novas: 0, atualizadas: 0, inalteradas: 0, obsoletas: 0 };

export const EXEMPLOS_LOTE_ACEITO: readonly Exemplo<z.output<typeof LoteAceito>>[] = [
  ex('aceito', 'Lote recebido (processamento assíncrono)', {
    lote_id: LOTE_ID_EXEMPLO,
    status: 'recebido',
    entidade: 'produto',
    modo: 'delta',
    recebidos: 1,
    consulta: `/integracao/v1/lotes/${LOTE_ID_EXEMPLO}`,
  }),
  ex('repetido', 'Mesma Idempotency-Key e mesmo conteúdo: o lote que já existia (Idempotent-Replay: true)', {
    lote_id: LOTE_ID_EXEMPLO,
    status: 'recebido',
    entidade: 'produto',
    modo: 'delta',
    recebidos: 1,
    repetido: true,
    consulta: `/integracao/v1/lotes/${LOTE_ID_EXEMPLO}`,
  }),
];

export const EXEMPLOS_LOTE_RESULTADO: readonly Exemplo<z.output<typeof LoteResultado>>[] = [
  ex('processando', 'Ainda em processamento (consulte de novo em alguns segundos)', {
    lote_id: LOTE_ID_EXEMPLO,
    entidade: 'produto',
    modo: 'delta',
    status: 'processando',
    contagens: { ...CONTAGENS_ZERO, recebidas: 1 },
    erros: [],
    avisos: [],
    cursor: null,
    inativadas: 0,
    recebido_em: '2026-11-05T13:46:01Z',
    concluido_em: null,
  }),
  ex('concluido', 'Concluído sem erros; o cursor avançou', {
    lote_id: LOTE_ID_EXEMPLO,
    entidade: 'produto',
    modo: 'delta',
    status: 'concluido',
    contagens: { ...CONTAGENS_ZERO, recebidas: 1, novas: 1 },
    erros: [],
    avisos: [],
    cursor: { alterado_em: ALTERADO_EM, external_id: 'P000045' },
    erros_total: 0,
    erros_omitidos: 0,
    inativadas: 0,
    recebido_em: '2026-11-05T13:46:01Z',
    concluido_em: '2026-11-05T13:46:04Z',
  }),
  ex('concluido_com_erros', 'Concluído com erros por linha (reprocessavel: true = o Hub tenta de novo pelo BKO)', {
    lote_id: LOTE_ID_EXEMPLO,
    entidade: 'preco',
    modo: 'delta',
    status: 'concluido_com_erros',
    contagens: { recebidas: 5, duplicadas_no_lote: 0, com_erro: 2, novas: 1, atualizadas: 2, inalteradas: 0, obsoletas: 0 },
    erros: [
      {
        indice: 3,
        external_id: 'TAB01:P000044',
        codigo: 'referencia_ausente',
        campo: 'produto_external_id',
        mensagem: 'O campo "produto_external_id" aponta para um produto que ainda não foi carregado. Envie o produto; o Hub reprocessa a linha.',
        reprocessavel: true,
        origem: 'hub',
      },
      {
        indice: 4,
        external_id: 'TAB01:P000046',
        codigo: 'valor_fora_da_faixa',
        campo: 'preco_cents',
        mensagem: 'O campo "preco_cents" não pode ser negativo. Corrija no ERP; o registro volta no próximo delta.',
        reprocessavel: false,
        origem: 'hub',
      },
    ],
    avisos: [{ indice: 1, external_id: 'TAB01:P000045', codigo: 'duplicado_no_lote', mensagem: 'O external_id aparece mais de uma vez no lote; valeu a última ocorrência.' }],
    cursor: { alterado_em: ALTERADO_EM, external_id: 'TAB01:P000045' },
    erros_total: 2,
    erros_omitidos: 0,
    inativadas: 0,
    recebido_em: '2026-11-05T13:46:01Z',
    concluido_em: '2026-11-05T13:46:06Z',
  }),
  ex('inativacao_aguardando', 'Última parte de uma carga completa: a trava de 30 % segurou a inativação', {
    lote_id: LOTE_ID_EXEMPLO,
    entidade: 'cliente',
    modo: 'completo',
    status: 'concluido',
    contagens: { recebidas: 600, duplicadas_no_lote: 0, com_erro: 0, novas: 0, atualizadas: 12, inalteradas: 588, obsoletas: 0 },
    erros: [],
    avisos: [],
    cursor: { alterado_em: ALTERADO_EM, external_id: 'C000899' },
    inativacao: { situacao: 'aguardando_confirmacao', motivo: 'excede_limite_inativacao', candidatos: 412, percentual: 40.7 },
    inativadas: 0,
    recebido_em: '2026-11-05T13:46:01Z',
    concluido_em: '2026-11-05T13:47:30Z',
  }),
];

export const EXEMPLOS_CURSOR: readonly Exemplo<z.output<typeof CursorEntidade>>[] = [
  ex('com_cursor', 'Delta: continue a partir do cursor', { entidade: 'produto', cursor: { alterado_em: ALTERADO_EM, external_id: 'P000045' }, atualizado_em: '2026-11-05T13:46:04Z' }),
  ex('sem_cursor', 'Cursor nulo: nunca recebeu, faça a carga inicial completa', { entidade: 'cliente', cursor: null, atualizado_em: null }),
];

export const EXEMPLOS_RECONCILIACAO_RESPOSTA: readonly Exemplo<z.output<typeof RespostaReconciliacao>>[] = [
  ex('comparada', 'Contagem e soma batem', {
    situacao: 'comparada',
    entidade: 'estoque',
    data_referencia: '2026-11-05',
    divergente: false,
    motivos: [],
    contagem: { erp: 1250, macuxi: 1250, diferenca: 0, dentro: true },
    soma: { erp: 48230500, macuxi: 48230500, diferenca: 0, diferenca_pct: 0, dentro: true },
  }),
  ex('divergente', 'Divergência de contagem (aparece como alerta no monitor)', {
    situacao: 'comparada',
    entidade: 'cliente',
    data_referencia: '2026-11-05',
    divergente: true,
    motivos: ['contagem_divergente'],
    contagem: { erp: 842, macuxi: 790, diferenca: 52, dentro: false },
    soma: null,
  }),
];

export const PEDIDO_PARA_ERP_EXEMPLO: z.output<typeof PedidoParaErp> = {
  versao_contrato: 'v1',
  pedido_uuid: PEDIDO_UUID_EXEMPLO,
  cliente_external_id: 'C000123',
  vendedor_external_id: 'V001',
  condicao_pagamento_erp: '30DD',
  criado_em: '2026-11-05T13:10:00Z',
  aprovado_em: '2026-11-05T13:40:00Z',
  observacao: 'Entregar pela manhã.',
  itens: [
    {
      sequencia: 1,
      produto_external_id: 'P000045',
      quantidade: 24,
      preco_unitario_cents: 250,
      desconto_cents: 0,
      total_cents: 6000,
      unidade: 'CX',
      fator: 6,
      quantidade_venda: 4,
    },
    { sequencia: 2, produto_external_id: 'P000051', quantidade: 10, preco_unitario_cents: 1990, desconto_cents: 900, total_cents: 19000 },
  ],
  desconto_total_cents: 900,
  total_cents: 25000,
  tentativa: 1,
  frete: {
    modalidade: 'FOB',
    transportadora: { tipo: 'cadastrada', id: '8d3c5e7a-1b2f-4c6d-a9e0-4f5a6b7c8d9e', external_id: 'T001', nome: 'Transportadora Exemplo', cnpj: '11222333000181' },
  },
  endereco_entrega: { logradouro: 'Avenida das Flores', numero: '250', bairro: 'Industrial', cidade: 'Boa Vista', uf: 'RR', cep: '69313000', principal: false, origem: 'editado' },
};

export const EXEMPLOS_PEDIDOS_PENDENTES: readonly Exemplo<z.output<typeof PedidosPendentes>>[] = [
  ex('com_pedido', 'Um pedido aprovado (o Hub o marca como enviado ao entregar)', { pedidos: [PEDIDO_PARA_ERP_EXEMPLO] }),
  ex('vazio', 'Nenhum pedido pendente (normal)', { pedidos: [] }),
];

export const EXEMPLOS_RETORNO_ACEITO: readonly Exemplo<z.output<typeof RetornoAceito>>[] = [
  ex('integrado', 'Retorno aplicado', { pedido_uuid: PEDIDO_UUID_EXEMPLO, status: 'integrado', repetido: false }),
  ex('repetido', 'Mesmo retorno enviado de novo: aceito sem reaplicar (repetido: true)', { pedido_uuid: PEDIDO_UUID_EXEMPLO, status: 'integrado', repetido: true }),
  ex('itens_descartados', 'Faturamento aceito; um item não bate com o pedido enviado e foi descartado (P-4)', {
    pedido_uuid: PEDIDO_UUID_EXEMPLO,
    status: 'faturado_parcial',
    repetido: false,
    itens_descartados: [
      {
        indice: 1,
        sequencia: 9,
        produto_external_id: 'P000099',
        quantidade: 3,
        codigo: 'sequencia_inexistente',
        codigos: ['sequencia_inexistente'],
        campo: 'itens_faturados[1].sequencia',
        motivo: 'O pedido enviado não tem o item de sequência 9. O item foi ignorado; o status do retorno valeu.',
      },
    ],
  }),
];

export const EXEMPLOS_RESPOSTA_SINAL: readonly Exemplo<z.output<typeof RespostaSinal>>[] = [
  ex('com_politica', 'Política de versão vigente para este Conector', {
    politica_versao: { versao_minima: '1.2.1', versao_recomendada: '1.2.1', mensagem: 'O Conector 1.2.0 ou anterior reenvia itens no fechamento sem nota nova.', pacote: null },
    conector_id: CONECTOR_ID_EXEMPLO,
    recebido_em: '2026-11-05T14:00:01Z',
  }),
];

// ---------------------------------------------------------------------------------------------------------------- erros

const erro = (codigo: string, mensagem: string, extra: Record<string, unknown> = {}) => ({ codigo, mensagem, ...extra, requisicao_id: REQUISICAO_ID_EXEMPLO });
const recusa = (codigo: string, campo: string | null, mensagem: string, extra: Record<string, unknown> = {}) =>
  erro(codigo, mensagem, { erros: [{ codigo, campo, mensagem }], ...extra });

const ERRO_426 = recusa('versao_conector_nao_suportada', null, 'A versão do Conector está abaixo da mínima exigida (1.2.1). Atualize o Conector.', { detalhes: { versao_minima: '1.2.1' } });
const ERRO_400_REQUISICAO = erro('requisicao_invalida', 'Dados inválidos em corpo.', {
  detalhes: { problemas: [{ caminho: 'corpo.data_referencia', mensagem: 'data deve estar no formato AAAA-MM-DD' }] },
});

/** Erros comuns a todas as rotas (viram `components.responses`). */
export const EXEMPLOS_ERRO_COMUM: Record<401 | 403 | 429 | 500 | 503, readonly Exemplo[]> = {
  401: [ex('credencial_invalida', 'Chave desconhecida, revogada, expirada ou de outro Conector (a mensagem é genérica de propósito)', erro('credencial_invalida', 'Credencial inválida. Confira a chave de API e o identificador do Conector.'))],
  403: [
    ex('acesso_negado', 'Conector desativado, IP fora da lista ou sem permissão para a rota', erro('acesso_negado', 'Acesso negado para este Conector.')),
    ex('modulo_inativo', 'A empresa não tem o módulo Integração ativo', erro('modulo_inativo', 'O módulo Integração não está ativo para esta empresa.')),
  ],
  429: [
    ex('limite_de_taxa', 'Balde de chamadas do Conector vazio: espere Retry-After segundos', erro('limite_de_taxa', 'O Conector chamou o Hub mais vezes do que o permitido. Aguarde um instante; o Conector retoma sozinho.')),
    ex('falhas_de_autenticacao', 'Muitas falhas de autenticação do mesmo IP (20 por minuto)', erro('limite_de_taxa', 'Muitas falhas de autenticação deste endereço. Aguarde e confira a chave do Conector.')),
  ],
  500: [ex('erro_interno', 'Erro inesperado no Hub; informe o requisicao_id ao suporte', erro('erro_interno', 'Erro interno no Hub. O Conector tenta de novo; se continuar, avise o suporte.'))],
  503: [ex('servico_indisponivel', 'Banco ou fila indisponível; repita com backoff', erro('servico_indisponivel', 'O Hub está indisponível no momento. O Conector tenta de novo sozinho.'))],
};

/** Erros próprios de cada rota, por status. */
export const EXEMPLOS_ERRO_ROTA: Record<string, Record<number, readonly Exemplo[]>> = {
  enviar_lote: {
    400: [
      ex('envelope_invalido', 'Corpo fora do envelope (todos os problemas voltam juntos)', recusa('envelope_invalido', 'modo', 'modo: use "completo" ou "delta".')),
      ex('chave_idempotencia_invalida', 'Idempotency-Key ausente ou fora do formato', recusa('chave_idempotencia_invalida', 'Idempotency-Key', 'O cabeçalho Idempotency-Key é obrigatório em POST /lotes e deve ter de 16 a 128 caracteres (letras, números, ponto, hífen, sublinhado e dois-pontos). O Conector envia o SHA-256 do lote.')),
    ],
    409: [ex('chave_idempotencia_reutilizada', 'Mesma Idempotency-Key com conteúdo diferente', recusa('chave_idempotencia_reutilizada', 'Idempotency-Key', 'A Idempotency-Key já foi usada por outro lote com conteúdo diferente. Gere uma chave nova para o conteúdo novo (o Conector usa o SHA-256 do lote) ou reenvie exatamente o mesmo lote.'))],
    413: [ex('corpo_grande', 'Corpo acima de 8 MiB', erro('corpo_grande', 'O corpo da requisição passa do limite desta rota.', { detalhes: { limite_bytes: 8388608 } }))],
    422: [
      ex('lote_vazio', 'Sem registros e sem linhas inválidas', recusa('lote_vazio', 'registros', 'O lote não tem registros. Envie ao menos um registro.')),
      ex('acima_do_limite', 'Mais de 5.000 registros', recusa('acima_do_limite', 'registros', 'O lote tem 5200 registros e o limite é 5000. Divida em lotes menores (na carga completa, use partes da mesma sessão).')),
      ex('sessao_ausente', 'Carga completa sem sessão', recusa('sessao_ausente', 'sessao', 'A carga completa exige "sessao" (id, parte e ultimo).')),
      ex('entidade_de_outro_conector', 'A entidade é alimentada por outro Conector da empresa', recusa('entidade_de_outro_conector', 'entidade', 'A entidade "cliente" não está no cadastro deste Conector. Peça ao administrador da empresa para incluí-la no Conector ou use o Conector que já a envia.')),
    ],
    426: [ex('versao_conector_nao_suportada', 'Conector abaixo da versão mínima', ERRO_426)],
  },
  consultar_lote: {
    404: [ex('lote_nao_encontrado', 'Lote inexistente, de outro Conector ou de outra empresa (não se distingue)', erro('lote_nao_encontrado', 'Lote não encontrado para este Conector. Se o envio foi interrompido, reenvie o lote com a mesma Idempotency-Key.'))],
    426: [ex('versao_conector_nao_suportada', 'Conector abaixo da versão mínima', ERRO_426)],
  },
  consultar_cursor: {
    404: [ex('entidade_desconhecida', 'Entidade fora da lista', erro('entidade_desconhecida', 'Entidade desconhecida. Use uma de: vendedor, cliente, produto, preco, estoque, titulo, nota, rota, catalogo_no, produto_unidade, cliente_endereco, transportadora, forma_pagamento, prazo_pagamento, tabela_escalonada.'))],
    426: [ex('versao_conector_nao_suportada', 'Conector abaixo da versão mínima', ERRO_426)],
  },
  enviar_reconciliacao: {
    400: [ex('requisicao_invalida', 'Corpo fora do contrato', ERRO_400_REQUISICAO)],
    422: [ex('entidade_de_outro_conector', 'A entidade é alimentada por outro Conector da empresa', recusa('entidade_de_outro_conector', 'entidade', 'A entidade "cliente" não está no cadastro deste Conector. Peça ao administrador da empresa para incluí-la no Conector ou use o Conector que já a envia.'))],
    426: [ex('versao_conector_nao_suportada', 'Conector abaixo da versão mínima', ERRO_426)],
  },
  pedidos_pendentes: {
    426: [ex('versao_conector_nao_suportada', 'Conector abaixo da versão mínima', ERRO_426)],
  },
  retorno_pedido: {
    400: [ex('requisicao_invalida', 'Corpo fora do contrato (ou pedido_uuid do caminho diferente do corpo)', erro('requisicao_invalida', 'Dados inválidos em corpo.', { detalhes: { problemas: [{ caminho: 'corpo.numero_erp', mensagem: 'informe o número do pedido no ERP' }] } }))],
    422: [
      ex('pedido_desconhecido', 'O Hub não conhece o pedido', recusa('pedido_desconhecido', null, 'O Hub não conhece este pedido. Só pedidos aprovados e entregues ao Conector recebem retorno.')),
      ex('transicao_invalida', 'Estado informado não é possível a partir do estado atual', recusa('transicao_invalida', 'status', 'Transição inválida do pedido: rejeitado_erp → faturado_total. rejeitado_erp é um estado final.')),
      ex('numero_erp_divergente', 'O mesmo pedido já tem outro número no ERP', recusa('numero_erp_divergente', 'numero_erp', 'O pedido já tem o número PV-004512 no ERP e o retorno informa outro. Confira no ERP se o pedido foi gravado duas vezes.')),
    ],
    426: [ex('versao_conector_nao_suportada', 'Conector abaixo da versão mínima', ERRO_426)],
  },
  sinal: {
    400: [ex('requisicao_invalida', 'Corpo fora do contrato', erro('requisicao_invalida', 'Dados inválidos em corpo.', { detalhes: { problemas: [{ caminho: 'corpo.versao_conector', mensagem: 'versão deve seguir o formato MAIOR.MENOR.PATCH (ex.: 1.1.0)' }] } }))],
  },
};
