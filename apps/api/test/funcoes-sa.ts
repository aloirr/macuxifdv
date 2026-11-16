/**
 * T-0091 (condição da ADR 0029): as `plataforma.sa_*` por classe, na assinatura `schema.nome(tipos)` de `oidvectortypes`.
 * A lista é UMA só, a do banco-dados (`db/testes/funcoes-sa.ts`, export `@macuxi/db/teste/funcoes-sa`: `FUNCOES_SA_ATUAIS` e `SA_INTERNA`; RD-0910). Aqui ela só
 * ganha o tipo `readonly string[]` que os testes da API usam:
 *  - SA_PORTAL: as com grant só ao `macuxi_portal`;
 *  - SA_INTERNAS: SECURITY INVOKER, sem EXECUTE para ninguém além do dono (chamadas de dentro das sa_* DEFINER).
 * O `scripts/deploy/producao/banco-dbaas.sh` (passo 6) lê a mesma lista na imagem da versão; o funcoes-sa.test.ts confere a
 * lista contra as migrações e o comando do script, e o portal.banco.test.ts contra o catálogo do Postgres no CI.
 */
import { FUNCOES_SA_ATUAIS, SA_INTERNA } from '@macuxi/db/teste/funcoes-sa';

export const SA_PORTAL: readonly string[] = FUNCOES_SA_ATUAIS;
export const SA_INTERNAS: readonly string[] = [SA_INTERNA];
