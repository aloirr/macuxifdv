// Prints da apresentação (R-20261118-2250): um dia da vendedora Carla Lima com o cliente Mercado Bom Preço, depois a Gestão.
// Telas como estão hoje no código (modules/*/app e packages/ui), com três novidades da v1.0.15: o pedido sem o prazo médio,
// a P-6 (pedido que passa do crédito vai para aprovação, uma aprovação por motivo) e o rastreamento no expediente.
// Uso, a partir da raiz do repositório: node docs/design/apresentacao-2026-11/gerar.mjs [prefixo ...]
// (sem o Playwright no repositório: NODE_PATH="$(npm root -g)" node docs/design/apresentacao-2026-11/gerar.mjs)
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { fotografar } from './base.mjs';
import { TELAS_CAMPO } from './telas-campo.mjs';
import { TELAS_DIA } from './telas-dia.mjs';
import { TELAS_GESTAO } from './telas-gestao.mjs';
import { TELAS_RASTREAMENTO } from './telas-rastreamento.mjs';

const AQUI = dirname(fileURLToPath(import.meta.url));
const filtro = process.argv.slice(2);
await fotografar({ ...TELAS_DIA, ...TELAS_CAMPO, ...TELAS_GESTAO, ...TELAS_RASTREAMENTO }, AQUI, filtro.length ? filtro : null);
