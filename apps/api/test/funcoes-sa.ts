/**
 * T-0091 (condição da ADR 0029): as `plataforma.sa_*` por classe, na assinatura `schema.nome(tipos)` de `oidvectortypes`.
 * A lista é UMA só, a do banco-dados (`db/testes/funcoes-sa.ts`: `FUNCOES_SA_ATUAIS` e `SA_INTERNA`; RD-0910). Aqui ela só
 * ganha o tipo `readonly string[]` que os testes da API usam:
 *  - SA_PORTAL: as com grant só ao `macuxi_portal`;
 *  - SA_INTERNAS: SECURITY INVOKER, sem EXECUTE para ninguém além do dono (chamadas de dentro das sa_* DEFINER).
 * O `scripts/deploy/producao/banco-dbaas.sh` (passo 6) lê a mesma lista na imagem da versão; o funcoes-sa.test.ts confere a
 * lista contra as migrações e o comando do script, e o portal.banco.test.ts contra o catálogo do Postgres no CI.
 */
import { FUNCOES_SA_ATE_0080, FUNCOES_SA_ATUAIS, FUNCOES_SA_CARGA, FUNCOES_SA_LOGO, SA_INTERNA } from '../../../db/testes/funcoes-sa';

/** As 27 do `main` antes deste lote (até a 0080; db/testes `FUNCOES_SA_ATE_0080`). */
export const SA_PORTAL_ATE_MAIN: readonly string[] = FUNCOES_SA_ATE_0080;
/**
 * Uma constante por item do lote (RD-1628; db/testes `FUNCOES_SA_CARGA` e `FUNCOES_SA_LOGO`). Sem a migração do item no banco,
 * os testes e o banco-dbaas.sh toleram a ausência das sa_* DELE, e só dele; com ela aplicada, a conferência é exata.
 *  - CARGA: as 3 da 0081 (T-0181, Portal › Frases da carga, só super-admin);
 *  - LOGO: as 4 da 0083 (T-0182, marca da empresa; a interna `plataforma.marca_da_empresa_json(uuid)` não tem o prefixo `sa_`).
 */
export const SA_PORTAL_CARGA: readonly string[] = FUNCOES_SA_CARGA;
export const SA_PORTAL_LOGO: readonly string[] = FUNCOES_SA_LOGO;

export const SA_PORTAL: readonly string[] = FUNCOES_SA_ATUAIS;
export const SA_INTERNAS: readonly string[] = [SA_INTERNA];
