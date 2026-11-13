/**
 * T-0061 / ADR 0016: entidades novas do Hub (produto_unidade, cliente_endereco, catalogo_no, transportadora), medidas (RN-CORE-19)
 * e pedido ampliado que só vai a Conector que o entende.
 */
import { describe, expect, it } from 'vitest';
import { EVENTOS_ATUALIZADO, ENTIDADES, PedidoAprovadoParaFila, PedidoParaErp, VERSAO_CONTRATO, type PedidoParaErp as PedidoErp } from '../contracts';
import { montarAlertasMonitor } from './monitor';
import { ordenarCarga, referenciasDoRegistro, verificarReferencias, avisosReferenciaFraca } from './ordem';
import { validarLinhas } from './idempotencia';
import { siglasDeMedidaDoRegistro, siglasParaConferir, verificarMedidas } from './medidas';
import { conectorAtendePedido, exigeConector, pedidosAguardandoConector } from './pedido-versao';
import { montarPedidoParaErp, selecionarPendentes, type PedidoNaFila } from './pedido-fila';

const T = '2026-11-02T12:00:00Z';
const base = { alterado_em: T };

describe('RN-INT-02: entidades novas do contrato canônico', () => {
  it('RN-INT-09: as 4 entidades entram aditivas no v1 (a T-0089 leva a 15 e a T-0149 a 16) e cada uma tem evento atualizado@1', () => {
    expect(ENTIDADES).toHaveLength(16);
    for (const e of ['catalogo_no', 'produto_unidade', 'cliente_endereco', 'transportadora'] as const) {
      expect(ENTIDADES).toContain(e);
      expect(EVENTOS_ATUALIZADO[e]).toBeDefined();
    }
  });

  it('RN-INT-03: produto_unidade válida passa; fator zero, fracionado e sigla inválida viram erro de linha legível', () => {
    const r = validarLinhas('produto_unidade', [
      { ...base, external_id: 'PU1', produto_external_id: 'P1', unidade: 'cx', fator: 12, padrao: false },
      { ...base, external_id: 'PU2', produto_external_id: 'P1', unidade: 'CX', fator: 0 },
      { ...base, external_id: 'PU3', produto_external_id: 'P1', unidade: 'CX', fator: 1.5 },
      { ...base, external_id: 'PU4', produto_external_id: 'P1', unidade: 'CAIXA GRANDE', fator: 6 },
    ]);
    expect(r.validas.map((l) => l.external_id)).toEqual(['PU1']);
    expect((r.validas[0]?.registro as { unidade: string }).unidade).toBe('CX');
    expect(r.erros.map((e) => e.campo)).toEqual(['fator', 'fator', 'unidade']);
  });

  it('RN-INT-03: cliente_endereco exige logradouro, cidade e UF; tipo padrão é entrega', () => {
    const r = validarLinhas('cliente_endereco', [
      { ...base, external_id: 'E1', cliente_external_id: 'C1', logradouro: 'Rua A', cidade: 'Boa Vista', uf: 'rr' },
      { ...base, external_id: 'E2', cliente_external_id: 'C1', logradouro: 'Rua B', uf: 'RR' },
    ]);
    expect(r.validas).toHaveLength(1);
    expect((r.validas[0]?.registro as { tipo: string; uf: string }).tipo).toBe('entrega');
    expect((r.validas[0]?.registro as { uf: string }).uf).toBe('RR');
    expect(r.erros[0]?.campo).toBe('cidade');
  });

  it('RN-INT-03: transportadora com CNPJ de 14 dígitos; catalogo_no com nível de 1 a 8', () => {
    const t = validarLinhas('transportadora', [
      { ...base, external_id: 'T1', nome: 'Rápido', documento: '12345678000199' },
      { ...base, external_id: 'T2', nome: 'Lento', documento: '123' },
    ]);
    expect(t.validas.map((l) => l.external_id)).toEqual(['T1']);
    const n = validarLinhas('catalogo_no', [
      { ...base, external_id: 'N1', codigo: 'BEB', nome: 'Bebidas', nivel: 1 },
      { ...base, external_id: 'N2', codigo: 'X', nome: 'Fundo', nivel: 9 },
    ]);
    expect(n.validas.map((l) => l.external_id)).toEqual(['N1']);
  });
});

