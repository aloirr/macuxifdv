/**
 * Consumidores do retorno do ERP e da nota de devolução (T-0054) sobre o repositório em memória: status, linha do tempo,
 * `vendedor.pedido.status_alterado@1`, `vendedor.pedido.faturado@1`, idempotência, isolamento por tenant e log sem dado
 * pessoal. O mesmo fluxo contra o Postgres real está em retorno-erp.db.test.ts. Relógio: só instantes do próprio teste.
 */
import type { ContextoConsumo, DefinicaoEvento, EnvelopeEvento } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import manifest from '../manifest';
import { PedidoFaturadoEvento, PedidoStatusAlteradoEvento } from '../contracts';
import { EVENTO_RETORNO_ERP_CONSUMIDO as EVENTO_RETORNO_ERP } from './eventos-consumidos';
import { EVENTO_NOTA_ATUALIZADA } from './eventos-consumidos';
import { bancoEmMemoria, repositorioRetornoErpMemoria, type BancoEmMemoria, type PedidoEmMemoria } from './retorno-erp-memoria';
import {
  aplicarNotaDevolucao,
  aplicarRetornoErp,
  consumidoresVendedor,
  consumidorRetornoErp,
  criarConsumidorNotaDevolucao,
  criarConsumidorRetornoErp,
  DEVOLUCAO_LIGADA,
  type ContextoRetorno,
  type RetornoRecebido,
} from './retorno-erp';

const TA = 'aaaaaaaa-0000-4000-8000-000000000001';
const TB = 'bbbbbbbb-0000-4000-8000-000000000002';
const PED = '0f540000-0000-4000-8000-000000000001';
const VEN = '0f540000-0000-4000-8000-000000000002';
const P1 = '0f540000-0000-4000-8000-000000000011';
const P2 = '0f540000-0000-4000-8000-000000000012';
/** relógio do teste (nunca comparado ao relógio real) */
const INSTANTE = new Date('2026-10-30T18:00:00.000Z');
const EM = (h: number) => new Date(INSTANTE.getTime() + h * 3_600_000).toISOString();

function pedidoAprovado(o: Partial<PedidoEmMemoria> = {}): PedidoEmMemoria {
  return {
    tenant_id: TA,
    id: PED,
    vendedor_id: VEN,
    status: 'approved',
    numero_erp: null,
    motivo_rejeicao: null,
    motivo_cancelamento: null,
    resumo: null,
    itens: [
      { sequencia: 1, product_id: P1, quantity: 10, total_cents: 10_000 },
      { sequencia: 2, product_id: P2, quantity: 4, total_cents: 2_000 },
    ],
    ...o,
  };
}

interface Registro {
  publicados: Array<{ nome: string; payload: unknown; agregado: string | null | undefined }>;
  logs: Array<{ nivel: string; campos: Record<string, unknown> }>;
}

function contexto(eventoId: string, reg: Registro): ContextoRetorno {
  return {
    evento_id: eventoId,
    agora: () => INSTANTE,
    // como o SDK: só eventos do `publica` do manifesto, payload validado pelo schema
    publicar: (async (def: DefinicaoEvento, payload: unknown, agregado?: string | null) => {
      if (!(manifest.publica as readonly string[]).includes(def.nome)) throw new Error(`fora do publica: ${def.nome}`);
      reg.publicados.push({ nome: def.nome, payload: def.schema.parse(payload), agregado });
      return {} as EnvelopeEvento;
    }) as ContextoConsumo['publicar'],
    log: {
      info: (campos) => reg.logs.push({ nivel: 'info', campos }),
      warn: (campos) => reg.logs.push({ nivel: 'warn', campos }),
      error: (campos) => reg.logs.push({ nivel: 'error', campos }),
    },
  };
}

type ItemDoTeste = { sequencia: number; quantidade: number; valor_cents?: number };
/** Itens como o Hub manda (produto do ERP e valor obrigatórios); sem valor no teste = 0. */
const itensRet = (l: ItemDoTeste[]) => l.map((i) => ({ produto_external_id: `ERP-${i.sequencia}`, valor_cents: 0, ...i }));
const retorno = (status: string, extra: Omit<Partial<RetornoRecebido>, 'itens_faturados'> & { itens_faturados?: ItemDoTeste[] | null } = {}): RetornoRecebido => ({
  pedido_uuid: PED,
  status: status as RetornoRecebido['status'],
  numero_erp: 'ERP-77',
  motivo: null,
  nota: status.startsWith('faturado') ? { numero: '1001', serie: '1', emitida_em: EM(1), total_cents: 7_000 } : null,
  ocorrido_em: EM(1),
  ...extra,
  itens_faturados: extra.itens_faturados ? itensRet(extra.itens_faturados) : null,
});

