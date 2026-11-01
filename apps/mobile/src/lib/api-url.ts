/**
 * Endereço do servidor (puro, para teste).
 *
 * Decisão do Alexandre (R-20261101-065547-alexandre, substitui o item 2 do R-20261101-065230): o endereço DIGITADO é
 * usado exatamente como foi digitado, só sem os espaços das pontas (`normalizeApiUrl`). Nada de completar `/v1` nem
 * `http://`: o cartão Servidor mostra, salva e usa nas chamadas o mesmo texto. Se estiver errado, o teste falha e a
 * mensagem dá a dica ("ele termina em /v1"), sem corrigir.
 *
 * O endereço PADRÃO do build (`defaultApiUrl`, `EXPO_PUBLIC_API_URL`) continua montado com `/v1` (`completarApiUrl`),
 * porque não foi digitado pelo usuário. Porta conforme o modo (`modo-api.ts`): 8100 na API real, 8000 no mock-api.
 * Ordem do padrão: EXPO_PUBLIC_API_URL → navegador (mesmo host da página) → IP do PC que serve o Metro (Expo Go) → localhost.
 */
export const API_PORT = 8000;

/** Exemplo mostrado no campo do servidor (endereço completo, com /v1). */
export const EXEMPLO_ENDERECO = 'https://seu-servidor.com.br/v1';

/** Dica repetida nas mensagens de falha: o endereço é o da API, com /v1 no fim. */
export const DICA_V1 = 'Confira o endereço; ele termina em /v1.';

export interface ApiUrlInput {
  envUrl?: string | null;
  platform: string;
  /** window.location.hostname quando roda no navegador */
  browserHost?: string | null;
  /** Constants.expoConfig.hostUri, ex.: "192.168.0.12:8081" */
  hostUri?: string | null;
  /** Porta do servidor (padrão: API_PORT, a do mock-api). */
  porta?: number;
}

/** Endereço digitado: só tira os espaços das pontas (R-20261101-065547-alexandre). */
export function normalizeApiUrl(url: string): string {
  return url.trim();
}

/** Só para o endereço padrão do build (não digitado): completa `http://` e `/v1` e tira a barra do fim. */
export function completarApiUrl(url: string): string {
  let u = url.trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/\/+$/, '');
  if (!/\/v1$/.test(u)) u = `${u}/v1`;
  return u;
}

/**
 * Confere o formato do endereço antes de testar (sem `new URL`: o polyfill do React Native não tem `protocol`).
 * Fora do desenvolvimento só `https://` (R-20261101-023742-alexandre). Devolve a mensagem do problema ou `null`.
 */
export function problemaNoEndereco(url: string, opcoes: { exigirHttps: boolean }): string | null {
  const u = url.trim();
  if (!u) return `Digite o endereço do servidor, por exemplo ${EXEMPLO_ENDERECO}.`;
  if (/\s/.test(u) || !/^[a-z][a-z0-9+.-]*:\/\/[^/?#\s]+/i.test(u)) return `Endereço incompleto: "${u}". Digite o endereço completo, começando com https://, por exemplo ${EXEMPLO_ENDERECO}.`;
  if (/^https:\/\//i.test(u)) return null;
  if (/^http:\/\//i.test(u)) return opcoes.exigirHttps ? `O endereço precisa começar com https:// (conexão segura): "${u}". ${DICA_V1}` : null;
  return `O endereço precisa começar com https://: "${u}". ${DICA_V1}`;
}

export function hostFromHostUri(hostUri: string | null | undefined): string | null {
  if (!hostUri) return null;
  const withoutScheme = hostUri.replace(/^[a-z]+:\/\//i, '');
  const hostPort = withoutScheme.split('/')[0] ?? '';
  // IPv6 entre colchetes não é esperado aqui; tira a porta
  const host = hostPort.replace(/:\d+$/, '');
  return host || null;
}

export function defaultApiUrl(input: ApiUrlInput): string {
  const porta = input.porta ?? API_PORT;
  if (input.envUrl && input.envUrl.trim()) return completarApiUrl(input.envUrl);
  if (input.platform === 'web') {
    const h = input.browserHost && input.browserHost.trim() ? input.browserHost : 'localhost';
    return `http://${h}:${porta}/v1`;
  }
  const host = hostFromHostUri(input.hostUri);
  // túnel do Expo (exp.direct) não alcança a porta da API no PC: cai em localhost e o usuário edita
  if (host && !host.endsWith('.exp.direct')) return `http://${host}:${porta}/v1`;
  return `http://localhost:${porta}/v1`;
}
