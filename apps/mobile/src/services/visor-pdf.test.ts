/**
 * T-0186 (v1.0.16): carga do PDF — o download (`baixarArquivoDoVisor`, testado em foto-pdv.test.ts) é simulado; aqui
 * fica o que é do PDF: um temporário por visor, apagado só pelo próprio visor ao fechar (também quando chega depois de
 * fechar), erro do download sem arquivo, bytes que não são PDF recusados e a pasta inteira apagada na abertura do app, no
 * logout e no bloqueio do aparelho (RN-CORE-15).
 */
import { readFileSync } from 'node:fs';

import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({
  arquivos: new Map<string, Uint8Array>(),
  baixar: vi.fn(),
}));

vi.mock('@/services/foto-pdv', () => ({ baixarArquivoDoVisor: sim.baixar }));

vi.mock('react-native', () => ({ Platform: { OS: 'android' } }));
vi.mock('expo-file-system', () => {
  const caminho = (partes: unknown[]) => partes.map((p) => (typeof p === 'string' ? p : (p as { uri: string }).uri)).join('/');
  class Directory {
    uri: string;
    constructor(...partes: unknown[]) {
      this.uri = caminho(partes);
    }
    get exists() {
      return [...sim.arquivos.keys()].some((k) => k.startsWith(`${this.uri}/`));
    }
    create() {}
    delete() {
      for (const k of [...sim.arquivos.keys()]) if (k.startsWith(`${this.uri}/`)) sim.arquivos.delete(k);
    }
  }
  class File {
    uri: string;
    constructor(...partes: unknown[]) {
      this.uri = caminho(partes);
    }
    get exists() {
      return sim.arquivos.has(this.uri);
    }
    create() {
      sim.arquivos.set(this.uri, new Uint8Array());
    }
    write(b: Uint8Array) {
      sim.arquivos.set(this.uri, b);
    }
    delete() {
      sim.arquivos.delete(this.uri);
    }
  }
  return { Directory, File, Paths: { cache: 'file:///cache' } };
});

import type { EstadoVisor } from '@/lib/visor-foto';

import { abrirPdfNaTela, carregarPdf, limparPdfsTemporarios } from './visor-pdf';

const ID = '0b9f6c3e-6a7d-4c1e-9f0a-2b3c4d5e6f70';
const PDF = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31]);
const esperar = () => new Promise((r) => setTimeout(r, 0));

beforeEach(() => {
  sim.arquivos.clear();
  sim.baixar.mockReset();
  sim.baixar.mockResolvedValue({ tipo: 'ok', bytes: PDF });
});

describe('carregarPdf', () => {
  it('baixa pelo download do visor e grava um temporário na pasta visor-pdf do cache', async () => {
    const r = await carregarPdf(ID);
    expect(sim.baixar).toHaveBeenCalledWith(ID);
    expect(r.tipo).toBe('ok');
    const uri = r.tipo === 'ok' ? r.uri : '';
    expect(uri.startsWith(`file:///cache/visor-pdf/${ID}-`)).toBe(true);
    expect(sim.arquivos.get(uri)).toEqual(PDF);
  });

  it('erro do download: a mensagem dele chega à tela e nada é gravado', async () => {
    sim.baixar.mockResolvedValue({ tipo: 'erro', mensagem: 'Sem internet' });
    expect(await carregarPdf(ID)).toEqual({ tipo: 'erro', mensagem: 'Sem internet' });
    expect(sim.arquivos.size).toBe(0);
  });

  it('bytes que não são PDF: "Não foi possível abrir." e nada gravado', async () => {
    sim.baixar.mockResolvedValue({ tipo: 'ok', bytes: new Uint8Array([0xff, 0xd8, 0xff]) });
    expect(await carregarPdf(ID)).toEqual({ tipo: 'erro', mensagem: 'Não foi possível abrir.' });
    expect(sim.arquivos.size).toBe(0);
  });

  it('cada abertura tem o próprio temporário e não apaga o de outra', async () => {
    const a = await carregarPdf(ID);
    const b = await carregarPdf(ID);
    const ua = a.tipo === 'ok' ? a.uri : '';
    const ub = b.tipo === 'ok' ? b.uri : '';
    expect(ua).not.toBe(ub);
    expect(sim.arquivos.has(ua) && sim.arquivos.has(ub)).toBe(true);
  });
});

