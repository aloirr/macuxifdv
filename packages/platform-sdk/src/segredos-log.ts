/**
 * Campos de segredo que nunca saem no log (desenho `docs/desenho/integracao-modelos-erp.md` §2.2; ADR 0066; RN-INT-17
 * proposta): credencial do ERP na busca pela API (senha, token, `B1SESSION`, appkey) e cabeçalhos de autenticação.
 * Puro TypeScript: a API e o worker juntam estes caminhos à redação do pino (`apps/api/src/config.ts`).
 *
 * É reforço: o cliente HTTP de saída e o cofre não registram cabeçalho, corpo nem segredo.
 */

/** Chaves de segredo (o pino compara a chave exata, com caixa). */
export const CAMPOS_SEGREDO_LOG: readonly string[] = [
  'senha',
  'segredo',
  'token',
  'authorization',
  'Authorization',
  'cookie',
  'Cookie',
  'password',
  'Password',
  'appkey',
  'appKey',
  'client_secret',
  'access_token',
  'api_key',
  'x-api-key',
];

const caminho = (prefixo: string, chave: string) => (/^[A-Za-z_$][\w$]*$/.test(chave) ? `${prefixo}${prefixo ? '.' : ''}${chave}` : `${prefixo}["${chave}"]`);

/**
 * Caminhos de redação do pino (fast-redact: `*` vale um nível): a chave solta (quando é identificador), no 2º e no 3º nível
 * (ex.: `erp.cabecalhos.authorization`), mais o `set-cookie` da resposta do ERP.
 */
export const CAMINHOS_SEGREDO_LOG: readonly string[] = [
  ...CAMPOS_SEGREDO_LOG.flatMap((c) => {
    const nivel1 = /^[A-Za-z_$][\w$]*$/.test(c) ? [c] : [];
    return [...nivel1, caminho('*', c), caminho('*.*', c)];
  }),
  '*["set-cookie"]',
  '*.*["set-cookie"]',
];