/** Campos do ContextoConsumo que o consumidor do retorno não usa (T-0061: consultar, parâmetros e fuso). */
const EXTRAS_CONSUMO = {
  consultar: async () => {
    throw new Error('consulta não usada pelo consumidor do retorno');
  },
  parametros: () => ({}),
  fuso: () => 'America/Manaus',
  aposConfirmar: () => undefined,
} as unknown as Pick<ContextoConsumo, 'consultar' | 'parametros' | 'fuso' | 'aposConfirmar'>;

function cenario(pedidos: PedidoEmMemoria[] = [pedidoAprovado()]) {
  const banco: BancoEmMemoria = bancoEmMemoria(pedidos);
  const reg: Registro = { publicados: [], logs: [] };
  return { banco, reg, repoA: repositorioRetornoErpMemoria(banco, TA), repoB: repositorioRetornoErpMemoria(banco, TB) };
}

describe('retorno do ERP no pedido (RN-INT-08, RN-VEN-30)', () => {
  it('RN-INT-08: integrado grava status e número do ERP, linha do tempo "ERP" e status_alterado@1 (aprovado → integrado_erp)', async () => {
    const { banco, reg, repoA } = cenario();
    const r = await aplicarRetornoErp(repoA, retorno('integrado'), contexto('e-1', reg));
    expect(r).toEqual({ aplicado: true, de: 'approved', para: 'integrated', faturado_publicado: false });
    expect(banco.pedidos[0]).toMatchObject({ status: 'integrated', numero_erp: 'ERP-77' });
    expect(banco.linhaDoTempo).toEqual([expect.objectContaining({ pedido_id: PED, de: 'approved', para: 'integrated', ocorrido_em: EM(1) })]);
    expect(reg.publicados).toHaveLength(1);
    expect(reg.publicados[0]).toMatchObject({ nome: 'vendedor.pedido.status_alterado@1', agregado: PED });
    expect(PedidoStatusAlteradoEvento.parse(reg.publicados[0]!.payload)).toMatchObject({ de: 'aprovado', para: 'integrado_erp', autor_id: null, alterado_em: EM(1) });
  });

  it('RN-TRE-08: faturado_parcial com itens → invoiced_partial, faturado@1 com produto_id e resumo por item', async () => {
    const { banco, reg, repoA } = cenario([pedidoAprovado({ status: 'integrated', numero_erp: 'ERP-77' })]);
    const r = await aplicarRetornoErp(repoA, retorno('faturado_parcial', { itens_faturados: [{ sequencia: 1, quantidade: 6, valor_cents: 6_000 }] }), contexto('e-2', reg));
    expect(r).toMatchObject({ aplicado: true, para: 'invoiced_partial', faturado_publicado: true });
    const fat = reg.publicados.find((p) => p.nome === 'vendedor.pedido.faturado@1');
    expect(PedidoFaturadoEvento.parse(fat!.payload)).toEqual({ pedido_id: PED, vendedor_id: VEN, faturado_em: EM(1), parcial: true, itens: [{ produto_id: P1, quantidade: 6 }] });
    expect(fat!.agregado).toBe(PED);
    expect(banco.pedidos[0]!.resumo).toMatchObject({ faturado_cents: 6_000, notas: 1, ultima_nota: '1001', itens: [{ sequencia: 1, faturada: 6, saldo: 4 }, { sequencia: 2, faturada: 0, saldo: 4 }] });
  });

  it('RN-TRE-08: faturado_total sem itens depois do parcial publica só o saldo; reentrega do mesmo evento não duplica', async () => {
    const { banco, reg, repoA } = cenario([pedidoAprovado({ status: 'integrated', numero_erp: 'ERP-77' })]);
    await aplicarRetornoErp(repoA, retorno('faturado_parcial', { itens_faturados: [{ sequencia: 1, quantidade: 10 }, { sequencia: 2, quantidade: 1 }] }), contexto('e-3', reg));
    reg.publicados.length = 0;
    const total = retorno('faturado_total', { nota: { numero: '1002', emitida_em: EM(2), total_cents: 1_500 }, ocorrido_em: EM(2) });
    await aplicarRetornoErp(repoA, total, contexto('e-4', reg));
    expect(reg.publicados.map((p) => p.nome)).toEqual(['vendedor.pedido.status_alterado@1', 'vendedor.pedido.faturado@1']);
    expect((reg.publicados[1]!.payload as PedidoFaturadoEvento).itens).toEqual([{ produto_id: P2, quantidade: 3 }]);
    expect(banco.pedidos[0]).toMatchObject({ status: 'invoiced' });
    expect(banco.pedidos[0]!.resumo).toMatchObject({ notas: 2, ultima_nota: '1002', itens: [{ faturada: 10, saldo: 0 }, { faturada: 4, saldo: 0 }] });
    // a mesma entrega de novo (evento_id igual): nada novo é gravado nem publicado
    reg.publicados.length = 0;
    await aplicarRetornoErp(repoA, total, contexto('e-4', reg));
    expect(reg.publicados).toEqual([]);
    expect(banco.faturamentos).toHaveLength(2);
  });

  it('RN-INT-08: parcial sem itens grava a nota, muda o status e NÃO publica faturado (log faturamento_sem_itens)', async () => {
    const { banco, reg, repoA } = cenario([pedidoAprovado({ status: 'integrated' })]);
    const r = await aplicarRetornoErp(repoA, retorno('faturado_parcial'), contexto('e-5', reg));
    expect(r).toMatchObject({ aplicado: true, para: 'invoiced_partial', faturado_publicado: false });
    expect(banco.faturamentos).toHaveLength(1);
    expect(reg.publicados.map((p) => p.nome)).toEqual(['vendedor.pedido.status_alterado@1']);
    expect(reg.logs.some((l) => l.campos.codigo === 'faturamento_sem_itens')).toBe(true);
    // resumo: nota sem itens conta pelo total da nota
    expect(banco.pedidos[0]!.resumo).toMatchObject({ faturado_cents: 7_000, notas: 1 });
  });

  it('RN-INT-08: item com sequência inexistente ou acima do saldo vira divergência no log (só ids e códigos)', async () => {
    const { reg, repoA } = cenario([pedidoAprovado({ status: 'integrated' })]);
    await aplicarRetornoErp(repoA, retorno('faturado_parcial', { itens_faturados: [{ sequencia: 9, quantidade: 1 }, { sequencia: 2, quantidade: 50 }] }), contexto('e-6', reg));
    const div = reg.logs.filter((l) => l.nivel === 'warn');
    expect(div.map((l) => l.campos.codigo)).toEqual(['sequencia_inexistente', 'acima_do_saldo']);
    for (const l of reg.logs) expect(Object.keys(l.campos).every((k) => ['pedido_id', 'sequencia', 'codigo', 'informada', 'aceita', 'status_erp', 'status'].includes(k))).toBe(true);
  });

  it('RN-INT-08: cancelado no ERP depois de faturado cancela, guarda o motivo e não estorna (sem faturado@1)', async () => {
    const { banco, reg, repoA } = cenario([pedidoAprovado({ status: 'invoiced', numero_erp: 'ERP-77' })]);
    await aplicarRetornoErp(repoA, retorno('cancelado', { motivo: 'nota denegada', numero_erp: null }), contexto('e-7', reg));
    expect(banco.pedidos[0]).toMatchObject({ status: 'cancelled', motivo_cancelamento: 'Cancelado no ERP: nota denegada', numero_erp: 'ERP-77' });
    expect(reg.publicados.map((p) => p.nome)).toEqual(['vendedor.pedido.status_alterado@1']);
    expect((reg.publicados[0]!.payload as { para: string }).para).toBe('cancelado');
  });

  it('RN-INT-08: rejeitado_erp volta o pedido a rejeitado com o motivo (3+ caracteres, regra do banco)', async () => {
    const { banco, reg, repoA } = cenario();
    await aplicarRetornoErp(repoA, retorno('rejeitado_erp', { numero_erp: null, motivo: 'cliente bloqueado no ERP' }), contexto('e-8', reg));
    expect(banco.pedidos[0]).toMatchObject({ status: 'rejected', motivo_rejeicao: 'Recusado pelo ERP: cliente bloqueado no ERP' });
  });

  it('RN-VEN-30: retorno atrasado (integrado depois de faturado) não muda nada nem publica (planejarRetornoErp, T-0053)', async () => {
    const { banco, reg, repoA } = cenario([pedidoAprovado({ status: 'invoiced', numero_erp: 'ERP-77' })]);
    expect(await aplicarRetornoErp(repoA, retorno('integrado'), contexto('e-9', reg))).toEqual({ aplicado: false, motivo: 'repetido_ou_atrasado' });
    expect(banco.pedidos[0]!.status).toBe('invoiced');
    expect(reg.publicados).toEqual([]);
  });

  it('multi-tenant: retorno no tenant B para pedido do tenant A não encontra o pedido e não altera nada', async () => {
    const { banco, reg, repoB } = cenario();
    expect(await aplicarRetornoErp(repoB, retorno('faturado_total'), contexto('e-10', reg))).toEqual({ aplicado: false, motivo: 'pedido_inexistente' });
    expect(banco.pedidos[0]!.status).toBe('approved');
    expect(banco.faturamentos).toEqual([]);
    expect(reg.publicados).toEqual([]);
  });
});

