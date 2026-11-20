/**
 * T-0147 e T-0186 (RD-2409): o download dos dois visores (`baixarArquivoDoVisor`) — `GET /v1/arquivos/<id>` no-store,
 * com um tempo limite só, "Sem internet" sem sinal e "Não foi possível abrir." no erro — e a foto do PDV sobre ele.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  locais: new Set<string>(),
  online: true,
  pedidos: [] as { url: string; cache?: string }[],
  resposta: new Uint8Array() as Uint8Array | number | Error,
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => {
  const caminho = (partes: unknown[]) => partes.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class Directory {
    uri: string;
    constructor(...partes: unknown[]) {
      this.uri = caminho(partes);
    }
  }
  class File {
    uri: string;
    constructor(...partes: unknown[]) {
      this.uri = caminho(partes);
    }
    get exists() {
      return sim.locais.has(this.uri);
    }
    get size() {
      return 1;
    }
  }
  return { Directory, File, Paths: { document: 'file:///doc' } };
});

import { ApiClient } from './api';
import { baixarArquivoDoVisor, carregarFotoPdv, ligarFonteFotoPdv } from './foto-pdv';

vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
  sim.pedidos.push({ url, cache: init.cache });
  if (sim.resposta instanceof Error) throw sim.resposta;
  if (typeof sim.resposta === 'number') return new Response(null, { status: sim.resposta });
  return new Response(sim.resposta as unknown as BodyInit);
});

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0]);
const SEM_INTERNET = { tipo: 'erro', mensagem: 'Sem internet' };
const INDISPONIVEL = { tipo: 'erro', mensagem: 'Não foi possível abrir.' };
let desligar = () => {};

beforeEach(() => {
  sim.locais.clear();
  sim.pedidos.length = 0;
  sim.online = true;
  sim.resposta = JPEG;
  desligar();
  desligar = ligarFonteFotoPdv(() => new ApiClient('https://api.teste', 'tok'), () => sim.online);
});

describe('baixarArquivoDoVisor', () => {
  it('com sinal: GET /v1/arquivos/<id> no-store, teto de 20 MB e tempo limite de 30 s; devolve os bytes', async () => {
    const bytes = vi.spyOn(ApiClient.prototype, 'bytes');
    expect(await baixarArquivoDoVisor(ID)).toEqual({ tipo: 'ok', bytes: JPEG });
    expect(sim.pedidos).toEqual([{ url: `https://api.teste/v1/arquivos/${ID}`, cache: 'no-store' }]);
    expect(bytes).toHaveBeenCalledWith(`/v1/arquivos/${ID}`, { maxBytes: 20 * 1024 * 1024, timeoutMs: 30_000 });
    bytes.mockRestore();
  });

  it('sem sinal: "Sem internet" sem pedir nada; a rede que cai no meio também', async () => {
    sim.online = false;
    expect(await baixarArquivoDoVisor(ID)).toEqual(SEM_INTERNET);
    expect(sim.pedidos).toEqual([]);
    sim.online = true;
    sim.resposta = new TypeError('Network request failed');
    expect(await baixarArquivoDoVisor(ID)).toEqual(SEM_INTERNET);
  });

  it('erro do servidor, resposta vazia ou sem sessão: "Não foi possível abrir."', async () => {
    sim.resposta = 404;
    expect(await baixarArquivoDoVisor(ID)).toEqual(INDISPONIVEL);
    sim.resposta = new Uint8Array();
    expect(await baixarArquivoDoVisor(ID)).toEqual(INDISPONIVEL);
    desligar();
    expect(await baixarArquivoDoVisor(ID)).toEqual(INDISPONIVEL);
  });
});

describe('carregarFotoPdv', () => {
  it('a foto deste aparelho abre sem sinal e sem download', async () => {
    sim.online = false;
    sim.locais.add(`file:///doc/fotos/${ID}.jpg`);
    const r = await carregarFotoPdv(ID);
    expect(r.tipo).toBe('ok');
    expect(sim.pedidos).toEqual([]);
  });

  it('sem cópia local: baixa em memória (data: URI); sem sinal, "Sem internet"; bytes que não são imagem, erro', async () => {
    expect(await carregarFotoPdv(ID)).toEqual({ tipo: 'ok', uri: expect.stringMatching(/^data:image\/jpeg;base64,/) });
    sim.online = false;
    expect(await carregarFotoPdv(ID)).toEqual(SEM_INTERNET);
    sim.online = true;
    sim.resposta = new Uint8Array([0x25, 0x50, 0x44, 0x46]);
    expect(await carregarFotoPdv(ID)).toEqual(INDISPONIVEL);
  });
});
