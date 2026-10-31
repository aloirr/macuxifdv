/** Estado compartilhado entre o globalSetup e os testes de banco (vitest provide/inject). */
import { inject } from 'vitest';

export type EstadoBanco =
  | { disponivel: true; nome: string; urlAdmin: string; urlApp: string; urlWorker: string | null }
  | { disponivel: false; motivo: string };

declare module 'vitest' {
  export interface ProvidedContext {
    banco: EstadoBanco;
  }
}

export function estadoBanco(): EstadoBanco {
  return inject('banco');
}

/** true quando os testes que dependem de Postgres devem pular. */
export const semBanco = (): boolean => !estadoBanco().disponivel;

/** Estado com banco disponível (use só dentro de describe.skipIf(semBanco())). */
export function banco(): Extract<EstadoBanco, { disponivel: true }> {
  const e = estadoBanco();
  if (!e.disponivel) throw new Error(`banco indisponível: ${e.motivo}`);
  return e;
}
