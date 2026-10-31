/**
 * pnpm --filter mock-api seed
 * Gera todas as planilhas de mock-data/ com dados fictícios (sobrescreve).
 * Data de referência: SEED_DATE=AAAA-MM-DD ou hoje em America/Manaus.
 */
import { config } from '../config';
import { Store } from '../store';
import { FileLockedError } from '../excel/io';
import { generateSeed } from './generate';

async function main() {
  const started = Date.now();
  const tables = generateSeed({ today: config.seedDate });
  const store = new Store(config.dataDir);
  try {
    await store.replaceAll(tables);
  } catch (e) {
    if (e instanceof FileLockedError) {
      console.error(`\n✖ ${e.message}\n`);
      process.exit(1);
    }
    throw e;
  }
  const n = (k: keyof typeof tables) => tables[k].length.toLocaleString('pt-BR');
  console.log(`✔ mock-data gerado em ${config.dataDir} (${((Date.now() - started) / 1000).toFixed(1)} s)`);
  console.log(`  ${n('seller')} vendedores · ${n('customer')} clientes · ${n('product')} produtos · ${n('invoice')} notas · ${n('sales_order')} pedidos · ${n('receivable')} títulos`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
