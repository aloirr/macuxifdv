/**
 * URL padrão da API (mock-api na fase M). Puro para teste.
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
  if (input.envUrl && input.envUrl.trim()) return normalizeApiUrl(input.envUrl);
  if (input.platform === 'web') {
    const h = input.browserHost && input.browserHost.trim() ? input.browserHost : 'localhost';
    return `http://${h}:${API_PORT}/v1`;
  }
  const host = hostFromHostUri(input.hostUri);
  // túnel do Expo (exp.direct) não alcança a porta 8000 do PC: cai em localhost e o usuário edita
  if (host && !host.endsWith('.exp.direct')) return `http://${host}:${API_PORT}/v1`;
  return `http://localhost:${API_PORT}/v1`;
}
