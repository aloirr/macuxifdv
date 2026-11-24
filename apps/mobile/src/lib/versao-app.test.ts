/**
 * T-0195 (ADR 0070, RN-CORE-80): cabeçalho do app em toda chamada, última versão guardada para valer sem sinal, 426 e a troca da
 * tela só na entrada.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CABECALHO_APP } from '@macuxi/platform-sdk';

import { ApiClient, HttpError } from '@/services/api';
import { transporteV1 } from '@/services/transporte';

import {
  appInstalado,
  cabecalhoDoApp,
  cabecalhosDoApp,
  comCabecalhoDoApp,
  definirIdentidadeDoApp,
  ehAppDesatualizado,
  guardadaDaResposta,
  guardadaDoErro,
  lerGuardada,
  sincronizacaoComBloqueio,
  situacaoGuardada,
  telaDeBloqueioNaEntrada,
} from './versao-app';

const AGORA = new Date('2026-11-25T15:00:00.000Z');
const RESPOSTA = { variante: 'campo', versao: '1.0.34', publicada_em: '2026-11-24T14:00:00.000Z' };

afterEach(() => {
  vi.unstubAllGlobals();
  definirIdentidadeDoApp('campo', null);
});

describe('x-macuxi-app em toda chamada (ADR 0070 §D2)', () => {
  it('valor <variante>/<X.Y.Z>; versão ilegível = sem cabeçalho (nunca lança)', () => {
    expect(cabecalhoDoApp('gestao', '1.0.33')).toEqual({ [CABECALHO_APP]: 'gestao/1.0.33' });
    expect(cabecalhoDoApp('campo', '1.0')).toEqual({});
    expect(cabecalhoDoApp('campo', undefined)).toEqual({});
    definirIdentidadeDoApp('campo', '1.0.33');
    expect(cabecalhosDoApp()).toEqual({ 'x-macuxi-app': 'campo/1.0.33' });
    expect(appInstalado()).toEqual({ variante: 'campo', versao: '1.0.33' });
    expect(comCabecalhoDoApp({ method: 'GET', headers: { Accept: 'application/json' } }).headers).toEqual({ Accept: 'application/json', 'x-macuxi-app': 'campo/1.0.33' });
  });

  it('o ApiClient manda o cabeçalho no JSON, nos bytes e no teste do servidor; o chamador não o sobrescreve', async () => {
    definirIdentidadeDoApp('campo', '1.0.33');
    const vistos: Record<string, string>[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: { headers?: Record<string, string> }) => {
        vistos.push(init?.headers ?? {});
        return new Response(JSON.stringify({ servico: 'macuxi-api', ok: true }), { status: 200, headers: { 'content-type': 'application/json', 'content-length': '2' } });
      }),
    );
    const api = new ApiClient('https://api.exemplo.com/v1', 'tok');
    await api.request('POST', '/sync/push', { body: { itens: [] }, headers: { 'x-macuxi-app': 'campo/9.9.9' } });
    await api.bytes('/arquivos/a', { maxBytes: 10 });
    await api.health('/saude').catch(() => undefined);
    expect(vistos).toHaveLength(3);
    for (const h of vistos) expect(h['x-macuxi-app']).toBe('campo/1.0.33');
    expect(vistos[0]!.Authorization).toBe('Bearer tok');
  });
});

describe('última versão publicada guardada (vale sem sinal)', () => {
  it('da resposta de /v1/app/versao?contrato=2 e dos detalhes do 426; outra variante ou fora do contrato = nada', () => {
    expect(guardadaDaResposta(RESPOSTA, 'campo', AGORA)).toEqual({ ...RESPOSTA, recebida_em: AGORA.toISOString() });
    expect(guardadaDaResposta(RESPOSTA, 'gestao', AGORA)).toBeNull();
    expect(guardadaDaResposta({ versao: 'x' }, 'campo', AGORA)).toBeNull();
    const detalhes = { variante: 'campo', versao_publicada: '1.0.34', publicada_em: '2026-11-24T14:00:00.000Z', prazo_ate: '2026-11-25T14:00:00.000Z' };
    expect(guardadaDoErro({ codigo: 'APP_DESATUALIZADO', mensagem: 'm', detalhes }, 'campo', AGORA)).toMatchObject({ versao: '1.0.34', publicada_em: detalhes.publicada_em });
    expect(guardadaDoErro({ codigo: 'OUTRO', mensagem: 'm', detalhes }, 'campo', AGORA)).toBeNull();
    expect(lerGuardada(guardadaDaResposta(RESPOSTA, 'campo', AGORA), 'campo')).not.toBeNull();
    expect(lerGuardada({ variante: 'campo', versao: '1.0' }, 'campo')).toBeNull();
    expect(lerGuardada(null, 'campo')).toBeNull();
  });

  it('offline com o bloqueio guardado: a situação é calculada com o relógio, sem rede (RN-CORE-80)', () => {
    const g = guardadaDaResposta(RESPOSTA, 'campo', AGORA);
    expect(situacaoGuardada(g, '1.0.33', AGORA).situacao).toBe('bloqueada');
    expect(situacaoGuardada(g, '1.0.33', new Date('2026-11-25T13:59:59.000Z')).situacao).toBe('aviso');
    expect(situacaoGuardada(g, '1.0.34', AGORA).situacao).toBe('atual');
    expect(situacaoGuardada(null, '1.0.33', AGORA).situacao).toBe('atual');
    expect(situacaoGuardada({ ...g!, publicada_em: null }, '1.0.33', AGORA).situacao).toBe('aviso');
    expect(situacaoGuardada(g, null, AGORA).situacao).toBe('atual');
  });
});

describe('426 APP_DESATUALIZADO', () => {
  it('reconhece o 426 do ApiClient e do ambiente dos módulos', () => {
    expect(ehAppDesatualizado(new HttpError(426, 'APP_DESATUALIZADO', 'm'))).toBe(true);
    expect(ehAppDesatualizado({ status: 426, codigo: 'APP_DESATUALIZADO' })).toBe(true);
    expect(ehAppDesatualizado(new HttpError(426, 'OUTRO', 'm'))).toBe(false);
    expect(ehAppDesatualizado(new HttpError(403, 'APP_DESATUALIZADO', 'm'))).toBe(false);
  });

  it('no meio do uso só marca: a tela troca na entrada (formulário aberto não é arrancado) e some quando deixa de valer', () => {
    expect(telaDeBloqueioNaEntrada({ mostrando: false, bloqueada: true, entrada: false })).toBe(false);
    expect(telaDeBloqueioNaEntrada({ mostrando: false, bloqueada: true, entrada: true })).toBe(true);
    expect(telaDeBloqueioNaEntrada({ mostrando: true, bloqueada: false, entrada: false })).toBe(true);
    expect(telaDeBloqueioNaEntrada({ mostrando: true, bloqueada: false, entrada: true })).toBe(false);
  });

  it('bloqueado: a sincronização vira só envio; o pull recusado sobe uma vez, sem laço de retentativa no transporte', async () => {
    expect(sincronizacaoComBloqueio(true)).toBe('so-envio');
    expect(sincronizacaoComBloqueio(false)).toBe('normal');
    const request = vi.fn(async () => {
      throw new HttpError(426, 'APP_DESATUALIZADO', 'm');
    });
    const t = transporteV1(() => ({ request }) as unknown as ApiClient, async () => undefined);
    await expect(t.pull('cliente', null)).rejects.toMatchObject({ status: 426 });
    expect(request).toHaveBeenCalledTimes(1);
    // push recusado com 426 não vira rejeição do item: sobe como retentável (o item fica pendente na fila)
    await expect(t.push([{ entidade: 'pedido', id: 'a', operacao: 'upsert', payload: {} }])).rejects.toMatchObject({ status: 426 });
  });
});
