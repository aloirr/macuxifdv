import { afterEach, describe, expect, it } from 'vitest';
import { ClienteHub, ErroHubTransitorio, esperaRetryAfter } from '../src/hub/cliente';
import { cicloPedidos } from '../src/pedidos';
import { processarFila } from '../src/remetente';
import { sincronizarEntidade } from '../src/sincronizador';
import { type Ambiente, cliente, criarAmbiente } from './suporte/ambiente';

let amb: Ambiente | undefined;
afterEach(async () => {
  await amb?.encerrar();
  amb = undefined;
});

describe('Retry-After do Hub (RFC 9110)', () => {
  const AGORA = Date.parse('2026-03-10T12:00:00Z');

  it('aceita segundos inteiros ou decimais', () => {
    expect(esperaRetryAfter('30', AGORA)).toBe(30_000);
    expect(esperaRetryAfter('1.5', AGORA)).toBe(1500);
  });

  it('aceita data HTTP: a espera é a diferença até a data', () => {
    expect(esperaRetryAfter('Tue, 10 Mar 2026 12:00:45 GMT', AGORA)).toBe(45_000);
  });

  it('ausente, zero, inválido ou data passada: sem espera mínima (vale o backoff normal)', () => {
    expect(esperaRetryAfter(null, AGORA)).toBeUndefined();
    expect(esperaRetryAfter('', AGORA)).toBeUndefined();
    expect(esperaRetryAfter('0', AGORA)).toBeUndefined();
    expect(esperaRetryAfter('-5', AGORA)).toBeUndefined();
    expect(esperaRetryAfter('em breve', AGORA)).toBeUndefined();
    expect(esperaRetryAfter('Tue, 10 Mar 2026 11:59:00 GMT', AGORA)).toBeUndefined();
  });

  it('o cliente respeita Retry-After em data HTTP no retry (limitado ao teto)', async () => {
    const esperas: number[] = [];
    let n = 0;
    const fetchFalso = (async () => {
      n++;
      if (n === 1) return new Response('{}', { status: 503, headers: { 'Retry-After': 'Tue, 10 Mar 2026 12:00:20 GMT' } });
      return new Response(JSON.stringify({ entidade: 'cliente', cursor: null, atualizado_em: null }), { status: 200 });
    }) as unknown as typeof fetch;
    const hub = new ClienteHub({
      url: 'https://hub.exemplo.com.br',
      token: async () => 't',
      agora: () => AGORA,
      fetch: fetchFalso,
      retry: { tentativas: 2, baseMs: 1, maxMs: 60_000, aleatorio: () => 0, dormir: async () => undefined },
      aoRetentar: (i) => esperas.push(i.esperaMs),
    });
    const r = await hub.consultarCursor('cliente');
    expect(r.cursor).toBeNull();
    expect(n).toBe(2);
    expect(esperas).toEqual([20_000]);
  });

  it('RN-INT-12 (T-0048): Retry-After acima do teto do retry não é encurtado; o cliente nem chama o Hub antes do prazo', async () => {
    let agora = AGORA;
    let n = 0;
    const fetchFalso = (async () => {
      n++;
      if (n === 1) return new Response('{}', { status: 429, headers: { 'Retry-After': '120' } });
      return new Response(JSON.stringify({ entidade: 'cliente', cursor: null, atualizado_em: null }), { status: 200 });
    }) as unknown as typeof fetch;
    const hub = new ClienteHub({ url: 'https://hub.exemplo.com.br', token: async () => 't', agora: () => agora, fetch: fetchFalso, retry: { tentativas: 4, baseMs: 1, maxMs: 30_000, dormir: async () => undefined } });
    const erro = await hub.consultarCursor('cliente').catch((e: unknown) => e);
    expect(erro).toBeInstanceOf(ErroHubTransitorio);
    expect((erro as ErroHubTransitorio).retryAfterMs).toBe(120_000);
    expect(n).toBe(1); // não repetiu em 30 s
    agora += 30_000;
    const antes = await hub.consultarCursor('cliente').catch((e: unknown) => e);
    expect((antes as ErroHubTransitorio).retryAfterMs).toBe(90_000);
    expect(n).toBe(1); // ainda dentro do prazo: nenhuma chamada nova
    agora += 90_000;
    expect((await hub.consultarCursor('cliente')).cursor).toBeNull();
    expect(n).toBe(2);
  });

  it('RN-INT-12 (T-0048): 429 com Retry-After longo grava a espera no lote da fila (nunca antes do prazo do Hub)', async () => {
    amb = await criarAmbiente();
    amb.hub.cursores.set('cliente', { alterado_em: '2026-01-01T00:00:00.000Z', external_id: 'a0' });
    amb.erp.definir('cliente', [cliente('c1', '2026-03-01T10:00:00Z')]);
    await sincronizarEntidade(amb.ctx, 'cliente');
    amb.hub.falhas = { restantes: 1, status: 429, retryAfter: 120 };
    const t0 = amb.relogio.agora();
    await processarFila(amb.ctx);
    const lote = amb.ctx.store.lotesDaEntidade('cliente')[0];
    expect(lote?.estado).toBe('pendente');
    expect(lote?.proximaMs).toBeGreaterThanOrEqual(t0 + 120_000);
    const posts = () => amb?.hub.chamadas.filter((c) => c.metodo === 'POST' && c.caminho.endsWith('/lotes')).length;
    expect(posts()).toBe(1);
    amb.relogio.avancar(30_000);
    await processarFila(amb.ctx);
    expect(posts()).toBe(1);
    amb.relogio.avancar(90_000);
    await processarFila(amb.ctx);
    expect(posts()).toBe(2);
    expect(amb.hub.envelopes).toHaveLength(1);
  });

  it('RN-INT-12 (T-0048): 429 com Retry-After longo no retorno de pedido grava a espera do Hub no retorno', async () => {
    amb = await criarAmbiente({
      pedidos: {
        gravacao: { cabecalho: '/*cab*/ INSERT INTO p VALUES (:pedido_uuid)', numeroErp: '/*num*/ SELECT numero_erp FROM p WHERE uuid = :pedido_uuid' },
        status: { consulta: '/*st*/ SELECT * FROM v WHERE pedido_uuid = :pedido_uuid', mapaStatus: { F: 'faturado_total' } },
      },
    });
    const a = amb;
    a.hub.pedidosParaEntregar = [
      {
        versao_contrato: 'v1', pedido_uuid: '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f01', cliente_external_id: 'c1', vendedor_external_id: 'v1', criado_em: '2026-03-10T11:00:00Z',
        aprovado_em: '2026-03-10T11:30:00Z', total_cents: 1000, desconto_total_cents: 0, tentativa: 1,
        itens: [{ sequencia: 1, produto_external_id: 'p1', quantidade: 1, preco_unitario_cents: 1000, desconto_cents: 0, total_cents: 1000 }],
      },
    ];
    a.erp.onConsulta = (sql) => (sql.includes('/*num*/') ? [{ numero_erp: 'PV-1' }] : undefined);
    await cicloPedidos(a.ctx, { buscar: true, status: false }); // busca, grava e tenta mandar o integrado
    expect(a.hub.retornos).toHaveLength(1);
    a.ctx.store.enfileirarRetorno('6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f01', 'cancelado', JSON.stringify({ versao_contrato: 'v1', pedido_uuid: '6f1c2f3a-1b2c-4d3e-8f4a-5b6c7d8e9f01', status: 'cancelado', ocorrido_em: '2026-03-10T12:00:00.000Z' }), a.relogio.agora());
    a.hub.falhas = { restantes: 1, status: 429, retryAfter: 120 };
    const t0 = a.relogio.agora();
    await cicloPedidos(a.ctx, { buscar: false, status: false });
    const [estado] = a.ctx.store.contarRetornos().filter((r) => r.estado === 'pendente');
    expect(estado?.total).toBe(1);
    const pendente = a.ctx.store.retornosProntos(t0 + 119_999);
    expect(pendente).toHaveLength(0);
    expect(a.ctx.store.retornosProntos(t0 + 120_000)).toHaveLength(1);
  });
});