describe('RN-INT-04: ordem e referências das entidades novas', () => {
  it('RN-INT-04: catalogo_no antes de produto, produto_unidade depois de produto, cliente_endereco depois de cliente', () => {
    const r = ordenarCarga<string>(['cliente_endereco', 'produto_unidade', 'produto', 'cliente', 'catalogo_no', 'vendedor']);
    expect(r.ok).toBe(true);
    const o = r.ok ? r.ordem : [];
    expect(o.indexOf('catalogo_no')).toBeLessThan(o.indexOf('produto'));
    expect(o.indexOf('produto')).toBeLessThan(o.indexOf('produto_unidade'));
    expect(o.indexOf('cliente')).toBeLessThan(o.indexOf('cliente_endereco'));
  });

  it('RN-INT-04: produto_unidade sem produto e cliente_endereco sem cliente = referencia_ausente reprocessável', () => {
    const pu = verificarReferencias('produto_unidade', [{ indice: 0, external_id: 'PU1', registro: { produto_external_id: 'P9' } }], { produto: new Set(['P1']) });
    expect(pu.aceitas).toHaveLength(0);
    expect(pu.erros[0]).toMatchObject({ codigo: 'referencia_ausente', reprocessavel: true, campo: 'produto_external_id' });
    expect(referenciasDoRegistro('cliente_endereco', { cliente_external_id: 'C1' })).toEqual([{ entidade: 'cliente', campo: 'cliente_external_id', external_id: 'C1' }]);
    const ok = verificarReferencias('cliente_endereco', [{ indice: 0, external_id: 'E1', registro: { cliente_external_id: 'C1' } }], { cliente: new Set(['C1']) });
    expect(ok.aceitas).toHaveLength(1);
  });

  it('RN-INT-04: nó do catálogo ausente no produto é aviso referencia_fraca_ausente, nunca erro', () => {
    const linhas = [
      { indice: 0, external_id: 'P1', registro: { catalogo_no_external_id: 'N9' } },
      { indice: 1, external_id: 'P2', registro: { catalogo_no_external_id: 'N1' } },
      { indice: 2, external_id: 'P3', registro: {} },
    ];
    const av = avisosReferenciaFraca('produto', linhas, { catalogo_no: new Set(['N1']) });
    expect(av).toHaveLength(1);
    expect(av[0]).toMatchObject({ indice: 0, external_id: 'P1', codigo: 'referencia_fraca_ausente' });
    expect(verificarReferencias('produto', linhas, {}).aceitas).toHaveLength(3);
  });
});

