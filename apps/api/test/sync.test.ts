/**
 * /v1/sync/pull e /v1/sync/push (desenho T-0004 §5) com provedores em memória: horizonte, cursor,
 * licença por entidade (RN-CORE-02) e RN-PRO-01 no push.
 */
import { manifest as vendedor } from '@macuxi/vendedor/manifest';
import { codificarCursor, definirEntidadeSync, definirModuloApi, ErroRegraNegocio, type LinhaSync } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { createApp } from '../src/app';
import { bancoFalso, cab, LICENCAS_PADRAO, opcoesDeTeste, vendedorApi } from './apoio';

const AGORA = new Date('2026-11-02T12:00:00.000Z');
const linha = (seg: number, id: string): LinhaSync => ({ id, updated_at: new Date(AGORA.getTime() - seg * 1000).toISOString(), deleted_at: null });

const pedido = definirEntidadeSync({ nome: 'pedido', modulo: 'vendedor', direcao: 'ambos', conflito: 'app_edita_ate_status', schema: z.object({ total_centavos: z.number().int() }) });

function montar(linhas: LinhaSync[], horizonteSeg = 2, licencas = LICENCAS_PADRAO) {
  const recebidos: string[] = [];
  const pedidosPuxados: unknown[] = [];
  const api = definirModuloApi({
    ...vendedorApi,
    manifesto: vendedor,
    sync: [
      {
        entidade: pedido,
        puxar: async (_ctx, p) => {
          pedidosPuxados.push(p);
          return linhas; // devolve tudo de propósito: a plataforma corta pelo horizonte e pelo cursor
        },
        receber: async (_ctx, itens) =>
          itens.map((i) => {
            if ((i.payload as { total_centavos: number }).total_centavos < 0) throw new ErroRegraNegocio('RN-VEN-02', 'Total negativo.');
            recebidos.push(i.id);
            return { id: i.id, status: 'aceito' as const };
          }),
      },
    ],
  });
  const { banco } = bancoFalso(() => new Date(AGORA.getTime() - horizonteSeg * 1000));
  const app = createApp({ ...opcoesDeTeste(licencas, { banco, relogio: () => AGORA }), modulos: opcoesDeTeste().modulos!.map((m) => (m.manifesto.id === 'vendedor' ? api : m)) });
  return { app, recebidos, pedidosPuxados };
}

const U = (n: number) => `0e000000-0000-4000-8000-00000000000${n}`;

describe('GET /v1/sync/pull', () => {
  it('nunca devolve linha no horizonte ou depois dele (transação longa ainda aberta)', async () => {
    const { app, pedidosPuxados } = montar([linha(10, U(1)), linha(5, U(2)), linha(1, U(3))], 2);
    const r = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido', headers: cab('vendedor') });
    expect(r.statusCode).toBe(200);
    expect(r.json().itens.map((l: LinhaSync) => l.id)).toEqual([U(1), U(2)]);
    expect(r.json().proximo_cursor).toBeNull();
    expect(pedidosPuxados[0]).toMatchObject({ desde: null, ate: new Date(AGORA.getTime() - 2000).toISOString(), limite: 1001 });
  });

  it('respeita o cursor (updated_at, id) e recusa cursor malformado', async () => {
    const { app } = montar([linha(10, U(1)), linha(5, U(2))]);
    const cursor = codificarCursor(linha(10, U(1)));
    const r = await app.inject({ method: 'GET', url: `/v1/sync/pull?entidade=pedido&cursor=${encodeURIComponent(cursor)}`, headers: cab('vendedor') });
    expect(r.json().itens.map((l: LinhaSync) => l.id)).toEqual([U(2)]);
    const ruim = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido&cursor=xpto', headers: cab('vendedor') });
    expect(ruim.statusCode).toBe(400);
    expect(ruim.json().codigo).toBe('CURSOR_INVALIDO');
  });

  it('RN-CORE-02: entidade de módulo inativo → 403 MODULO_INATIVO; desconhecida → 404; sem provedor → 501', async () => {
    const { app } = montar([]);
    const inativo = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=checklist_loja', headers: cab('vendedor') });
    expect(inativo.statusCode).toBe(403);
    expect(inativo.json()).toMatchObject({ codigo: 'MODULO_INATIVO', detalhes: { modulo: 'promotor' } });
    expect((await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=nao_existe', headers: cab('vendedor') })).statusCode).toBe(404);
    // `rota` é do Core e ainda sem provedor (o Core da T-0003 Fase 2 provê cliente, carteira e produto)
    const semProvedor = await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=rota', headers: cab('vendedor') });
    expect(semProvedor.statusCode).toBe(501);
  });

  it('sem login → 401 antes de qualquer coisa', async () => {
    const { app } = montar([]);
    expect((await app.inject({ method: 'GET', url: '/v1/sync/pull?entidade=pedido' })).statusCode).toBe(401);
  });
});

describe('POST /v1/sync/push', () => {
  const item = (n: number, entidade = 'pedido', total_centavos = 100) => ({ id: U(n), entidade, payload: { total_centavos } });

  it('aceita itens da entidade ativa e responde um resultado por item, na ordem', async () => {
    const { app, recebidos } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [item(1), item(2, 'checklist_loja'), item(3)] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultados).toEqual([
      { id: U(1), status: 'aceito' },
      { id: U(2), status: 'rejeitado', codigo: 'ENTIDADE_DESCONHECIDA', mensagem: 'Entidade checklist_loja não aceita push' },
      { id: U(3), status: 'aceito' },
    ]);
    expect(recebidos).toEqual([U(1), U(3)]);
  });

  it('RN-CORE-02: Vendedor desativado → cada item volta rejeitado com MODULO_INATIVO (fila do app mostra "não enviado")', async () => {
    const { app, recebidos } = montar([], 2, { ...LICENCAS_PADRAO, tenant: ['core', 'catalogo'] });
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [item(1), item(2)] } });
    expect(r.statusCode).toBe(200);
    expect(r.json().resultados.map((x: { codigo?: string }) => x.codigo)).toEqual(['MODULO_INATIVO', 'MODULO_INATIVO']);
    expect(recebidos).toEqual([]);
  });

  it('RN-PRO-01: promotor enviando pedido (mesmo com o Vendedor ativo) → rejeitado RN-PRO-01, nada chega ao módulo', async () => {
    const { app, recebidos } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('promotor'), payload: { itens: [item(1)] } });
    expect(r.json().resultados).toEqual([{ id: U(1), status: 'rejeitado', codigo: 'RN-PRO-01', mensagem: 'Promotor não cria nem altera pedido.' }]);
    expect(recebidos).toEqual([]);
  });

  it('regra de negócio no lote → itens rejeitados com o código da RN; payload fora do schema → PAYLOAD_INVALIDO', async () => {
    const { app } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [item(1, 'pedido', -1)] } });
    expect(r.json().resultados[0]).toMatchObject({ status: 'rejeitado', codigo: 'RN-VEN-02' });
    const p = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [{ id: U(2), entidade: 'pedido', payload: { total_centavos: 'x' } }] } });
    expect(p.json().resultados[0]).toMatchObject({ status: 'rejeitado', codigo: 'PAYLOAD_INVALIDO' });
  });

  it('lote inválido (id que não é UUID do aparelho) → 400', async () => {
    const { app } = montar([]);
    const r = await app.inject({ method: 'POST', url: '/v1/sync/push', headers: cab('vendedor'), payload: { itens: [{ id: '1', entidade: 'pedido', payload: {} }] } });
    expect(r.statusCode).toBe(400);
  });
});
