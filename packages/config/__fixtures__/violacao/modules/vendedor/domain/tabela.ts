// VIOLA modulo-importa-interno-de-outro: lendo tabela de outro schema
import { tabelaProduto } from '../../catalogo/db/schema';
// VIOLA domain-usa-modulo-do-node: domain roda no aparelho
import { join } from 'node:path';
export const caminho = join(tabelaProduto, 'x');
