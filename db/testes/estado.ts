/** Estado compartilhado entre o globalSetup e os testes de banco (vitest provide/inject). */
import { inject } from 'vitest';
import { hojeNoFuso } from '../src/datas';

/**
 * `agora` = instante ISO com que o globalSetup carregou a fixture dois-tenants (MACUXI_AGORA ou o relógio, lido UMA vez).
 * Vem também quando o banco está indisponível, para os testes terem uma linha do tempo só (T-0042, B3).
 */
export type EstadoBanco =
  | { disponivel: true; nome: string; urlAdmin: string; urlApp: string; urlWorker: string | null; agora: string }
  | { disponivel: false; motivo: string; agora: string };

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

/**
 * Instante em que a fixture dois-tenants foi carregada (o "agora" da carga: MACUXI_AGORA ou o relógio do globalSetup).
 * Use no lugar de `new Date()` quando o teste precisa do mesmo "hoje"/"mês" que a fixture gravou (rota de hoje, metas
 * do mês, títulos vencendo hoje). Não serve para comparar com colunas gravadas por now() do banco
 * (created_at/updated_at): para essas, use o relógio do banco (`select now()`).
 */
export function agoraDaFixture(): Date {
  const e = estadoBanco() as EstadoBanco | undefined;
  if (!e?.agora) throw new Error('agoraDaFixture(): o vitest.config do pacote precisa do globalSetup @macuxi/db/teste/global-setup');
  return new Date(e.agora);
}

/**
 * "Hoje" (AAAA-MM-DD) da fixture no fuso dado; padrão: America/Manaus (tenant A). O tenant B fica em America/Sao_Paulo
 * (DOIS_TENANTS.B.fuso). É a mesma data que a fixture usou para rotas, visitas, títulos e metas daquele tenant.
 */
export function hojeDaFixture(fuso = 'America/Manaus'): string {
  return hojeNoFuso(fuso, agoraDaFixture());
}
