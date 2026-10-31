import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { criarBarramento, criarConsumoEmMemoria, criarOutboxEmMemoria, definirEvento, ErroEvento } from './eventos';
import { defineModule } from './manifesto';

const PedidoCriado = definirEvento(
  'vendedor.pedido.criado@1',
  z.object({ pedido_id: z.string().uuid(), cliente_id: z.string(), total_cents: z.number().int() }),
);
const Avulso = definirEvento('vendedor.pedido.cancelado@1', z.object({ pedido_id: z.string() }));

const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: ['admin'], consome: ['vendedor.pedido.criado@1'] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core'], perfis: ['vendedor'], publica: ['vendedor.pedido.criado@1'] }),
  defineModule({ id: 'gestor', versao: '1.0.0', depende: ['core'], perfis: ['supervisor'], consome: ['vendedor.pedido.criado@1'] }),
];

const payload = { pedido_id: '0b7f6c1e-3d2a-4c5b-9e8f-7a6b5c4d3e2f', cliente_id: 'c1', total_cents: 277000 };
const ctx = { tenant_id: 't1', usuario_id: 'u1', request_id: 'r1' };

function montar(estaAtivo?: (t: string, m: string) => boolean) {
  const outbox = criarOutboxEmMemoria();
  const bus = criarBarramento({
    manifestos,
    outbox,
    consumo: criarConsumoEmMemoria(),
    gerarId: () => 'evt-1',
    agora: () => new Date('2026-10-12T13:00:00Z'),
    ...(estaAtivo ? { estaAtivo } : {}),
  });
  return { outbox, bus };
}

describe('barramento de eventos', () => {
  it('definirEvento exige o padrão <modulo>.<entidade>.<fato>@vN', () => {
    expect(PedidoCriado).toMatchObject({ modulo: 'vendedor', entidade: 'pedido', fato: 'criado', versao: 1 });
    expect(() => definirEvento('pedido_criado', z.object({}))).toThrow('Nome de evento inválido');
  });

  it('publicar grava o envelope na outbox (UTC, tenant, request) sem entregar ainda', async () => {
    const { outbox, bus } = montar();
    const recebidos: string[] = [];
    bus.assinar('gestor', PedidoCriado, (p) => void recebidos.push(p.pedido_id));
    const env = await bus.publicar('vendedor', PedidoCriado, payload, ctx);
    expect(env).toMatchObject({ evento_id: 'evt-1', nome: 'vendedor.pedido.criado@1', origem: 'vendedor', tenant_id: 't1', ocorrido_em: '2026-10-12T13:00:00.000Z' });
    expect(outbox.pendentes()).toHaveLength(1);
    expect(recebidos).toEqual([]);
  });

  it('só publica quem declarou em "publica"; payload validado pelo contrato; tenant obrigatório', async () => {
    const { bus } = montar();
    await expect(bus.publicar('gestor', PedidoCriado, payload, ctx)).rejects.toThrow('não pode publicar');
    await expect(bus.publicar('vendedor', Avulso, { pedido_id: 'x' }, ctx)).rejects.toThrow('não está em "publica"');
    await expect(bus.publicar('vendedor', PedidoCriado, { ...payload, total_cents: 1.5 }, ctx)).rejects.toBeInstanceOf(ErroEvento);
    await expect(bus.publicar('vendedor', PedidoCriado, payload, { tenant_id: '' })).rejects.toThrow('tenant_id obrigatório');
  });

  it('só assina quem declarou em "consome"', () => {
    const { bus } = montar();
    expect(() => bus.assinar('vendedor', PedidoCriado, () => {})).toThrow('não está em "consome"');
  });

  it('entrega idempotente por evento_id e por consumidor', async () => {
    const { outbox, bus } = montar();
    const vistos: string[] = [];
    bus.assinar('gestor', PedidoCriado, () => void vistos.push('gestor'));
    bus.assinar('core', PedidoCriado, () => void vistos.push('core'));
    await bus.publicar('vendedor', PedidoCriado, payload, ctx);
    const [env] = outbox.retirar();
    expect((await bus.entregar(env!)).entregues).toEqual(['gestor', 'core']);
    const segunda = await bus.entregar(env!);
    expect(segunda.entregues).toEqual([]);
    expect(segunda.ignorados.map((i) => i.motivo)).toEqual(['ja_processado', 'ja_processado']);
    expect(vistos).toEqual(['gestor', 'core']);
  });

  it('falha de um consumidor não marca como processado (a fila tenta de novo) nem bloqueia os outros', async () => {
    const { outbox, bus } = montar();
    let tentativas = 0;
    bus.assinar('gestor', PedidoCriado, () => {
      tentativas += 1;
      if (tentativas === 1) throw new Error('banco fora');
    });
    bus.assinar('core', PedidoCriado, () => {});
    await bus.publicar('vendedor', PedidoCriado, payload, ctx);
    const [env] = outbox.retirar();
    const r1 = await bus.entregar(env!);
    expect(r1.falhas).toEqual([{ modulo: 'gestor', erro: 'banco fora' }]);
    expect(r1.entregues).toEqual(['core']);
    expect((await bus.entregar(env!)).entregues).toEqual(['gestor']);
  });

  it('consumidor sem licença no tenant é ignorado (RN-CORE-02)', async () => {
    const { outbox, bus } = montar((_t, m) => m !== 'gestor');
    bus.assinar('gestor', PedidoCriado, () => {});
    await bus.publicar('vendedor', PedidoCriado, payload, ctx);
    const r = await bus.entregar(outbox.retirar()[0]!);
    expect(r.ignorados).toEqual([{ modulo: 'gestor', motivo: 'modulo_inativo' }]);
    expect(bus.assinantes('vendedor.pedido.criado@1')).toEqual(['gestor']);
  });
});
