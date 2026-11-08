import { describe, expect, it, vi } from 'vitest';
import { arquivoDaMiniatura, criarResolvedorMiniatura, nomeNoCache, type DependenciasResolvedor } from './miniatura-endereco';

const ID = '0ca00000-0000-4000-8000-000000000003';
const m = { arquivo_id: ID, bytes_max: 30720, versao: '20261107120000000000-0ca00000' };

function deps(extra: Partial<DependenciasResolvedor> = {}) {
  const cache = new Map<string, string>();
  const d: DependenciasResolvedor = {
    noCache: (n) => cache.get(n) ?? null,
    online: () => true,
    baixar: vi.fn(async () => new Uint8Array([0xff, 0xd8, 0xff, 1])),
    gravar: (n) => {
      const uri = `file:///cache/miniaturas/${n}`;
      cache.set(n, uri);
      return uri;
    },
    ...extra,
  };
  return { d, cache };
}

describe('T-0097 (a): endereço autenticado da miniatura no shell', () => {
  it('só a rota de arquivos da plataforma vira download; o resto fica com o Catálogo', () => {
    expect(arquivoDaMiniatura(`/v1/arquivos/${ID}`)).toBe(ID);
    expect(arquivoDaMiniatura(`/v1/arquivos/${ID.toUpperCase()}`)).toBe(ID);
    expect(arquivoDaMiniatura('/v1/arquivos/../segredo')).toBeNull();
    expect(arquivoDaMiniatura(`/v1/outra/${ID}`)).toBeNull();
    expect(arquivoDaMiniatura(`https://cdn.exemplo.com/v1/arquivos/${ID}`)).toBeNull();
  });

  it('nome no cache leva a versão (foto trocada = arquivo novo) e só caracteres seguros', () => {
    expect(nomeNoCache(ID, 'v1')).toBe(`${ID}-v1.jpg`);
    expect(nomeNoCache(ID, '../../x y')).toBe(`${ID}-xy.jpg`);
    expect(nomeNoCache(ID, '')).toBe(`${ID}-v.jpg`);
  });

  it('baixa uma vez com o teto do contrato, grava e devolve o file://; depois sai do cache sem rede', async () => {
    const { d } = deps();
    const r = criarResolvedorMiniatura(d);
    const uri = await r(`/v1/arquivos/${ID}`, m);
    expect(uri).toBe(`file:///cache/miniaturas/${nomeNoCache(ID, m.versao)}`);
    expect(d.baixar).toHaveBeenCalledWith(`/arquivos/${ID}`, 30720);
    expect(await r(`/v1/arquivos/${ID}`, m)).toBe(uri);
    expect(d.baixar).toHaveBeenCalledTimes(1);
  });

  it('pedidos repetidos enquanto baixa esperam o mesmo download', async () => {
    let soltar: (b: Uint8Array) => void = () => undefined;
    const baixar = vi.fn(() => new Promise<Uint8Array>((ok) => (soltar = ok)));
    const { d } = deps({ baixar });
    const r = criarResolvedorMiniatura(d);
    const a = r(`/v1/arquivos/${ID}`, m);
    const b = r(`/v1/arquivos/${ID}`, m);
    soltar(new Uint8Array([1]));
    expect(await a).toBe(await b);
    expect(baixar).toHaveBeenCalledTimes(1);
  });

  it('sem sinal, acima do teto, em erro ou com arquivo_id divergente: null e nada gravado', async () => {
    const semSinal = deps({ online: () => false });
    expect(await criarResolvedorMiniatura(semSinal.d)(`/v1/arquivos/${ID}`, m)).toBeNull();
    expect(semSinal.d.baixar).not.toHaveBeenCalled();

    const grande = deps({ baixar: vi.fn(async () => null) });
    expect(await criarResolvedorMiniatura(grande.d)(`/v1/arquivos/${ID}`, m)).toBeNull();
    expect(grande.cache.size).toBe(0);

    const erro = deps({ baixar: vi.fn(async () => Promise.reject(new Error('401'))) });
    expect(await criarResolvedorMiniatura(erro.d)(`/v1/arquivos/${ID}`, m)).toBeNull();
    expect(erro.cache.size).toBe(0);

    const outro = deps();
    expect(await criarResolvedorMiniatura(outro.d)(`/v1/arquivos/${ID}`, { ...m, arquivo_id: '0ca00000-0000-4000-8000-000000000009' })).toBeNull();
    expect(outro.d.baixar).not.toHaveBeenCalled();
  });

  it('já no cache, abre mesmo sem sinal (offline-first)', async () => {
    const { d, cache } = deps({ online: () => false });
    cache.set(nomeNoCache(ID, m.versao), 'file:///cache/x.jpg');
    expect(await criarResolvedorMiniatura(d)(`/v1/arquivos/${ID}`, m)).toBe('file:///cache/x.jpg');
  });
});