describe('RN-CORE-19: medida desconhecida é referencia_ausente', () => {
  const linhas = [
    { indice: 0, external_id: 'P1', registro: { unidade: 'UN' } },
    { indice: 1, external_id: 'P2', registro: { unidade: 'xx' } },
  ];

  it('RN-CORE-19: sigla fora das medidas ativas do tenant vira referencia_ausente reprocessável', () => {
    const r = verificarMedidas('produto', linhas, new Set(['UN', 'CX']));
    expect(r.aceitas.map((l) => l.external_id)).toEqual(['P1']);
    expect(r.erros).toHaveLength(1);
    expect(r.erros[0]).toMatchObject({ indice: 1, codigo: 'referencia_ausente', reprocessavel: true, campo: 'unidade' });
    expect(r.erros[0]?.mensagem).toContain('XX');
  });

  it('RN-CORE-19: sem como conferir (core.medidas@1 indisponível) ninguém é recusado', () => {
    expect(verificarMedidas('produto', linhas, null).aceitas).toHaveLength(2);
  });

  it('RN-CORE-19: produto, produto_unidade e preço com unidade são conferidos; outras entidades e preço sem unidade, não', () => {
    expect(siglasParaConferir('produto_unidade', [{ registro: { unidade: 'cx' } }, { registro: { unidade: 'CX' } }])).toEqual(['CX']);
    expect(siglasParaConferir('preco', [{ registro: {} }])).toEqual([]);
    expect(siglasParaConferir('cliente', [{ registro: { unidade: 'UN' } }])).toEqual([]);
  });

  it('RN-CORE-19: produto confere a unidade E a embalagem_medida (cada uma com o seu campo); embalagem ausente ou vazia não é conferida', () => {
    expect(siglasDeMedidaDoRegistro('produto', { unidade: 'un', embalagem_medida: ' cx ', embalagem_quantidade: 12 })).toEqual([
      { campo: 'unidade', sigla: 'UN' },
      { campo: 'embalagem_medida', sigla: 'CX' },
    ]);
    expect(siglasDeMedidaDoRegistro('produto', { unidade: 'UN', embalagem_medida: null })).toEqual([{ campo: 'unidade', sigla: 'UN' }]);
    expect(siglasDeMedidaDoRegistro('produto', { unidade: 'UN', embalagem_medida: '  ' })).toEqual([{ campo: 'unidade', sigla: 'UN' }]);
    expect(siglasDeMedidaDoRegistro('produto_unidade', { unidade: 'CX', embalagem_medida: 'FD' })).toEqual([{ campo: 'unidade', sigla: 'CX' }]);
    expect(siglasParaConferir('produto', [{ registro: { unidade: 'UN', embalagem_medida: 'CX' } }, { registro: { unidade: 'CX' } }])).toEqual(['UN', 'CX']);
  });

  it('RN-INT-04: embalagem_medida desconhecida recusa a linha (referencia_ausente reprocessável) citando a sigla e o campo', () => {
    const l = [{ indice: 3, external_id: 'P9', registro: { unidade: 'UN', embalagem_medida: 'ZZ', embalagem_quantidade: 6 } }];
    const r = verificarMedidas('produto', l, new Set(['UN', 'CX']));
    expect(r.aceitas).toEqual([]);
    expect(r.erros).toEqual([
      {
        indice: 3,
        external_id: 'P9',
        codigo: 'referencia_ausente',
        campo: 'embalagem_medida',
        mensagem: "Medida 'ZZ' não cadastrada (campo embalagem_medida). Cadastre em Parâmetros → Produtos e reprocesse.",
        reprocessavel: true,
      },
    ]);
  });

  it('RN-INT-04: a mensagem cita a sigla e o campo; medida inativa pede para reativar, não para cadastrar', () => {
    const l = [{ indice: 0, external_id: 'P1', registro: { unidade: 'xx' } }, { indice: 1, external_id: 'P2', registro: { unidade: 'LT' } }];
    const r = verificarMedidas('produto', l, new Set(['UN']), new Set(['LT']));
    expect(r.erros.map((e) => e.mensagem)).toEqual([
      "Medida 'XX' não cadastrada (campo unidade). Cadastre em Parâmetros → Produtos e reprocesse.",
      "Medida 'LT' está inativa (campo unidade). Reative em Parâmetros → Produtos e reprocesse.",
    ]);
    expect(r.erros.every((e) => e.codigo === 'referencia_ausente' && e.reprocessavel)).toBe(true);
  });
});

