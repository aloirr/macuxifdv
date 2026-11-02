import { PedidoParaErp } from '@macuxi/integracao/contracts';
import { afterEach, describe, expect, it } from 'vitest';
import { acompanharStatus, buscarPedidos, cicloPedidos, enviarRetornos, gravarPedidos } from '../src/pedidos';
import { type Ambiente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente;
afterEach(async () => amb?.encerrar());

const UUID = '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f01';
const pedido = (extra: Record<string, unknown> = {}) =>
  PedidoParaErp.parse({
    versao_contrato: 'v1', pedido_uuid: UUID, cliente_external_id: 'c1', vendedor_external_id: 'v1', condicao_pagamento_erp: '30D',
    criado_em: '2026-03-10T11:00:00Z', aprovado_em: '2026-03-10T11:30:00Z', total_cents: 3000,
    itens: [
      { sequencia: 1, produto_external_id: 'p1', quantidade: 2, preco_unitario_cents: 1000, total_cents: 2000 },
      { sequencia: 2, produto_external_id: 'p2', quantidade: 1, preco_unitario_cents: 1000, total_cents: 1000 },
    ],
    ...extra,
  });

const PEDIDOS = {
  gravacao: { cabecalho: '/*cab*/ INSERT INTO pedido VALUES (:pedido_uuid)', itens: '/*item*/ INSERT INTO item VALUES (:pedido_uuid, :sequencia)', numeroErp: '/*num*/ SELECT numero_erp FROM pedido WHERE uuid = :pedido_uuid' },
  status: {
    consulta: '/*st*/ SELECT * FROM v WHERE pedido_uuid = :pedido_uuid',
    consultaItensNota: '/*itn*/ SELECT sequencia, quantidade FROM n WHERE nota_numero = :nota_numero',
    mapaStatus: { I: 'integrado', P: 'faturado_parcial', F: 'faturado_total', C: 'cancelado' },
  },
};

async function preparar(opcoes: { numero?: string | null } = {}) {
  amb = await criarAmbiente({ pedidos: PEDIDOS });
  amb.hub.pedidosParaEntregar = [pedido()];
  const execucoes: string[] = [];
  // o ERP em memória só devolve o número DEPOIS de receber o cabeçalho (como o ERP real): a consulta feita antes de gravar vem vazia
  let gravou = false;
  amb.erp.onExecucao = (sql, p) => {
    execucoes.push(`${/\/\*(\w+)\*\//.exec(sql)?.[1]}:${p.sequencia ?? ''}`);
    if (sql.includes('/*cab*/')) gravou = true;
  };
  amb.erp.onConsulta = (sql) => (sql.includes('/*num*/') ? (opcoes.numero === null || !gravou ? [] : [{ numero_erp: opcoes.numero ?? 'PV-1001' }]) : undefined);
  return execucoes;
}

describe('retorno de pedidos ao ERP (RN-INT-08)', () => {
  it('busca o pedido no Hub, grava no ERP (cabeçalho + itens) e confirma com o número do ERP', async () => {
    const execucoes = await preparar();
    const r = await cicloPedidos(amb.ctx);
    expect(r).toMatchObject({ recebidos: 1, gravados: 1, retornosEnviados: 1 });
    expect(execucoes).toEqual(['cab:', 'item:1', 'item:2']);
    expect(amb.hub.retornos).toHaveLength(1);
    expect(amb.hub.retornos[0]).toMatchObject({ versao_contrato: 'v1', pedido_uuid: UUID, status: 'integrado', numero_erp: 'PV-1001' });
    expect(amb.ctx.store.pedido(UUID)).toMatchObject({ estado: 'gravado', numeroErp: 'PV-1001' });
  });

  it('o ERP recebe os dados do pedido como parâmetros tipados (datas UTC, centavos)', async () => {
    amb = await criarAmbiente({ pedidos: PEDIDOS });
    amb.hub.pedidosParaEntregar = [pedido()];
    const vistos: Record<string, unknown>[] = [];
    amb.erp.onExecucao = (sql, p) => void (sql.includes('/*cab*/') && vistos.push(p));
    amb.erp.onConsulta = () => [{ numero_erp: 'X' }];
    await cicloPedidos(amb.ctx);
    expect(vistos[0]).toMatchObject({ pedido_uuid: UUID, cliente_external_id: 'c1', total_cents: 3000, tentativa: 1 });
    expect(vistos[0]?.aprovado_em).toEqual(new Date('2026-03-10T11:30:00Z'));
  });

  it('idempotente pelo UUID: se o Hub reentrega o pedido (timeout de 10 min), o ERP não recebe duas gravações', async () => {
    const execucoes = await preparar();
    await cicloPedidos(amb.ctx);
    amb.hub.pedidosParaEntregar = [pedido({ tentativa: 2 })];
    const r = await cicloPedidos(amb.ctx);
    expect(r.recebidos).toBe(0);
    expect(execucoes).toEqual(['cab:', 'item:1', 'item:2']);
    expect(amb.hub.retornos).toHaveLength(1);
  });

  it('ERP fora do ar não conta tentativa: o pedido é gravado quando a conexão volta', async () => {
    const execucoes = await preparar();
    const falha = Object.assign(new Error('connect ECONNREFUSED'), { code: 'ECONNREFUSED' });
    let cair = true;
    const gravarNoErp = amb.erp.onExecucao;
    amb.erp.onExecucao = (sql, p) => {
      if (cair) throw falha;
      gravarNoErp?.(sql, p);
    };
    await cicloPedidos(amb.ctx);
    expect(amb.ctx.store.pedido(UUID)).toMatchObject({ estado: 'recebido', tentativas: 0 });
    cair = false;
    amb.relogio.avancar(120_000);
    const r = await cicloPedidos(amb.ctx);
    expect(r.gravados).toBe(1);
    expect(execucoes).toEqual(['cab:', 'item:1', 'item:2']); // o ERP não tinha o pedido: a consulta prévia veio vazia e a gravação aconteceu
    expect(amb.hub.retornos).toHaveLength(1);
  });

  it('RN-INT-08: falha de conexão DEPOIS do COMMIT (o ERP gravou, a resposta se perdeu) não duplica o pedido no ERP', async () => {
    const execucoes = await preparar();
    const falha = Object.assign(new Error('read ECONNRESET'), { code: 'ECONNRESET' });
    const consultaDoErp = amb.erp.onConsulta;
    let perder = true;
    amb.erp.onConsulta = (sql, p) => {
      if (perder && sql.includes('/*num*/')) {
        perder = false;
        throw falha; // cabeçalho e itens já foram aplicados; a conexão cai antes de a resposta chegar
      }
      return consultaDoErp?.(sql, p);
    };
    await cicloPedidos(amb.ctx);
    expect(execucoes).toEqual(['cab:', 'item:1', 'item:2']);
    expect(amb.ctx.store.pedido(UUID)).toMatchObject({ estado: 'recebido', tentativas: 0 });
    expect(amb.hub.retornos).toHaveLength(0);

    amb.relogio.avancar(120_000);
    const r = await cicloPedidos(amb.ctx);
    expect(r.gravados).toBe(1);
    expect(execucoes).toEqual(['cab:', 'item:1', 'item:2']); // nenhuma gravação nova
    expect(amb.ctx.store.pedido(UUID)).toMatchObject({ estado: 'gravado', numeroErp: 'PV-1001', erro: null });
    expect(amb.hub.retornos).toHaveLength(1);
    expect(amb.hub.retornos[0]).toMatchObject({ status: 'integrado', numero_erp: 'PV-1001' });
    expect(amb.logs.some((l) => l.includes('pedido_ja_existia_no_erp'))).toBe(true);
  });

  it('a consulta do número antes de gravar só acontece em nova tentativa: o primeiro envio vai direto à gravação', async () => {
    await preparar();
    const consultas: string[] = [];
    const consultaDoErp = amb.erp.onConsulta;
    amb.erp.onConsulta = (sql, p) => {
      if (sql.includes('/*num*/')) consultas.push(sql);
      return consultaDoErp?.(sql, p);
    };
    await cicloPedidos(amb.ctx, { buscar: true });
    expect(consultas).toHaveLength(1); // só a de dentro da transação, depois de gravar
  });

  it('erro de SQL/regra do ERP esgota as tentativas e devolve o pedido como rejeitado_erp com o motivo', async () => {
    await preparar();
    amb.erp.onExecucao = () => {
      throw new Error('violação da restrição fk_cliente');
    };
    for (let i = 0; i < 3; i++) {
      await cicloPedidos(amb.ctx);
      amb.relogio.avancar(120_000);
    }
    expect(amb.hub.retornos).toHaveLength(1);
    expect(amb.hub.retornos[0]).toMatchObject({ status: 'rejeitado_erp', motivo: expect.stringContaining('fk_cliente') });
    expect(amb.ctx.store.pedido(UUID)).toMatchObject({ estado: 'rejeitado_erp', final: true, tentativas: 3 });
  });

  it('ERP que não devolve o número do pedido gravado conta como falha (não confirma com número vazio)', async () => {
    await preparar({ numero: null });
    for (let i = 0; i < 3; i++) {
      await cicloPedidos(amb.ctx);
      amb.relogio.avancar(120_000);
    }
    expect(amb.hub.retornos[0]).toMatchObject({ status: 'rejeitado_erp', motivo: expect.stringContaining('número do pedido') });
  });

  it('faturamento parcial com itens, depois total: um retorno por nota, sem repetir', async () => {
    await preparar();
    await cicloPedidos(amb.ctx);
    const linhasStatus = [
      { status: 'I', numero_erp: 'PV-1001', ocorrido_em: new Date('2026-03-10T12:00:00Z') },
      { status: 'P', numero_erp: 'PV-1001', nota_numero: '501', nota_serie: '1', nota_emitida_em: new Date('2026-03-11T10:00:00Z'), nota_total_cents: 2000, ocorrido_em: new Date('2026-03-11T10:00:00Z') },
    ];
    amb.erp.onConsulta = (sql) => {
      if (sql.includes('/*st*/')) return linhasStatus;
      if (sql.includes('/*itn*/')) return [{ sequencia: 1, produto_external_id: 'p1', quantidade: 2, valor_cents: 2000 }];
      return undefined;
    };
    amb.relogio.avancar(120_000);
    await cicloPedidos(amb.ctx);
    const parcial = amb.hub.retornos.find((r) => (r as { status: string }).status === 'faturado_parcial');
    expect(parcial).toMatchObject({ numero_erp: 'PV-1001', nota: { numero: '501', serie: '1', total_cents: 2000 }, itens_faturados: [{ sequencia: 1, produto_external_id: 'p1', quantidade: 2, valor_cents: 2000 }] });

    // segunda nota fecha o pedido
    linhasStatus.push({ status: 'F', numero_erp: 'PV-1001', nota_numero: '502', nota_serie: '1', nota_emitida_em: new Date('2026-03-12T10:00:00Z'), nota_total_cents: 1000, ocorrido_em: new Date('2026-03-12T10:00:00Z') });
    amb.erp.onConsulta = (sql) => (sql.includes('/*st*/') ? linhasStatus : sql.includes('/*itn*/') ? [{ sequencia: 2, produto_external_id: 'p2', quantidade: 1, valor_cents: 1000 }] : undefined);
    await cicloPedidos(amb.ctx);
    await cicloPedidos(amb.ctx); // repetir o ciclo não reenvia nada
    expect(amb.hub.retornos.map((r) => (r as { status: string }).status)).toEqual(['integrado', 'faturado_parcial', 'faturado_total']);
    expect(amb.ctx.store.pedido(UUID)).toMatchObject({ estado: 'faturado_total', final: true });
  });

  it('RN-INT-08: itens_faturados leva sequência, quantidade, valor em centavos e o produto do ERP; sequência repetida soma', async () => {
    await preparar();
    await cicloPedidos(amb.ctx);
    amb.erp.onConsulta = (sql) => {
      if (sql.includes('/*st*/')) return [{ status: 'P', numero_erp: 'PV-1001', nota_numero: '601', nota_serie: '1', nota_total_cents: 2500, nota_emitida_em: new Date('2026-03-11T10:00:00Z') }];
      // Oracle devolve colunas em minúsculas após o adaptador; maiúsculas também funcionam (busca sem diferenciar caixa)
      if (sql.includes('/*itn*/')) {
        return [
          { SEQUENCIA: 1, QUANTIDADE: 1, VALOR_CENTS: 1000, PRODUTO_EXTERNAL_ID: 'p1' },
          { SEQUENCIA: 1, QUANTIDADE: 1, VALOR_CENTS: 1000, PRODUTO_EXTERNAL_ID: 'p1' },
          { SEQUENCIA: 2, QUANTIDADE: 1, VALOR_CENTS: 500, PRODUTO_EXTERNAL_ID: 'p2' },
        ];
      }
      return undefined;
    };
    await cicloPedidos(amb.ctx);
    const parcial = amb.hub.retornos.find((r) => (r as { status: string }).status === 'faturado_parcial');
    expect(parcial).toMatchObject({
      nota: { numero: '601', total_cents: 2500 },
      itens_faturados: [
        { sequencia: 1, produto_external_id: 'p1', quantidade: 2, valor_cents: 2000 },
        { sequencia: 2, produto_external_id: 'p2', quantidade: 1, valor_cents: 500 },
      ],
    });
  });

  it('RN-INT-08: item sem valor, com valor fracionário ou sem produto invalida os itens da nota com motivo claro; nunca inventa valor', async () => {
    const casos: { linha: Record<string, unknown>; motivo: string }[] = [
      { linha: { sequencia: 1, quantidade: 1, produto_external_id: 'p1', valor_cents: 10.5 }, motivo: 'valor_cents deve ser inteiro' },
      { linha: { sequencia: 1, quantidade: 1, produto_external_id: 'p1' }, motivo: 'valor_cents ausente' },
      { linha: { sequencia: 1, quantidade: 1, produto_external_id: 'p1', valor_cents: '' }, motivo: 'valor_cents ausente' },
      { linha: { sequencia: 1, quantidade: 1, valor_cents: 100 }, motivo: 'produto_external_id ausente' },
    ];
    for (const caso of casos) {
      await preparar();
      await cicloPedidos(amb.ctx);
      amb.erp.onConsulta = (sql) => {
        if (sql.includes('/*st*/')) return [{ status: 'P', numero_erp: 'PV-1001', nota_numero: '602', nota_total_cents: 100 }];
        if (sql.includes('/*itn*/')) return [caso.linha];
        return undefined;
      };
      await cicloPedidos(amb.ctx);
      const parcial = amb.hub.retornos.find((r) => (r as { status: string }).status === 'faturado_parcial') as Record<string, unknown>;
      expect(parcial.itens_faturados).toBeUndefined();
      expect(amb.logs.join('\n')).toContain('itens_faturados_omitidos');
      expect(amb.logs.join('\n')).toContain(caso.motivo);
    }
  });

  it('RN-INT-08: duas notas parciais do mesmo pedido são dois retornos (a 2ª nota parcial não some)', async () => {
    await preparar();
    await cicloPedidos(amb.ctx);
    const linhas = [
      { status: 'P', numero_erp: 'PV-1001', nota_numero: '701', nota_serie: '1', nota_total_cents: 1000, nota_emitida_em: new Date('2026-03-11T10:00:00Z') },
      { status: 'P', numero_erp: 'PV-1001', nota_numero: '702', nota_serie: '1', nota_total_cents: 1000, nota_emitida_em: new Date('2026-03-12T10:00:00Z') },
    ];
    // o ERP ainda não fechou o pedido: as duas notas são parciais (o status do ERP é do pedido, e aqui nenhuma é a última)
    amb.erp.onConsulta = (sql) => (sql.includes('/*st*/') ? linhas : undefined);
    await cicloPedidos(amb.ctx);
    const parciais = amb.hub.retornos.filter((r) => (r as { status: string }).status === 'faturado_parcial') as { nota: { numero: string } }[];
    expect(parciais.map((r) => r.nota.numero)).toEqual(['701', '702']);
  });

  it('itens faturados fracionários ou inválidos são omitidos (o campo é opcional) em vez de mandar errado', async () => {
    await preparar();
    await cicloPedidos(amb.ctx);
    amb.erp.onConsulta = (sql) => {
      if (sql.includes('/*st*/')) return [{ status: 'F', numero_erp: 'PV-1001', nota_numero: '9', nota_total_cents: 3000 }];
      if (sql.includes('/*itn*/')) return [{ sequencia: 1, quantidade: 1.5, produto_external_id: 'p1', valor_cents: 100 }];
      return undefined;
    };
    await cicloPedidos(amb.ctx);
    const total = amb.hub.retornos.find((r) => (r as { status: string }).status === 'faturado_total') as Record<string, unknown>;
    expect(total).toBeDefined();
    expect(total.itens_faturados).toBeUndefined();
  });

  it('cancelamento feito no ERP volta como cancelado, com motivo; o Conector nunca escreve cancelamento no ERP', async () => {
    const execucoes = await preparar();
    await cicloPedidos(amb.ctx);
    const antes = execucoes.length;
    amb.erp.onConsulta = (sql) => (sql.includes('/*st*/') ? [{ status: 'C', motivo: 'cliente desistiu' }] : undefined);
    await cicloPedidos(amb.ctx);
    expect(amb.hub.retornos[1]).toMatchObject({ status: 'cancelado', motivo: 'cliente desistiu', numero_erp: 'PV-1001' });
    expect(execucoes).toHaveLength(antes);
    expect(amb.ctx.store.pedido(UUID)?.final).toBe(true);
  });

  it('situação do ERP sem equivalente no contrato (ex.: em separação) é ignorada', async () => {
    await preparar();
    await cicloPedidos(amb.ctx);
    amb.erp.onConsulta = (sql) => (sql.includes('/*st*/') ? [{ status: 'S' }] : undefined);
    await cicloPedidos(amb.ctx);
    expect(amb.hub.retornos).toHaveLength(1);
  });

  it('retorno guardado localmente: com o Hub fora o retorno espera na fila e sai depois', async () => {
    await preparar();
    await buscarPedidos(amb.ctx);
    await gravarPedidos(amb.ctx, PEDIDOS_CFG());
    amb.hub.caido = true;
    await enviarRetornos(amb.ctx);
    expect(amb.hub.retornos).toHaveLength(0);
    expect(amb.ctx.store.contarRetornos()).toEqual([{ estado: 'pendente', total: 1 }]);
    amb.reiniciar();
    amb.hub.caido = false;
    amb.relogio.avancar(120_000);
    await enviarRetornos(amb.ctx);
    expect(amb.hub.retornos).toHaveLength(1);
  });

  it('retorno que viola o contrato (faturado sem nota) nem é enfileirado', async () => {
    await preparar();
    await cicloPedidos(amb.ctx, { buscar: true, status: false });
    amb.erp.onConsulta = (sql) => (sql.includes('/*st*/') ? [{ status: 'F', numero_erp: 'PV-1001' }] : undefined); // faturado sem nota: contrato recusa antes de sair
    await acompanharStatus(amb.ctx, PEDIDOS_CFG());
    expect(amb.hub.retornos).toHaveLength(1); // só o integrado; o faturado sem nota nem foi enfileirado
    expect(amb.logs.some((l) => l.includes('retorno_invalido_nao_enviado'))).toBe(true);
  });

  it('retorno recusado por regra pelo Hub (422, ex.: transição inválida) não é repetido', async () => {
    await preparar();
    amb.hub.recusarProximoRetorno = { codigo: 'transicao_invalida', mensagem: 'transição de estado inválida' };
    await cicloPedidos(amb.ctx);
    expect(amb.ctx.store.contarRetornos()).toEqual([{ estado: 'recusado', total: 1 }]);
    const posts = amb.hub.chamadas.filter((c) => c.caminho.endsWith('/retorno')).length;
    amb.relogio.avancar(600_000);
    await cicloPedidos(amb.ctx);
    expect(amb.hub.chamadas.filter((c) => c.caminho.endsWith('/retorno')).length).toBe(posts);
  });

  it('com pedidos desativados na configuração, nada é buscado', async () => {
    amb = await criarAmbiente();
    const r = await cicloPedidos(amb.ctx);
    expect(r.recebidos).toBe(0);
    expect(amb.hub.chamadas.filter((c) => c.caminho.includes('pedidos'))).toHaveLength(0);
  });
});

function PEDIDOS_CFG() {
  return amb.ctx.config.pedidos as NonNullable<typeof amb.ctx.config.pedidos>;
}

describe('status do pedido por nota', () => {
  it('quando o ERP marca o PEDIDO como faturado em todas as linhas, só a última nota é faturado_total (as anteriores são parciais)', async () => {
    await preparar();
    await cicloPedidos(amb.ctx);
    amb.erp.onConsulta = (sql) =>
      sql.includes('/*st*/')
        ? [
            { status: 'F', numero_erp: 'PV-1001', nota_numero: '502', nota_serie: '1', nota_emitida_em: new Date('2026-03-12T10:00:00Z'), nota_total_cents: 1000 },
            { status: 'F', numero_erp: 'PV-1001', nota_numero: '501', nota_serie: '1', nota_emitida_em: new Date('2026-03-11T10:00:00Z'), nota_total_cents: 2000 },
          ]
        : undefined;
    await cicloPedidos(amb.ctx);
    const r = amb.hub.retornos.map((x) => x as { status: string; nota?: { numero: string } });
    expect(r.map((x) => [x.status, x.nota?.numero])).toEqual([['integrado', undefined], ['faturado_parcial', '501'], ['faturado_total', '502']]);
  });
});

/**
 * T-0048 (🔴 da revisão final da T-0023): o status do ERP é do PEDIDO. Quando o ERP fecha um pedido parcial SEM nota nova (corte
 * do saldo), a última nota já enviada como `faturado_parcial` vira a "última nota" com status `faturado_total`. Esse fechamento
 * vai com a identificação da nota já enviada (o Hub reconhece a repetição pela nota, RN-INT-08 emenda P-4) e SEM `itens_faturados`:
 * itens de uma nota saem uma única vez, senão o Hub os somaria de novo.
 */
describe('RN-INT-08: a mesma nota nunca sai duas vezes com itens (T-0048)', () => {
  type Ret = { status: string; nota?: { numero: string; serie?: string }; itens_faturados?: { sequencia: number; quantidade: number; valor_cents: number }[] };
  const retornos = () => amb.hub.retornos as Ret[];
  const linhaNota = (status: string, numero: string, dia: string, total: number) => ({
    status, numero_erp: 'PV-1001', nota_numero: numero, nota_serie: '1', nota_emitida_em: new Date(`2026-03-${dia}T10:00:00Z`), nota_total_cents: total, ocorrido_em: new Date(`2026-03-${dia}T10:00:00Z`),
  });
  /** ERP em memória com a consulta de status e os itens por nota. */
  function erp(linhas: Record<string, unknown>[], itensPorNota: Record<string, Record<string, unknown>[]>) {
    amb.erp.onConsulta = (sql, p) => {
      if (sql.includes('/*st*/')) return linhas;
      if (sql.includes('/*itn*/')) return itensPorNota[String(p.nota_numero)] ?? [];
      return undefined;
    };
  }
  /** Soma por sequência de tudo o que o Conector mandou como faturado (o que o Hub acumularia se confiasse em cada retorno). */
  const faturadoPorSequencia = () => {
    const soma: Record<number, number> = {};
    for (const r of retornos()) for (const it of r.itens_faturados ?? []) soma[it.sequencia] = (soma[it.sequencia] ?? 0) + it.quantidade;
    return soma;
  };

  it('RN-INT-08: pedido muda de P para F sem nota nova não reenvia os itens (fechamento leva só a nota já enviada)', async () => {
    await preparar();
    await cicloPedidos(amb.ctx);
    const linhas = [linhaNota('P', '501', '11', 2000)];
    erp(linhas, { '501': [{ sequencia: 1, produto_external_id: 'p1', quantidade: 2, valor_cents: 2000 }] });
    await cicloPedidos(amb.ctx);
    // o ERP fecha o pedido (corta o saldo da sequência 2) sem emitir nota nova
    linhas[0] = linhaNota('F', '501', '11', 2000);
    await cicloPedidos(amb.ctx);
    await cicloPedidos(amb.ctx); // repetir o ciclo não reenvia nada
    expect(retornos().map((r) => [r.status, r.nota?.numero])).toEqual([['integrado', undefined], ['faturado_parcial', '501'], ['faturado_total', '501']]);
    const total = retornos()[2] as Record<string, unknown>;
    expect(total).toMatchObject({ status: 'faturado_total', numero_erp: 'PV-1001', nota: { numero: '501', serie: '1', total_cents: 2000 } });
    expect(total.itens_faturados).toBeUndefined();
    expect(faturadoPorSequencia()).toEqual({ 1: 2 });
    expect(amb.ctx.store.pedido(UUID)).toMatchObject({ estado: 'faturado_total', final: true });
    expect(amb.logs.some((l) => l.includes('fechamento_sem_nota_nova'))).toBe(true);
  });

  it('RN-INT-08: sequência real parcial → parcial → fechamento sem nota nova: cada nota fatura uma vez só', async () => {
    await preparar();
    await cicloPedidos(amb.ctx);
    const itens = { '501': [{ sequencia: 1, produto_external_id: 'p1', quantidade: 1, valor_cents: 1000 }], '502': [{ sequencia: 1, produto_external_id: 'p1', quantidade: 1, valor_cents: 1000 }] };
    const linhas = [linhaNota('P', '501', '11', 1000)];
    erp(linhas, itens);
    await cicloPedidos(amb.ctx); // 1ª nota parcial
    linhas.splice(0, linhas.length, linhaNota('P', '501', '11', 1000), linhaNota('P', '502', '12', 1000));
    await cicloPedidos(amb.ctx); // 2ª nota parcial
    linhas.splice(0, linhas.length, linhaNota('F', '501', '11', 1000), linhaNota('F', '502', '12', 1000));
    await cicloPedidos(amb.ctx); // fechamento sem nota nova
    await cicloPedidos(amb.ctx);
    expect(retornos().map((r) => [r.status, r.nota?.numero, r.itens_faturados?.length ?? 0])).toEqual([
      ['integrado', undefined, 0],
      ['faturado_parcial', '501', 1],
      ['faturado_parcial', '502', 1],
      ['faturado_total', '502', 0],
    ]);
    // sequência 1 tinha 2 unidades: 1 por nota; nada passa do pedido (sequência 2 foi cortada pelo ERP)
    expect(faturadoPorSequencia()).toEqual({ 1: 2 });
  });

  it('RN-INT-08: fechamento COM nota nova continua levando os itens da nota nova (só a nota repetida perde os itens)', async () => {
    await preparar();
    await cicloPedidos(amb.ctx);
    const linhas = [linhaNota('P', '501', '11', 2000)];
    erp(linhas, { '501': [{ sequencia: 1, produto_external_id: 'p1', quantidade: 2, valor_cents: 2000 }], '502': [{ sequencia: 2, produto_external_id: 'p2', quantidade: 1, valor_cents: 1000 }] });
    await cicloPedidos(amb.ctx);
    linhas.splice(0, linhas.length, linhaNota('F', '501', '11', 2000), linhaNota('F', '502', '12', 1000));
    await cicloPedidos(amb.ctx);
    expect(retornos().map((r) => [r.status, r.nota?.numero, r.itens_faturados?.map((i) => i.sequencia)])).toEqual([
      ['integrado', undefined, undefined],
      ['faturado_parcial', '501', [1]],
      ['faturado_total', '502', [2]],
    ]);
    expect(faturadoPorSequencia()).toEqual({ 1: 2, 2: 1 });
  });

  it('RN-INT-08: reenvio após queda do Hub e reinício do Conector mantém a ordem por pedido e não repete itens', async () => {
    await preparar();
    await cicloPedidos(amb.ctx); // integrado já entregue
    const linhas = [linhaNota('P', '501', '11', 1000)];
    erp(linhas, { '501': [{ sequencia: 1, produto_external_id: 'p1', quantidade: 1, valor_cents: 1000 }], '502': [{ sequencia: 1, produto_external_id: 'p1', quantidade: 1, valor_cents: 1000 }] });
    amb.hub.caido = true;
    await cicloPedidos(amb.ctx); // parcial 501 fica na fila local, com espera
    linhas.splice(0, linhas.length, linhaNota('P', '501', '11', 1000), linhaNota('P', '502', '12', 1000));
    amb.relogio.avancar(1_000); // antes de vencer a espera da 501
    await cicloPedidos(amb.ctx); // parcial 502 entra na fila atrás da 501
    linhas.splice(0, linhas.length, linhaNota('F', '501', '11', 1000), linhaNota('F', '502', '12', 1000));
    amb.reiniciar(); // queda de energia: a fila local sobrevive
    amb.hub.caido = false;
    // a 501 ainda espera o backoff: nada do mesmo pedido pode passar na frente dela
    await cicloPedidos(amb.ctx);
    expect(retornos().map((r) => r.status)).toEqual(['integrado']);
    amb.relogio.avancar(600_000);
    await cicloPedidos(amb.ctx);
    await cicloPedidos(amb.ctx);
    expect(retornos().map((r) => [r.status, r.nota?.numero, r.itens_faturados?.length ?? 0])).toEqual([
      ['integrado', undefined, 0],
      ['faturado_parcial', '501', 1],
      ['faturado_parcial', '502', 1],
      ['faturado_total', '502', 0],
    ]);
    expect(faturadoPorSequencia()).toEqual({ 1: 2 });
    expect(amb.ctx.store.contarRetornos()).toEqual([{ estado: 'enviado', total: 4 }]);
  });
});

describe('RN-INT-08: pedido fora do contrato não trava a gravação dos outros (T-0048)', () => {
  it('RN-INT-08: payload local fora do PedidoParaErp vira rejeitado_erp "pedido fora do contrato" (sem valores) e o próximo pedido é gravado', async () => {
    const execucoes = await preparar();
    const OUTRO = '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f02';
    // payload guardado fora do contrato (ex.: gravado por uma versão anterior): sem itens e com total negativo
    const corrompido = { ...JSON.parse(JSON.stringify(pedido())), itens: [], total_cents: -1, observacao: 'CPF 123.456.789-00' };
    amb.ctx.store.registrarPedido(UUID, JSON.stringify(corrompido), amb.relogio.agora());
    amb.hub.pedidosParaEntregar = [pedido({ pedido_uuid: OUTRO })];
    await buscarPedidos(amb.ctx);
    const r = await gravarPedidos(amb.ctx, PEDIDOS_CFG());
    expect(r.gravados).toBe(1);
    expect(r.rejeitados).toBe(1);
    expect(execucoes.filter((e) => e === 'cab:')).toHaveLength(1);
    expect(amb.ctx.store.pedido(UUID)).toMatchObject({ estado: 'rejeitado_erp', final: true });
    expect(amb.ctx.store.pedido(OUTRO)).toMatchObject({ estado: 'gravado', numeroErp: 'PV-1001' });
    await enviarRetornos(amb.ctx);
    const rej = (amb.hub.retornos as { pedido_uuid: string; status: string; motivo?: string }[]).find((x) => x.pedido_uuid === UUID);
    expect(rej).toMatchObject({ status: 'rejeitado_erp', motivo: expect.stringContaining('pedido fora do contrato') });
    expect(rej?.motivo).not.toMatch(/123\.456|CPF|-1/);
    expect(amb.logs.join('\n')).not.toMatch(/123\.456/);
  });
});
