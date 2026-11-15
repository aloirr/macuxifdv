/**
 * Foto do perfil no Início do Campo (RN-CORE-42): o shell resolve o `arquivo_id` da escolha viva num `file://` do cache,
 * baixando `/v1/arquivos/:id` com a sessão, como a miniatura do Catálogo (T-0097 (a)). Sem sinal ou em falha = `null`
 * (a tela mostra as iniciais).
 */
import { AVATAR_FOTO_MAX_BYTES } from '@macuxi/core/contracts';
import { describe, expect, it, vi } from 'vitest';

import { criarResolvedorFotoPerfil } from './foto-perfil-endereco';
import type { DependenciasResolvedor } from './miniatura-endereco';

const ID = '0ca00000-0000-4000-8000-0000000000a1';

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
  return d;
}

describe('RN-CORE-42: foto do perfil resolvida pelo shell', () => {
  it('baixa a rota autenticada uma vez, com o teto da foto do perfil, e depois abre do cache sem rede', async () => {
    const d = deps();
    const r = criarResolvedorFotoPerfil(d);
    const uri = await r(ID);
    expect(uri).toMatch(/^file:\/\/\/cache\/miniaturas\//);
    expect(d.baixar).toHaveBeenCalledTimes(1);
    expect(d.baixar).toHaveBeenCalledWith(`/arquivos/${ID}`, AVATAR_FOTO_MAX_BYTES);
    d.online = () => false;
    expect(await r(ID)).toBe(uri);
    expect(d.baixar).toHaveBeenCalledTimes(1);
  });

  it('sem sinal e sem cache devolve null (iniciais)', async () => {
    const d = deps({ online: () => false });
    expect(await criarResolvedorFotoPerfil(d)(ID)).toBeNull();
    expect(d.baixar).not.toHaveBeenCalled();
  });

  it('falha no download ou foto acima do teto devolve null, sem lançar', async () => {
    const falha = deps({
      baixar: async () => {
        throw new Error('rede');
      },
    });
    expect(await criarResolvedorFotoPerfil(falha)(ID)).toBeNull();
    expect(await criarResolvedorFotoPerfil(deps({ baixar: async () => null }))(ID)).toBeNull();
  });

  it('id que não é UUID não vira download', async () => {
    const d = deps();
    expect(await criarResolvedorFotoPerfil(d)('../segredo')).toBeNull();
    expect(d.baixar).not.toHaveBeenCalled();
  });
});
