import os from 'node:os';
import { buildApp } from './app';
import { config } from './config';

async function main() {
  const { app, store } = await buildApp({ dataDir: config.dataDir, logger: false, watch: true, erpTickMs: 2000 });
  await app.listen({ port: config.port, host: config.host });
  const ips = Object.values(os.networkInterfaces())
    .flat()
    .filter((i) => i && i.family === 'IPv4' && !i.internal)
    .map((i) => i!.address);
  console.log('');
  console.log(`  mock-api (fase M) rodando · planilhas em ${store.dataDir}`);
  console.log(`  ▸ neste PC:        http://localhost:${config.port}/v1`);
  for (const ip of ips) console.log(`  ▸ celular (Wi-Fi): http://${ip}:${config.port}/v1`);
  console.log('  Edite as planilhas e salve: o mock-api recarrega sozinho. Não mude nome nem ordem das colunas.');
  console.log('');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
