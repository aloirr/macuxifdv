/**
 * T-0182, RD-0700, RD-1325: a logo do PDF do BKO sai do cache da consulta `qk.modulos` (a mesma do menu) e da
 * `consultaLogoDaEmpresa` (a mesma do shell): uma chamada a `/v1/me/modulos` e um download da logo.
 */
import { QueryClient } from '@tanstack/react-query';
import { rotaLogoDoAparelho } from '@macuxi/platform-sdk';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

const chamadas = vi.hoisted(() => ({ api: [] as string[], fetch: [] as string[] }));
const LOGO = { sha256: 'a'.repeat(64), tipo: 'image/png', largura_px: 400, altura_px: 200 } as const;

vi.mock('@macuxi/platform-sdk/web', async (original) => {
  const real = await original<typeof import('@macuxi/platform-sdk/web')>();
  return {
    ...real,
    api: async (caminho: string) => {
      chamadas.api.push(caminho);
      return {
        modulos: [{ id: 'core', versao: '0.1.0', parametros: { empresa_nome: 'Mercado Bom', empresa_logo: LOGO } }],
        versao_licencas: 'v1',
        calculado_em: '2026-11-15T12:00:00Z',
      };
    },
    apiFetch: async (caminho: string) => {
      chamadas.fetch.push(caminho);
      return new Response(new Uint8Array([1, 2, 3]), { headers: { 'content-type': 'image/png' } });
    },
  };
});

const { criarAmbienteWeb, logoDaEmpresaWeb } = await import('./ambiente');
const { consultaLogoDaEmpresa, consultaMeusModulos } = await import('./queries');
const { semV1 } = await import('./portal-rotas');

beforeAll(() => {
  // Node não tem FileReader: o suficiente para o data URI
  class LeitorFalso {
    result: string | null = null;
    error: Error | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    readAsDataURL(b: Blob) {
      void b.arrayBuffer().then((buf) => {
        this.result = `data:${b.type};base64,${Buffer.from(buf).toString('base64')}`;
        this.onload?.();
      });
    }
  }
  vi.stubGlobal('FileReader', LeitorFalso);
});

afterEach(() => {
  chamadas.api.length = 0;
  chamadas.fetch.length = 0;
});

describe('logo do PDF do BKO (RD-0700)', () => {
  it('lê o empresa_logo do cache de /v1/me/modulos: uma consulta só, mesmo com dois PDFs', async () => {
    const qc = new QueryClient();
    await qc.fetchQuery(consultaMeusModulos('supervisor')); // o menu do shell já carregou
    const ambiente = criarAmbienteWeb(() => null, async () => {
      const logo = (await qc.fetchQuery(consultaMeusModulos('supervisor'))).logo;
      return logo ? qc.fetchQuery(consultaLogoDaEmpresa(logo.sha256)) : null;
    });

    expect(await ambiente.logoDaEmpresa?.()).toBe('data:image/png;base64,AQID');
    expect(await ambiente.logoDaEmpresa?.()).toBe('data:image/png;base64,AQID');
    expect(chamadas.api).toEqual(['/me/modulos']);
    expect(chamadas.fetch).toEqual([semV1(rotaLogoDoAparelho(LOGO.sha256))]); // RD-1325: a logo baixa uma vez só
  });

  it('sem logo ou com falha = null (o PDF usa a padrão), sem baixar nada', async () => {
    expect(await logoDaEmpresaWeb(async () => null)).toBeNull();
    expect(await logoDaEmpresaWeb(() => Promise.reject(new Error('sem rede')))).toBeNull();
    expect(chamadas.fetch).toEqual([]);
  });
});
