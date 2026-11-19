/**
 * T-0186 (RD-2356; P15 e P17): a porta `abrirArquivo` do Cliente 360 só mostra imagem. Formato de imagem vai ao visor de foto
 * comum (em memória); sem formato, `/arquivo` com o título e o subtítulo; PDF (Core antigo) não abre nem baixa nada (v1.0.16).
 * Nada é gravado no aparelho; sem sinal, "Sem internet"; nada em log.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  empurrados: [] as unknown[],
  fotos: [] as unknown[],
  online: true,
  ligada: true,
  resposta: null as Uint8Array | null,
  falha: null as Error | null,
  pedidos: [] as { path: string; opts: unknown }[],
}));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-router', () => ({ router: { push: (r: unknown) => sim.empurrados.push(r) } }));
vi.mock('./visor-foto', () => ({ abrirFoto: (p: unknown) => sim.fotos.push(p) }));
vi.mock('@/services/api', () => ({ NetworkError: class NetworkError extends Error {} }));
vi.mock('./foto-pdv', () => ({
  fonteDeArquivos: () =>
    sim.ligada
      ? {
          online: () => sim.online,
          api: () => ({
            bytes: async (path: string, opts: unknown) => {
              sim.pedidos.push({ path, opts });
              if (sim.falha) throw sim.falha;
              return sim.resposta;
            },
          }),
        }
      : null,
}));

import { TEXTO_ARQUIVO_INDISPONIVEL, TEXTO_SEM_INTERNET } from '@/lib/visualizar-arquivo';
import { NetworkError } from '@/services/api';
import * as servico from './visualizar-arquivo';
import { abrirArquivo, baixarArquivo } from './visualizar-arquivo';

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const JPEG = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2]);

let logs: ReturnType<typeof vi.spyOn>[] = [];

beforeEach(() => {
  sim.empurrados.length = 0;
  sim.fotos.length = 0;
  sim.pedidos.length = 0;
  sim.online = true;
  sim.ligada = true;
  sim.resposta = JPEG;
  sim.falha = null;
  logs = (['log', 'info', 'warn', 'error', 'debug'] as const).map((m) => vi.spyOn(console, m));
});

afterEach(() => {
  for (const l of logs) {
    expect(l).not.toHaveBeenCalled(); // sem id nem dado pessoal em log: nada em log
    l.mockRestore();
  }
});

describe('abrirArquivo (porta do Core)', () => {
  it('PDF (Core antigo): não abre rota, não abre visor e não baixa nada', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'NF 12345', subtitulo: 'Emitida em 08/11/2026', formato: 'pdf' });
    abrirArquivo({ arquivo_id: ID, titulo: 'NF 12345', formato: 'application/pdf' });
    expect(sim.empurrados).toEqual([]);
    expect(sim.fotos).toEqual([]);
    expect(sim.pedidos).toEqual([]);
  });

  it('documento de imagem: o visor de foto comum, com o título e o subtítulo', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'Alvará', subtitulo: 'Vence em 10/12/2026', formato: 'jpg' });
    expect(sim.fotos).toEqual([{ arquivo_id: ID, titulo: 'Alvará', subtitulo: 'Vence em 10/12/2026' }]);
    expect(sim.empurrados).toEqual([]);
  });

  it('sem formato (fachada) vai a /arquivo (os bytes decidem); arquivo que não é UUID não abre nada', () => {
    abrirArquivo({ arquivo_id: ID, titulo: 'Fachada', formato: null });
    expect(sim.empurrados).toEqual([{ pathname: '/arquivo', params: { arquivo: ID, titulo: 'Fachada' } }]);
    abrirArquivo({ arquivo_id: '../x', titulo: 'X' });
    expect(sim.empurrados).toHaveLength(1);
  });
});

describe('baixarArquivo', () => {
  it('imagem: baixa pela API da sessão e fica em memória (data: URI)', async () => {
    const r = await baixarArquivo(ID);
    expect(sim.pedidos[0]!.path).toBe(`/v1/arquivos/${ID}`);
    expect(r.tipo).toBe('imagem');
    expect(r.tipo === 'imagem' && r.uri.startsWith('data:image/jpeg;base64,')).toBe(true);
  });

  it('bytes de PDF: não abre ("Não foi possível abrir o arquivo."), sem visor de PDF nem temporário', async () => {
    sim.resposta = PDF;
    expect(await baixarArquivo(ID)).toEqual({ tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL });
    expect('limparTemporarios' in servico).toBe(false);
  });

  it('sem internet: "Sem internet", como no Core, sem chamar a API; queda de rede no meio: a mesma mensagem', async () => {
    expect(TEXTO_SEM_INTERNET).toBe('Sem internet');
    sim.online = false;
    expect(await baixarArquivo(ID)).toEqual({ tipo: 'erro', mensagem: TEXTO_SEM_INTERNET });
    expect(sim.pedidos).toEqual([]);
    sim.online = true;
    sim.falha = new NetworkError('x');
    expect(await baixarArquivo(ID)).toEqual({ tipo: 'erro', mensagem: TEXTO_SEM_INTERNET });
  });

  it('recusa da API, bytes que não são imagem, ou sem sessão: não foi possível abrir', async () => {
    sim.falha = new Error('http_403');
    expect(await baixarArquivo(ID)).toEqual({ tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL });
    sim.falha = null;
    sim.resposta = new Uint8Array([1, 2, 3, 4]);
    expect(await baixarArquivo(ID)).toEqual({ tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL });
    sim.ligada = false;
    expect(await baixarArquivo(ID)).toEqual({ tipo: 'erro', mensagem: TEXTO_ARQUIVO_INDISPONIVEL });
  });
});
