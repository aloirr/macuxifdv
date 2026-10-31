/**
 * URL padrão da API. Puro para teste. Porta conforme o modo (`modo-api.ts`): 8100 na API real, 8000 no mock-api.
 * Ordem: EXPO_PUBLIC_API_URL → navegador (mesmo host da página) → IP do PC que serve o Metro (Expo Go) → localhost.
 */
export const API_PORT = 8000;

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

export function normalizeApiUrl(url: string): string {
  let u = url.trim();
  if (!u) return u;
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  u = u.replace(/\/+$/, '');
  if (!/\/v1$/.test(u)) u = `${u}/v1`;
  return u;
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
  if (input.envUrl && input.envUrl.trim()) return normalizeApiUrl(input.envUrl);
  if (input.platform === 'web') {
    const h = input.browserHost && input.browserHost.trim() ? input.browserHost : 'localhost';
    return `http://${h}:${porta}/v1`;
  }
  const host = hostFromHostUri(input.hostUri);
  // túnel do Expo (exp.direct) não alcança a porta da API no PC: cai em localhost e o usuário edita
  if (host && !host.endsWith('.exp.direct')) return `http://${host}:${porta}/v1`;
  return `http://localhost:${porta}/v1`;
}
