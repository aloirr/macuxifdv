/** Carrega a fixture dois-tenants (db/seeds/fixtures) num banco local já migrado, para o teste da limpeza. Uso: tsx carregar-fixture.ts <banco> */
import pg from 'pg';
import { carregarDoisTenants } from '../../../db/seeds/fixtures/dois-tenants';

const c = new pg.Client({
  host: process.env.MACUXI_PG_HOST ?? '127.0.0.1',
  port: Number(process.env.MACUXI_PG_PORTA ?? 5432),
  user: process.env.MACUXI_PG_ADMIN_USUARIO ?? 'postgres',
  password: process.env.MACUXI_PG_ADMIN_SENHA ?? 'postgres',
  database: process.argv[2],
});
await c.connect();
await carregarDoisTenants(c);
await c.end();
