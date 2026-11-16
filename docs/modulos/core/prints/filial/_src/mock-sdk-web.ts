// Dublê de @macuxi/platform-sdk/web: a "API" devolve os dados fictícios de dados.ts.
import { responder } from './dados';
export async function api(caminho: string): Promise<unknown> {
  return responder(caminho);
}
export const errorMessage = (e: unknown): string => (e instanceof Error ? e.message : String(e));