describe('RN-CORE-19: sigla de medida fora do formato é erro de validação (não reprocessável)', () => {
  const MSG = (s: string, campo: string) => `Medida '${s}' inválida (campo ${campo}): use de 1 a 4 letras. Corrija no ERP.`;

  it('RN-CORE-19: sigla fora de ^[A-Z]{1,4}$ (após trim e maiúsculas) vira formato_invalido NÃO reprocessável, sem consultar o Core', () => {
    const l = [
      { indice: 0, external_id: 'P1', registro: { unidade: 'caixa' } },
      { indice: 1, external_id: 'P2', registro: { unidade: 'CX12' } },
      { indice: 2, external_id: 'P3', registro: { unidade: 'UN', embalagem_medida: 'c-x', embalagem_quantidade: 6 } },
      { indice: 3, external_id: 'P4', registro: { unidade: ' un ' } },
    ];
    const r = verificarMedidas('produto', l, new Set(['UN']));
    expect(r.aceitas.map((x) => x.external_id)).toEqual(['P4']);
    expect(r.erros).toEqual([
      { indice: 0, external_id: 'P1', codigo: 'formato_invalido', campo: 'unidade', mensagem: MSG('CAIXA', 'unidade'), reprocessavel: false },
      { indice: 1, external_id: 'P2', codigo: 'formato_invalido', campo: 'unidade', mensagem: MSG('CX12', 'unidade'), reprocessavel: false },
      { indice: 2, external_id: 'P3', codigo: 'formato_invalido', campo: 'embalagem_medida', mensagem: MSG('C-X', 'embalagem_medida'), reprocessavel: false },
    ]);
  });

  it('RN-CORE-19: o formato é conferido mesmo sem como consultar o Core (consulta indisponível não deixa sigla ruim passar)', () => {
    const r = verificarMedidas('produto', [{ indice: 0, external_id: 'P1', registro: { unidade: 'CAIXA' } }], null);
    expect(r.aceitas).toEqual([]);
    expect(r.erros[0]).toMatchObject({ codigo: 'formato_invalido', reprocessavel: false });
  });

  it('RN-CORE-19: sigla bem formada mas desconhecida segue referencia_ausente reprocessável (preço e produto_unidade também)', () => {
    for (const e of ['preco', 'produto_unidade'] as const) {
      const r = verificarMedidas(e, [{ indice: 0, external_id: 'X', registro: { unidade: 'zz' } }], new Set(['UN']));
      expect(r.erros).toHaveLength(1);
      expect(r.erros[0]).toMatchObject({ codigo: 'referencia_ausente', reprocessavel: true, campo: 'unidade' });
    }
    const f = verificarMedidas('preco', [{ indice: 0, external_id: 'X', registro: { unidade: 'CAIXA' } }], new Set(['UN']));
    expect(f.erros[0]).toMatchObject({ codigo: 'formato_invalido', reprocessavel: false, campo: 'unidade', mensagem: MSG('CAIXA', 'unidade') });
  });

  it('RN-CORE-19: só siglas bem formadas vão à consulta do Core', () => {
    expect(siglasParaConferir('produto', [{ registro: { unidade: 'UN', embalagem_medida: 'CAIXA' } }, { registro: { unidade: 'CX12' } }])).toEqual(['UN']);
  });

  it('RN-CORE-19: produto_unidade com sigla de 5 letras, número ou fator acima de 9999 é erro de linha; CX e fator 9999 passam', () => {
    const r = validarLinhas('produto_unidade', [
      { ...base, external_id: 'A', produto_external_id: 'P1', unidade: 'CX', fator: 9999 },
      { ...base, external_id: 'B', produto_external_id: 'P1', unidade: 'CX12', fator: 6 },
      { ...base, external_id: 'C', produto_external_id: 'P1', unidade: 'CAIXA', fator: 6 },
      { ...base, external_id: 'D', produto_external_id: 'P1', unidade: 'CX', fator: 10000 },
    ]);
    expect(r.validas.map((l) => l.external_id)).toEqual(['A']);
    expect(r.erros.map((e) => [e.external_id, e.campo, e.codigo, e.reprocessavel])).toEqual([
      ['B', 'unidade', 'formato_invalido', false],
      ['C', 'unidade', 'formato_invalido', false],
      ['D', 'fator', 'valor_fora_da_faixa', false],
    ]);
  });

  it('RN-CORE-19: embalagem_quantidade do produto é inteira de 2 a 9999; fora disso, valor_fora_da_faixa não reprocessável', () => {
    const p = (q: number, id: string) => ({ ...base, external_id: id, sku: id, nome: 'n', unidade: 'UN', embalagem_medida: 'CX', embalagem_quantidade: q });
    const r = validarLinhas('produto', [p(2, 'A'), p(9999, 'B'), p(1, 'C'), p(10000, 'D'), p(2147483648, 'E')]);
    expect(r.validas.map((l) => l.external_id)).toEqual(['A', 'B']);
    expect(r.erros.map((e) => [e.external_id, e.campo, e.codigo, e.reprocessavel])).toEqual([
      ['C', 'embalagem_quantidade', 'valor_fora_da_faixa', false],
      ['D', 'embalagem_quantidade', 'valor_fora_da_faixa', false],
      ['E', 'embalagem_quantidade', 'valor_fora_da_faixa', false],
    ]);
  });
});

