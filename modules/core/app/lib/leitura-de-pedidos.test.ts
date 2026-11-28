import { describe, expect, it } from 'vitest';
import type { EtapaSync } from '@macuxi/platform-sdk';

import { pedidosVisiveisPelaLeitura } from '../../domain';
import { etapasCore } from './cargas';
import { leituraDePedidosGuardada } from './leitura-de-pedidos';

const EU = '00000000-0000-4000-8000-000000000001';
const concessao = { usuario_id: EU, ve_pedidos: false, leitura: 'concessao' as const };
const param = (valor: unknown) => ({ modulo: 'core', chave: 'promotor_ve_pedidos', valor });

/** Armazenamento do módulo em memória, como o do motor. */
function disco(inicial: Record<string, unknown> = {}) {
  const m = new Map(Object.entries(inicial));
  return { m, ler: async <T>(c: string) => (m.get(c) ?? null) as T | null, gravar: async (c: string, v: unknown) => void m.set(c, v) };
}

function rodar(resposta: () => Promise<unknown>, armazenamento = disco()) {
  const etapa = etapasCore.find((e) => e.id === 'core-leitura-de-pedidos') as EtapaSync;
  const chamadas: string[] = [];
  const ctx = { http: { get: async (c: string) => { chamadas.push(c); return resposta(); } }, armazenamento };
  return { p: etapa.executar(ctx as never), chamadas, armazenamento };
}

/** O que a ficha decide com o que está guardado (o mesmo caminho de `useClientesLocais`). */
async function decide(armazenamento: ReturnType<typeof disco>, usuarioId: string, perfil: string, parametros = [param(true)]) {
  return pedidosVisiveisPelaLeitura({ usuarioId, perfil, parametros, leitura: await leituraDePedidosGuardada(armazenamento) });
}

describe('RN-PRO-01 / RN-CORE-01 / ADR 0073 §2.4: etapa core-leitura-de-pedidos (cópia no aparelho)', () => {
  it('online: lê a rota do usuário e guarda a leitura; a ficha passa a seguir o cargo e a concessão', async () => {
    const { p, chamadas, armazenamento } = rodar(async () => concessao);
    await p;
    expect(chamadas).toEqual(['/core/eu/leitura-de-pedidos']);
    expect(armazenamento.m.get('leitura_de_pedidos')).toEqual(concessao);
    expect(await decide(armazenamento, EU, 'promotor')).toBe(false);
  });

  it.each([['403', { status: 403 }], ['404', { status: 404 }], ['500', { status: 500 }], ['sem sinal', new Error('sem conexão')]])(
    'offline ou falha (%s): mantém a leitura guardada e a decisão não muda',
    async (_n, erro) => {
      const { p, armazenamento } = rodar(async () => { throw erro; }, disco({ leitura_de_pedidos: concessao }));
      await expect(p).resolves.toBeUndefined();
      expect(armazenamento.m.get('leitura_de_pedidos')).toEqual(concessao);
      expect(await decide(armazenamento, EU, 'promotor')).toBe(false);
    },
  );

  it.each([401, 423])('%s sobe como erro (RN-CORE-15)', async (status) => {
    const { p } = rodar(async () => { throw { status }; });
    await expect(p).rejects.toEqual({ status });
  });

  it('resposta fora do contrato não sobrescreve a cópia; campo novo é ignorado', async () => {
    const fora = rodar(async () => ({ ve_pedidos: 'sim' }), disco({ leitura_de_pedidos: concessao }));
    await fora.p;
    expect(fora.armazenamento.m.get('leitura_de_pedidos')).toEqual(concessao);
    const nova = rodar(async () => ({ ...concessao, campo_futuro: 1 }));
    await nova.p;
    expect(nova.armazenamento.m.get('leitura_de_pedidos')).toEqual(concessao);
  });

  it('cópia corrompida no disco = sem leitura', async () => {
    expect(await leituraDePedidosGuardada(disco({ leitura_de_pedidos: { usuario_id: 'x' } }))).toBeNull();
    expect(await leituraDePedidosGuardada(disco())).toBeNull();
  });
});
