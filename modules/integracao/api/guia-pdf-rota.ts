/**
 * `GET /integracao/v1/guia.pdf`: o Guia da API em PDF (estático, gerado por `pnpm --filter @macuxi/integracao guia-pdf` e versionado
 * em `docs/guia-api-hub.pdf`). Público como o `openapi.json` (sem token, ADR 0030); limite, cache, ETag e `attachment` são da plataforma.
 * O arquivo é lido uma vez, na carga do módulo.
 */
import { readFileSync } from 'node:fs';
import type { RotaPublica } from '@macuxi/platform-sdk';

const PDF = readFileSync(new URL('../docs/guia-api-hub.pdf', import.meta.url));

export const rotaGuiaPdf: RotaPublica = {
  metodo: 'GET',
  caminho: 'guia.pdf',
  limite: { max: 60, janelaMs: 60_000 },
  cache: { maxAgeSegundos: 3600 },
  tipoConteudo: 'application/pdf',
  nomeArquivo: 'macuxi-guia-api-v1.pdf',
  executar: async () => PDF,
};