const item = (extra: Record<string, unknown> = {}) => ({ sequencia: 1, produto_external_id: 'P1', quantidade: 12, preco_unitario_cents: 100, desconto_cents: 0, total_cents: 1200, ...extra });
const pedido = (extra: Record<string, unknown> = {}, itens = [item()]): PedidoErp =>
  PedidoParaErp.parse({
    versao_contrato: VERSAO_CONTRATO,
    pedido_uuid: '11111111-1111-4111-8111-111111111111',
    cliente_external_id: 'C1',
    vendedor_external_id: 'V1',
    criado_em: T,
    aprovado_em: T,
    itens,
    total_cents: 1200,
    ...extra,
  });
const fob = { modalidade: 'FOB', transportadora: { tipo: 'digitada', nome: 'Rápido', cnpj: '12345678000199' } };

describe('RN-INT-08 / ADR 0016: pedido ampliado e versão do Conector', () => {
  it('RN-INT-11: UN + CIF + sem endereço especial continua indo ao 1.2.1 (exigeConector nulo)', () => {
    expect(exigeConector(pedido())).toBeNull();
    expect(exigeConector(pedido({ frete: { modalidade: 'CIF' } }, [item({ unidade: 'UN', fator: 1, quantidade_venda: 12 })]))).toBeNull();
    expect(exigeConector(pedido({ endereco_entrega: { logradouro: 'Rua A', cidade: 'Boa Vista', uf: 'RR', principal: true } }))).toBeNull();
  });

  it('RN-INT-11: CX (fator > 1), acréscimo, frete FOB ou endereço não principal exigem o Conector 1.3.0', () => {
    expect(exigeConector(pedido({}, [item({ unidade: 'CX', fator: 12, quantidade_venda: 1 })]))).toBe('1.3.0');
    expect(exigeConector(pedido({}, [item({ acrescimo_cents: 50 })]))).toBe('1.3.0');
    expect(exigeConector(pedido({ acrescimo_pct: 2 }))).toBe('1.3.0');
    expect(exigeConector(pedido({ frete: fob }))).toBe('1.3.0');
    expect(exigeConector(pedido({ endereco_entrega: { logradouro: 'Rua B', cidade: 'Boa Vista', uf: 'RR' } }))).toBe('1.3.0');
  });

  it('RN-INT-08: FOB sem transportadora não passa pelo contrato (nada chega à fila)', () => {
    expect(PedidoParaErp.safeParse({ ...pedido(), frete: { modalidade: 'FOB' } }).success).toBe(false);
    expect(PedidoParaErp.safeParse({ ...pedido(), frete: { modalidade: 'FOB', transportadora: { tipo: 'digitada', nome: 'X' } } }).success).toBe(false);
  });

  const naFila = (p: PedidoErp): PedidoNaFila => ({
    pedido_uuid: p.pedido_uuid, estado: 'pendente', payload: p, retencao_codigo: null, enviado_em: null, tentativas: 0, numero_erp: null, motivo: null,
    notas_aplicadas: [], itens_faturados_acumulados: {}, removido_em: null,
  });

  it('RN-INT-11: pedido com CX não é entregue ao Conector 1.2.1 e é entregue ao 1.3.0; o pedido simples sai nos dois', () => {
    const cx = pedido({ pedido_uuid: '22222222-2222-4222-8222-222222222222' }, [item({ unidade: 'CX', fator: 12, quantidade_venda: 1 })]);
    const un = pedido();
    const fila = [naFila(cx), naFila(un)];
    const antigo = selecionarPendentes(fila, T, { versaoConector: '1.2.1' });
    expect(antigo.entregar.map((p) => p.pedido_uuid)).toEqual([un.pedido_uuid]);
    const novo = selecionarPendentes(fila, T, { versaoConector: '1.3.0' });
    expect(novo.entregar).toHaveLength(2);
  });

  it('RN-INT-11: pedido FOB espera o 1.3.0; versão ilegível ou ausente não atende a exigência', () => {
    expect(conectorAtendePedido('1.2.1', '1.3.0')).toBe(false);
    expect(conectorAtendePedido('1.3.0', '1.3.0')).toBe(true);
    expect(conectorAtendePedido('1.4.0-rc.1', '1.3.0')).toBe(true);
    expect(conectorAtendePedido(null, '1.3.0')).toBe(false);
    expect(conectorAtendePedido(null, null)).toBe(true);
  });

  it('RN-INT-08: a quantidade do item é a da unidade base (quantidade_venda x fator) e vai ao payload do ERP', () => {
    const origem = PedidoAprovadoParaFila.parse({
      pedido_uuid: '33333333-3333-4333-8333-333333333333', cliente_external_id: 'C1', vendedor_external_id: 'V1', criado_em: T, aprovado_em: T,
      itens: [item({ unidade: 'CX', fator: 12, quantidade_venda: 2, quantidade: 24 })], total_cents: 2400, frete: fob,
    });
    const m = montarPedidoParaErp(origem, []);
    expect(m.ok).toBe(true);
    if (!m.ok) return;
    const it0 = m.pedido.itens[0];
    expect(it0?.quantidade).toBe((it0?.quantidade_venda ?? 0) * (it0?.fator ?? 0));
    expect(m.pedido.frete).toEqual(fob);
    expect(exigeConector(m.pedido)).toBe('1.3.0');
  });

  it('RN-INT-08: pedido sem os campos novos gera o mesmo payload de antes (sem chaves extras)', () => {
    const origem = PedidoAprovadoParaFila.parse({
      pedido_uuid: '44444444-4444-4444-8444-444444444444', cliente_external_id: 'C1', vendedor_external_id: 'V1', criado_em: T, aprovado_em: T, itens: [item()], total_cents: 1200,
    });
    const m = montarPedidoParaErp(origem, []);
    expect(m.ok && Object.keys(m.pedido).sort()).toEqual(
      ['aprovado_em', 'cliente_external_id', 'condicao_pagamento_erp', 'criado_em', 'desconto_total_cents', 'itens', 'observacao', 'pedido_uuid', 'tentativa', 'total_cents', 'vendedor_external_id', 'versao_contrato'].sort(),
    );
  });

  it('RN-INT-04: o monitor alerta pedido_aguardando_conector com a versão exigida e a ação seguinte', () => {
    const espera = pedidosAguardandoConector(
      [{ pedido_uuid: 'a', exige_conector: '1.3.0' }, { pedido_uuid: 'b', exige_conector: null }],
      '1.2.1',
    );
    expect(espera).toEqual({ pedidos: ['a'], exigida: '1.3.0' });
    const alertas = montarAlertasMonitor({
      agora: T, conectores: [], lotesFalhosUltimas24h: [], pendenciasInativacao: [], reconciliacoesDivergentes: [], pedidos: { presos: [], retidos: [] },
      pedidosAguardandoConector: espera,
    });
    const a = alertas.find((x) => x.codigo === 'pedido_aguardando_conector');
    expect(a?.mensagem).toContain('1.3.0');
    expect(a?.mensagem).toContain('atualize o Conector');
    expect(pedidosAguardandoConector([{ pedido_uuid: 'a', exige_conector: '1.3.0' }], '1.3.0').pedidos).toEqual([]);
  });
});
