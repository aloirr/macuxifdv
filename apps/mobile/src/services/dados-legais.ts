/**
 * Dados legais do rodapé da tela Entrar (docs/design/telas/rodape-legal.md §3.5): mostra na hora o que está no cache do
 * aparelho (AsyncStorage, `macuxi.dados-legais`, conferido com `DadosLegaisSchema`) e, em paralelo, busca a rota pública
 * `GET /v1/publico/dados-legais` no servidor em uso (o mesmo do login), com prazo de 5 s. Resposta válida grava o cache e
 * atualiza o rodapé; sem rede, fica o cache; sem cache, `null` (o rodapé mostra as linhas 2 e 3). Nunca segura o login.
 */
import { DadosLegaisSchema, ROTA_DADOS_LEGAIS_PUBLICOS, type DadosLegais } from '@macuxi/platform-sdk';
import { useEffect, useState } from 'react';

import { readJson, writeJson } from './storage';

export const CHAVE_DADOS_LEGAIS = 'macuxi.dados-legais';
export const PRAZO_DADOS_LEGAIS_MS = 5_000;

/** Endereço da rota pública a partir do endereço da API em uso (terminado em `/v1`). */
export function urlDosDadosLegais(apiUrl: string): string {
  return `${apiUrl.trim().replace(/\/+$/, '')}${ROTA_DADOS_LEGAIS_PUBLICOS.replace(/^\/v1/, '')}`;
}

export async function lerDadosLegaisDoCache(): Promise<DadosLegais | null> {
  const r = DadosLegaisSchema.safeParse(await readJson<unknown>(CHAVE_DADOS_LEGAIS));
  return r.success ? r.data : null;
}

/** Busca na API; qualquer falha (rede, prazo, 503, formato) devolve `null`. */
export async function buscarDadosLegais(apiUrl: string, buscar: typeof fetch = fetch): Promise<DadosLegais | null> {
  const controle = new AbortController();
  // timer-permitido: prazo da requisição (5 s), uma vez por abertura do Entrar
  const prazo = setTimeout(() => controle.abort(), PRAZO_DADOS_LEGAIS_MS);
  try {
    const res = await buscar(urlDosDadosLegais(apiUrl), { signal: controle.signal, headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const r = DadosLegaisSchema.safeParse(await res.json());
    return r.success ? r.data : null;
  } catch {
    return null;
  } finally {
    clearTimeout(prazo);
  }
}

/** Cache primeiro, rede em paralelo; a resposta da rede vence e vai para o cache. */
export function useDadosLegais(apiUrl: string): DadosLegais | null {
  const [dados, setDados] = useState<DadosLegais | null>(null);
  useEffect(() => {
    let vivo = true;
    let daRede = false;
    void lerDadosLegaisDoCache().then((c) => {
      if (vivo && c && !daRede) setDados(c);
    });
    void buscarDadosLegais(apiUrl).then((d) => {
      if (!vivo || !d) return;
      daRede = true;
      setDados(d);
      void writeJson(CHAVE_DADOS_LEGAIS, d);
    });
    return () => {
      vivo = false;
    };
  }, [apiUrl]);
  return dados;
}
