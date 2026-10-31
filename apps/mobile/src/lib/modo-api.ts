/**
 * Qual servidor o app usa (puro, para teste). Padrão: a API real (`apps/api`, porta 8100) com o login do Core
 * (código da empresa + e-mail + senha) e o sync v1 (`/v1/sync/push|pull`).
 * Demonstração: `EXPO_PUBLIC_API_MODO=demo` volta ao mock-api da Fase M (porta 8000): login escolhendo um usuário
 * fictício sem senha e o sync da Fase M. Configuração de build/dev (EAS `env` ou `.env` do Expo), nunca em tela.
 */
export type ModoApi = 'v1' | 'demo';

export const PORTA_API: Record<ModoApi, number> = { v1: 8100, demo: 8000 };

export function lerModoApi(env: { EXPO_PUBLIC_API_MODO?: string | undefined }): ModoApi {
  return env.EXPO_PUBLIC_API_MODO?.trim().toLowerCase() === 'demo' ? 'demo' : 'v1';
}

/** Rota de saúde de cada servidor (`/v1/saude` na API; `/v1/health` no mock-api). */
export function rotaDeSaude(modo: ModoApi): string {
  return modo === 'v1' ? '/saude' : '/health';
}