describe('limparPdfsTemporarios', () => {
  it('apaga as sobras da pasta do visor (app encerrado com o visor aberto) e só elas', () => {
    sim.arquivos.set('file:///cache/visor-pdf/sobra-1.pdf', PDF);
    sim.arquivos.set('file:///cache/visor-pdf/sobra-2.pdf', PDF);
    sim.arquivos.set('file:///cache/miniaturas/m.jpg', PDF);
    limparPdfsTemporarios();
    expect([...sim.arquivos.keys()]).toEqual(['file:///cache/miniaturas/m.jpg']);
  });

  const fonte = (rel: string) => readFileSync(new URL(rel, import.meta.url), 'utf8');

  it('o shell chama a limpeza na abertura do app (uma vez) e no logout', () => {
    const plataforma = fonte('../state/plataforma.tsx');
    expect(plataforma).toMatch(/useEffect\(\(\) => limparPdfsTemporarios\(\), \[\]\);/);
    const sair = plataforma.slice(plataforma.indexOf('const logout = useCallback('), plataforma.indexOf('const logoutRef = useRef(logout);'));
    expect(sair).toContain('limparPdfsTemporarios();');
  });

  it('o bloqueio do aparelho continua apagando a pasta (RN-CORE-15)', () => {
    const arquivos = fonte('./arquivos.ts');
    const bloqueio = arquivos.slice(arquivos.indexOf('export async function apagarFotosLocais('), arquivos.indexOf('export const PASTA_MINIATURAS'));
    expect(bloqueio).toContain('limparPdfsTemporarios();');
    expect(fonte('../state/plataforma.tsx')).toContain('apagarFotos: apagarFotosLocais,');
  });
});

describe('abrirPdfNaTela', () => {
  it('carregando, depois o temporário; fechar apaga o arquivo', async () => {
    const estados: EstadoVisor[] = [];
    const fechar = abrirPdfNaTela(ID, (e) => estados.push(e));
    await esperar();
    expect(estados.map((e) => e.tipo)).toEqual(['carregando', 'ok']);
    expect(sim.arquivos.size).toBe(1);
    fechar();
    expect(sim.arquivos.size).toBe(0);
  });

  it('dois visores abertos: fechar um não apaga o do outro', async () => {
    const estadosA: EstadoVisor[] = [];
    const estadosB: EstadoVisor[] = [];
    const fecharA = abrirPdfNaTela(ID, (e) => estadosA.push(e));
    await esperar();
    const fecharB = abrirPdfNaTela(ID, (e) => estadosB.push(e));
    await esperar();
    const uriA = estadosA.at(-1)?.tipo === 'ok' ? (estadosA.at(-1) as { uri: string }).uri : '';
    const uriB = estadosB.at(-1)?.tipo === 'ok' ? (estadosB.at(-1) as { uri: string }).uri : '';
    expect(sim.arquivos.has(uriA) && sim.arquivos.has(uriB)).toBe(true);
    fecharB();
    expect([...sim.arquivos.keys()]).toEqual([uriA]);
    fecharA();
    expect(sim.arquivos.size).toBe(0);
  });

  it('fechou antes de chegar: o temporário é apagado e a tela não recebe nada', async () => {
    const estados: EstadoVisor[] = [];
    const fechar = abrirPdfNaTela(ID, (e) => estados.push(e));
    fechar();
    await esperar();
    expect(estados.map((e) => e.tipo)).toEqual(['carregando']);
    expect(sim.arquivos.size).toBe(0);
  });

  it('download tardio apaga só o próprio arquivo: o visor aberto da pilha fica com o dele', async () => {
    const estados: EstadoVisor[] = [];
    abrirPdfNaTela(ID, (e) => estados.push(e));
    await esperar();
    const aberto = estados.at(-1)?.tipo === 'ok' ? (estados.at(-1) as { uri: string }).uri : '';
    const fechar = abrirPdfNaTela(ID, () => undefined);
    fechar();
    await esperar();
    expect([...sim.arquivos.keys()]).toEqual([aberto]);
  });
});
