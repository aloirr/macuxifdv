import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** raiz do monorepo (apps/mock-api/src → ../../..) */
export const REPO_ROOT = path.resolve(here, '..', '..', '..');

export const config = {
  port: Number(process.env.MOCK_API_PORT ?? 8000),
  host: process.env.MOCK_API_HOST ?? '0.0.0.0',
  /** pasta das planilhas: absoluta ou relativa à raiz do repositório (padrão: apps/mock-api/dados, antes mock-data/ na Fase M) */
  dataDir: path.resolve(REPO_ROOT, process.env.MOCK_DATA_DIR || 'apps/mock-api/dados'),
  seedDate: process.env.SEED_DATE || undefined,
};
