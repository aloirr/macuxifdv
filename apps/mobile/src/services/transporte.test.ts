/**
 * T-0065 (RN-CORE-23, ADR 0018): `transporteV1.novidades` chama `GET /v1/sync/novidades?desde=<cursor>` e valida a
 * resposta pelo contrato do platform-sdk. Sem cursor, não manda `desde` (o servidor devolve todas as entidades).
 */
import { describe, expect, it } from 'vitest';

import type { ApiClient } from './api';
import { HttpError } from './api';
import { transporteFaseM, transporteV1 } from './transporte';

interface Chamada {
  metodo: string;
  caminho: string;
  opts: unknown;
}

function apiFalsa(responder: (c: Chamada) => unknown): { api: () => ApiClient; chamadas: Chamada[] } {
  const chamadas: Chamada[] = [];
  const cliente = {
    async request(metodo: string, caminho: string, opts: unknown) {
      const c = { metodo, caminho, opts };
      chamadas.push(c);
      return { status: 200, data: responder(c) };
    },
  } as unknown as ApiClient;
  return { api: () => cliente, chamadas };
}

const RESPOSTA = { entidades: ['pedido'], cursor: 'n1|2026-11-02T19:00:00.000Z|v1|-', horizonte: '2026-11-02T19:00:00.000Z', modulos_mudaram: false };

describe('transporteV1.novidades', () => {
  it('tem o método (sem ele o motor cai na sincronização completa)', () => {
    expect(typeof transporteV1(apiFalsa(() => RESPOSTA).api).novidades).toBe('function');
  });

  it('com cursor: GET /sync/novidades?desde=<cursor>', async () => {
    const { api, chamadas } = apiFalsa(() => RESPOSTA);
    const r = await transporteV1(api).novidades!('n1|cursor-anterior');
    expect(chamadas).toEqual([{ metodo: 'GET', caminho: '/sync/novidades', opts: { query: { desde: 'n1|cursor-anterior' } } }]);
    expect(r).toEqual(RESPOSTA);
  });

  it('sem cursor: não manda desde', async () => {
    const { api, chamadas } = apiFalsa(() => ({ ...RESPOSTA, entidades: [], modulos_mudaram: true }));
    const r = await transporteV1(api).novidades!(null);
    expect(chamadas[0]?.opts).toEqual({ query: {} });
    expect(r.modulos_mudaram).toBe(true);
  });

  it('traz os módulos efetivos quando mudaram', async () => {
    const modulos = { modulos: [{ id: 'core', parametros: { sync_auto_min: 30 } }], versao_licencas: 'v2' };
    const { api } = apiFalsa(() => ({ ...RESPOSTA, modulos_mudaram: true, modulos }));
    const r = await transporteV1(api).novidades!('x');
    expect(r.modulos?.modulos[0]?.parametros).toEqual({ sync_auto_min: 30 });
  });

  it('resposta fora do contrato lança (o motor registra e tenta na próxima)', async () => {
    const { api } = apiFalsa(() => ({ entidades: 'pedido' }));
    await expect(transporteV1(api).novidades!('x')).rejects.toThrow();
  });

  it('erro HTTP sobe como exceção', async () => {
    const cliente = {
      async request() {
        throw new HttpError(503, 'INDISPONIVEL', 'fora do ar');
      },
    } as unknown as ApiClient;
    await expect(transporteV1(() => cliente).novidades!('x')).rejects.toBeInstanceOf(HttpError);
  });

  it('o transporte da Fase M não tem novidades (segue na completa)', () => {
    expect(transporteFaseM(apiFalsa(() => RESPOSTA).api).novidades).toBeUndefined();
  });
});
