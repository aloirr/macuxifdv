/**
 * Dados legais do rodapé das telas Entrar do BKO e do portal (docs/design/telas/rodape-legal.md §3.5): no navegador, pela
 * rota pública `GET /v1/publico/dados-legais` via proxy same-origin (`/api-proxy`), guardada por 5 min na memória da aba.
 * Carregando, com erro (503, rede, formato) ou na demonstração (o mock-api não tem a rota): `null`, e o rodapé mostra as
 * linhas 2 e 3 com o site padrão, sem esqueleto nem aviso.
 */
import { DadosLegaisSchema, ROTA_DADOS_LEGAIS_PUBLICOS, type DadosLegais } from '@macuxi/platform-sdk';
import { MODO_API, PROXY_BASE } from '@macuxi/platform-sdk/web';
import { useEffect, useState } from 'react';

export const VALIDADE_DADOS_LEGAIS_MS = 5 * 60_000;
export const PRAZO_DADOS_LEGAIS_MS = 5_000;

/** Caminho same-origin da rota pública (o proxy põe o `/v1`). */
export const CAMINHO_DADOS_LEGAIS = `${PROXY_BASE}${ROTA_DADOS_LEGAIS_PUBLICOS.replace(/^\/v1/, '')}`;

let guardado: { em: number; dados: DadosLegais } | null = null;

/** Só para os testes. */
export function esquecerDadosLegais(): void {
  guardado = null;
}

/** Busca na API; qualquer falha devolve `null` (sem lançar). */
export async function buscarDadosLegais(buscar: typeof fetch = fetch, agora: number = Date.now()): Promise<DadosLegais | null> {
  if (guardado && agora - guardado.em < VALIDADE_DADOS_LEGAIS_MS) return guardado.dados;
  const controle = new AbortController();
  // timer-permitido: prazo da requisição (5 s), uma vez por abertura do Entrar
  const prazo = setTimeout(() => controle.abort(), PRAZO_DADOS_LEGAIS_MS);
  try {
    const res = await buscar(CAMINHO_DADOS_LEGAIS, { signal: controle.signal, credentials: 'omit', headers: { accept: 'application/json' } });
    if (!res.ok) return null;
    const r = DadosLegaisSchema.safeParse(await res.json());
    if (!r.success) return null;
    guardado = { em: agora, dados: r.data };
    return r.data;
  } catch {
    return null;
  } finally {
    clearTimeout(prazo);
  }
}

export function useDadosLegais(): DadosLegais | null {
  const [dados, setDados] = useState<DadosLegais | null>(guardado?.dados ?? null);
  useEffect(() => {
    if (MODO_API === 'demo') return;
    let vivo = true;
    void buscarDadosLegais().then((d) => {
      if (vivo && d) setDados(d);
    });
    return () => {
      vivo = false;
    };
  }, []);
  return dados;
}