describe('nota de devolução no pedido (RN-VEN-37 proposta)', () => {
  const nota = (o: Partial<{ total_cents: number; cancelada: boolean; pedido_uuid: string | null; tipo: string }> = {}) => ({
    acao: 'criado',
    external_id: 'NF-D-1',
    registro: { tipo: 'devolucao', pedido_uuid: PED, numero: 'D1', serie: '1', emitida_em: EM(3), total_cents: 2_000, cancelada: false, ...o },
  });

  it('RN-VEN-37: grava a devolução, mantém o status e calcula devolvido parcial/total sobre o faturado', async () => {
    const { banco, reg, repoA } = cenario([pedidoAprovado({ status: 'integrated' })]);
    await aplicarRetornoErp(repoA, retorno('faturado_total', { itens_faturados: [{ sequencia: 1, quantidade: 10, valor_cents: 10_000 }, { sequencia: 2, quantidade: 4, valor_cents: 2_000 }] }), contexto('e-11', reg));
    await aplicarNotaDevolucao(repoA, nota(), contexto('e-12', reg));
    expect(banco.pedidos[0]).toMatchObject({ status: 'invoiced', resumo: { faturado_cents: 12_000, devolvido_cents: 2_000, devolucao: 'parcial' } });
    // a mesma nota atualizada (valor novo) substitui, não soma
    await aplicarNotaDevolucao(repoA, { ...nota({ total_cents: 12_000 }), acao: 'atualizado' }, contexto('e-13', reg));
    expect(banco.pedidos[0]!.resumo).toMatchObject({ devolvido_cents: 12_000, devolucao: 'total' });
    expect(banco.devolucoes.filter((d) => !d.deleted_at)).toHaveLength(1);
  });

  it('RN-VEN-37: nota cancelada ou inativada sai da soma; nota de outro tenant não encontra o pedido', async () => {
    const { banco, reg, repoA, repoB } = cenario([pedidoAprovado({ status: 'invoiced' })]);
    await aplicarNotaDevolucao(repoA, nota(), contexto('e-14', reg));
    expect(banco.pedidos[0]!.resumo?.devolvido_cents).toBe(2_000);
    await aplicarNotaDevolucao(repoA, { ...nota({ cancelada: true }), acao: 'atualizado' }, contexto('e-15', reg));
    expect(banco.pedidos[0]!.resumo?.devolvido_cents).toBe(0);
    await aplicarNotaDevolucao(repoA, nota(), contexto('e-16', reg));
    await aplicarNotaDevolucao(repoA, { acao: 'inativado', external_id: 'NF-D-1' }, contexto('e-17', reg));
    expect(banco.pedidos[0]!.resumo?.devolvido_cents).toBe(0);
    expect(await aplicarNotaDevolucao(repoB, nota(), contexto('e-18', reg))).toEqual({ pedidos: [] });
    expect(banco.devolucoes.filter((d) => d.tenant_id === TB)).toEqual([]);
  });

  it('RN-VEN-37: nota de faturamento (não devolução) não cria devolução', async () => {
    const { banco, reg, repoA } = cenario([pedidoAprovado({ status: 'invoiced' })]);
    expect(await aplicarNotaDevolucao(repoA, nota({ tipo: 'faturamento' }), contexto('e-19', reg))).toEqual({ pedidos: [] });
    expect(banco.devolucoes).toEqual([]);
  });
});

