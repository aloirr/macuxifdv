/** Estado compartilhado entre o globalSetup e os testes de banco (vitest provide/inject). */
import { inject } from 'vitest';
import { hojeNoFuso } from '../src/datas';

/**
 * `agora` = instante ISO com que o globalSetup carregou a fixture dois-tenants (MACUXI_AGORA ou o relógio, lido UMA vez).
 * Vem também quando o banco está indisponível, para os testes terem uma linha do tempo só (T-0042, B3).
 */
export type EstadoBanco =
  | {
      disponivel: true;
      nome: string;
      urlAdmin: string;
      urlApp: string;
      urlWorker: string | null;
      agora: string;
      /**
       * O admin dos testes ignora RLS por atributo (SUPERUSER ou BYPASSRLS)? false no DBaaS da Magalu e no modo do CI
       * que simula o admin sem superusuário (db/scripts/admin-sem-superusuario.ts). Ausente = true (como antes).
       */
      adminIgnoraRls?: boolean;
      /** O Postgres dos testes é local (ehBancoLocal)? false no DBaaS. Ausente = true (como antes). */
      local?: boolean;
    }
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

/**
 * Versão da migração que cria a política manutencao (0031, B1 do plano B do DBaaS, T-0075). Dali em diante o admin sem
 * superusuário (dono das tabelas, FORCE RLS) lê e grava linha de tenant; ANTES dela, não: insert do teste dá "new row
 * violates row-level security policy" e o backfill de migração vê 0 linha.
 */
export const VERSAO_MANUTENCAO = '0031';

/** Marca do motivo no título de describe/it pulado; o relatório do DBaaS conta os pulados por motivo (db/dbaas/relatorio.ts). */
export const MARCA_PULO = '[pulado: ';

/**
 * Motivo para pular um teste que tem dados no banco numa versão ANTERIOR à 0031 (up/down com dados: grava como admin na
 * versão `versaoComDados` e confere o backfill das migrações seguintes) quando o admin não ignora RLS; null = roda.
 * Com superusuário (CI e Postgres local) o teste SEMPRE roda: nada do que ele protege deixa de ser conferido; sem
 * superusuário ele não tem como rodar (o admin não enxerga as linhas antes da política manutencao, e a migração testada é
 * anterior a ela: no DBaaS ela roda numa base vazia). Teste de migração da 0032 em diante roda nos dois modos.
 */
export function motivoSemSuperusuario(versaoComDados: string): string | null {
  if (!/^\d{4}$/.test(versaoComDados)) throw new Error(`motivoSemSuperusuario: versão NNNN, não "${versaoComDados}"`);
  const e = estadoBanco();
  if (!e.disponivel || e.adminIgnoraRls !== false || versaoComDados >= VERSAO_MANUTENCAO) return null;
  return `admin sem superusuário — dados na versão ${versaoComDados}, antes da política manutencao da ${VERSAO_MANUTENCAO}; roda no CI com superusuário`;
}

/** Motivo para pular o que só roda no Postgres local (exigirBancoLocal: seed da Fase M) quando o servidor não é local; null = roda. */
export function motivoForaDoLocal(oQue: string): string | null {
  const e = estadoBanco();
  if (!e.disponivel || e.local !== false) return null;
  return `trava de ambiente local — ${oQue} só roda no Postgres local (exigirBancoLocal); roda no CI`;
}

/** Título com a marca do motivo do pulo (quando há), para o relatório e o log mostrarem por que o caso não rodou. */
export function comMotivo(titulo: string, motivo: string | null): string {
  return motivo ? `${titulo} ${MARCA_PULO}${motivo}]` : titulo;
}
