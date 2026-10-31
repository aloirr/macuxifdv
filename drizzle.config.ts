/**
 * Drizzle Kit (dono: banco-dados). Os schemas Drizzle são o espelho tipado das tabelas; as migrações
 * VERSIONADAS são SQL escrito à mão em db/migrations (NNNN_nome.up.sql + .down.sql), porque precisam
 * de RLS, grants, funções e caminho de volta. `pnpm --filter @macuxi/db drizzle:rascunho` gera só um
 * RASCUNHO em db/drizzle-rascunho/ (fora do controle de versão) para servir de ponto de partida.
 */
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  dialect: 'postgresql',
  schema: ['./db/esquema/*.ts', './modules/*/db/nuvem.ts'],
  out: './db/drizzle-rascunho',
  schemaFilter: ['plataforma', 'core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'],
  dbCredentials: {
    url:
      process.env.MACUXI_PG_URL_ADMIN ??
      `postgres://${process.env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres'}:${process.env.MACUXI_PG_ADMIN_SENHA ?? 'postgres'}@${process.env.MACUXI_PG_HOST ?? 'localhost'}:${process.env.MACUXI_PG_PORTA ?? '5432'}/${process.env.MACUXI_PG_BANCO ?? 'macuxi'}`,
  },
});
