/**
 * Miniaturas do catálogo no aparelho (T-0097 (a)): liga o resolvedor do shell (`lib/miniatura-endereco.ts`) ao Catálogo.
 * A foto do perfil do Início do Campo (RN-CORE-42, `lib/foto-perfil-endereco.ts`) usa o mesmo download e a mesma pasta.
 * Os bytes vêm de `GET /v1/arquivos/<id>` com o token da sessão (`ApiClient.bytes`, renova no 401) e ficam na pasta de cache
 * do app (`miniaturas/`), que o sistema pode limpar sem perda (a foto volta a ser baixada quando aparecer). RN-CORE-15: o
 * bloqueio do aparelho apaga a pasta junto com as fotos (`apagarFotosLocais`). Navegador (demonstração): sem cache em disco,
 * fica sem miniatura relativa.
 */
import * as appCatalogo from '@macuxi/catalogo/app';
import { definirResolvedorFotoPerfil } from '@macuxi/core/app';
import { Directory, File, Paths } from 'expo-file-system';
import { Platform } from 'react-native';

import { criarResolvedorFotoPerfil } from '@/lib/foto-perfil-endereco';
import { criarResolvedorMiniatura, type DependenciasResolvedor, type ReferenciaMiniatura } from '@/lib/miniatura-endereco';
import type { ApiClient } from '@/services/api';
import { PASTA_MINIATURAS } from '@/services/arquivos';

type Resolvedor = (url: string, m: ReferenciaMiniatura) => Promise<string | null>;
type DefinirResolvedor = (r: Resolvedor | null) => void;

/**
 * `definirResolvedorMiniatura` do Catálogo, se o pacote já o exporta em `@macuxi/catalogo/app` (pedido ao modulo-catalogo,
 * T-0097 (a)); até lá, nada é ligado e a miniatura relativa fica vazia, como antes.
 */
function definidor(): DefinirResolvedor | null {
  const f = (appCatalogo as Record<string, unknown>).definirResolvedorMiniatura;
  return typeof f === 'function' ? (f as DefinirResolvedor) : null;
}

function pasta(): Directory {
  return new Directory(Paths.cache, PASTA_MINIATURAS);
}

/** Rede (`GET /v1/arquivos/<id>` com a sessão) e disco (pasta de cache `miniaturas/`) do aparelho. */
function dependencias(api: () => ApiClient, online: () => boolean): DependenciasResolvedor {
  return {
    noCache(nome) {
      const f = new File(pasta(), nome);
      return f.exists && f.size > 0 ? f.uri : null;
    },
    online,
    baixar: (rota, maxBytes) => api().bytes(rota, { maxBytes, timeoutMs: 10_000 }),
    gravar(nome, bytes) {
      const f = new File(pasta(), nome);
      f.create({ intermediates: true, overwrite: true });
      f.write(bytes);
      return f.uri;
    },
  };
}

/** Liga o resolvedor; devolve o desligar (logout, troca de sessão). */
export function ligarResolvedorMiniatura(api: () => ApiClient, online: () => boolean): () => void {
  const definir = definidor();
  if (!definir || Platform.OS === 'web') return () => undefined;
  definir(criarResolvedorMiniatura(dependencias(api, online)));
  return () => definir(null);
}

/** Liga a foto do perfil do Início (RN-CORE-42); sem ela, ou sem sinal e sem cache, a tela mostra as iniciais. */
export function ligarResolvedorFotoPerfil(api: () => ApiClient, online: () => boolean): () => void {
  if (Platform.OS === 'web') return () => undefined;
  definirResolvedorFotoPerfil(criarResolvedorFotoPerfil(dependencias(api, online)));
  return () => definirResolvedorFotoPerfil(null);
}