describe('consumidores (ADR 0007) e manifesto', () => {
  it('ADR 0007: os consumidores usam os schemas OFICIAIS da Integração e estão no "consome" do manifesto', () => {
    expect(EVENTO_RETORNO_ERP.nome).toBe('integracao.pedido.retorno_erp@1');
    expect(EVENTO_NOTA_ATUALIZADA.nome).toBe('integracao.nota.atualizado@1');
    expect(manifest.consome).toEqual(expect.arrayContaining([EVENTO_RETORNO_ERP.nome, EVENTO_NOTA_ATUALIZADA.nome]));
    expect(manifest.publica).toContain('vendedor.pedido.faturado@1');
  });

  it('T-0053/T-0054: um só consumidor do retorno do ERP no módulo, sempre ligado; o da nota só com a tabela da devolução', () => {
    const nomes = consumidoresVendedor.map((c) => c.evento.nome);
    expect(nomes.filter((n) => n === 'integracao.pedido.retorno_erp@1')).toHaveLength(1);
    expect(nomes.includes('integracao.nota.atualizado@1')).toBe(DEVOLUCAO_LIGADA);
    expect(consumidoresVendedor).toContain(consumidorRetornoErp);
  });

  it('sem a migração (acumulado desconhecido): status e faturado@1 funcionam; total sem itens depois de parcial não publica (nunca conta em dobro)', async () => {
    const banco = bancoEmMemoria([pedidoAprovado({ status: 'integrated' })]);
    const reg: Registro = { publicados: [], logs: [] };
    const repo = repositorioRetornoErpMemoria(banco, TA, { semFaturamento: true });
    await aplicarRetornoErp(repo, retorno('faturado_parcial', { itens_faturados: [{ sequencia: 1, quantidade: 6 }] }), contexto('s-1', reg));
    expect(reg.publicados.map((p) => p.nome)).toEqual(['vendedor.pedido.status_alterado@1', 'vendedor.pedido.faturado@1']);
    reg.publicados.length = 0;
    await aplicarRetornoErp(repo, retorno('faturado_total', { ocorrido_em: EM(2) }), contexto('s-2', reg));
    expect(banco.pedidos[0]!.status).toBe('invoiced');
    expect(reg.publicados.map((p) => p.nome)).toEqual(['vendedor.pedido.status_alterado@1']);
    expect(reg.logs.some((l) => l.campos.codigo === 'faturamento_sem_base')).toBe(true);
    expect(banco.faturamentos).toEqual([]);
    expect(banco.pedidos[0]!.resumo).toBeNull();
  });

  it('ADR 0007: o consumidor do retorno valida o payload oficial e aplica pela fábrica de repositório', async () => {
    const { banco, reg } = cenario();
    const c = criarConsumidorRetornoErp(() => repositorioRetornoErpMemoria(banco, TA));
    const payload = EVENTO_RETORNO_ERP.schema.parse({ pedido_uuid: PED, status: 'integrado', numero_erp: 'ERP-9', motivo: null, nota: null, ocorrido_em: EM(1) });
    const base = contexto('e-20', reg);
    await c.executar(payload, { envelope: { evento_id: 'e-20' } as EnvelopeEvento, db: { query: async () => ({ rows: [], rowCount: 0 }) }, publicar: base.publicar, agora: base.agora, log: base.log, ...EXTRAS_CONSUMO });
    expect(banco.pedidos[0]).toMatchObject({ status: 'integrated', numero_erp: 'ERP-9' });
  });

  it('ADR 0007: o consumidor da nota valida o payload oficial (integracao.nota.atualizado@1) e grava a devolução', async () => {
    const { banco, reg } = cenario([pedidoAprovado({ status: 'invoiced' })]);
    const c = criarConsumidorNotaDevolucao(() => repositorioRetornoErpMemoria(banco, TA));
    const payload = EVENTO_NOTA_ATUALIZADA.schema.parse({
      lote_id: '0f540000-0000-4000-8000-0000000000aa',
      entidade: 'nota',
      external_id: 'NF-D-9',
      acao: 'criado',
      hash: 'h',
      registro: { external_id: 'NF-D-9', alterado_em: EM(3), cliente_external_id: 'C1', tipo: 'devolucao', numero: 'D9', emitida_em: EM(3), total_cents: 500, pedido_uuid: PED },
      ocorrido_em: EM(3),
    });
    const base = contexto('e-21', reg);
    await c.executar(payload, { envelope: { evento_id: 'e-21' } as EnvelopeEvento, db: { query: async () => ({ rows: [], rowCount: 0 }) }, publicar: base.publicar, agora: base.agora, log: base.log, ...EXTRAS_CONSUMO });
    expect(banco.devolucoes).toEqual([expect.objectContaining({ external_id: 'NF-D-9', pedido_id: PED, total_cents: 500, numero: 'D9' })]);
  });
});

describe('apiVendedor (T-0054)', () => {
  it('ADR 0007: o apiVendedor registra os consumidores do retorno (vazios até a migração) e a definição do módulo é válida', async () => {
    const { apiVendedor } = await import('./index');
    expect(apiVendedor.consumidores).toBe(consumidoresVendedor);
    for (const c of apiVendedor.consumidores ?? []) expect(manifest.consome).toContain(c.evento.nome);
  });
});
