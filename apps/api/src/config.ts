/**
 * Configuração da API lida do ambiente na subida (`servidor.ts`). Segredos só no `.env` (CLAUDE.md regra 8).
 *
 * `MACUXI_JWT_SEGREDO` (mín. 32 caracteres) assina o JWT de acesso do Core (docs/modulos/core/auth-e-licencas.md):
 * - fora do ambiente local (NODE_ENV=production ou Postgres fora da máquina/container local) a API NÃO sobe sem ele
 *   (falha fechada: um servidor compartilhado nunca fica aberto com segredo fraco ou vazio);
 * - no ambiente local a API sobe com aviso e o login responde 503 `AUTENTICACAO_INDISPONIVEL` (ninguém autentica).
 */

import { serializarErro, type ErroDeLog } from './log-seguro';

/** Mesmo mínimo do Core (`modules/core/api/seguranca.ts`). */
export const SEGREDO_JWT_MIN = 32;

/** Hosts do Postgres local de desenvolvimento (mesma lista de `HOSTS_LOCAIS` do @macuxi/db). */
const HOSTS_LOCAIS: readonly string[] = ['localhost', '127.0.0.1', '::1', 'macuxi-postgres'];

export function ehAmbienteLocal(env: NodeJS.ProcessEnv, hostBanco: string): boolean {
  return env.NODE_ENV !== 'production' && HOSTS_LOCAIS.includes(hostBanco.trim().toLowerCase());
}

export type SituacaoSegredoJwt = { ok: true } | { ok: false; fatal: boolean; mensagem: string };

/** Confere `MACUXI_JWT_SEGREDO` sem nunca devolver o valor (vai para log). */
export function conferirSegredoJwt(env: NodeJS.ProcessEnv, hostBanco: string): SituacaoSegredoJwt {
  const s = env.MACUXI_JWT_SEGREDO;
  if (s && s.length >= SEGREDO_JWT_MIN) return { ok: true };
  const problema = s ? `MACUXI_JWT_SEGREDO curto (mínimo ${SEGREDO_JWT_MIN} caracteres)` : 'MACUXI_JWT_SEGREDO não definido';
  if (ehAmbienteLocal(env, hostBanco)) {
    return { ok: false, fatal: false, mensagem: `${problema}: a API sobe, mas o login responde 503 até você definir a variável no .env.` };
  }
  return { ok: false, fatal: true, mensagem: `${problema} fora do ambiente local: a API não sobe (falha fechada). Defina a variável no .env do servidor.` };
}

/**
 * `MACUXI_TRUST_PROXY` → opção `trustProxy` do Fastify (T-0026). Ausente, vazio, `false`/`0`: desligado (padrão).
 * `true`: confia em qualquer proxy (só atrás de um proxy que reescreve o `X-Forwarded-For`). Número inteiro: saltos.
 * Outro texto: lista de IPs/CIDR ou `loopback`/`linklocal`/`uniquelocal`, separados por vírgula (ex.: `loopback` para o
 * túnel `cloudflared` na mesma máquina, o que o `subir-demo.ps1` usa).
 */
export function lerTrustProxy(env: NodeJS.ProcessEnv): boolean | string[] | ((endereco: string, salto: number) => boolean) {
  const v = (env.MACUXI_TRUST_PROXY ?? '').trim();
  const baixo = v.toLowerCase();
  if (!v || baixo === 'false' || baixo === '0' || baixo === 'nao' || baixo === 'não') return false;
  if (baixo === 'true') return true;
  // saltos: confia nos n proxies mais próximos (mesma regra do Fastify para número, que o tipo dele não aceita)
  if (/^\d+$/.test(v)) {
    const saltos = Number(v);
    return (_endereco, salto) => salto < saltos;
  }
  return v.split(',').map((x) => x.trim()).filter(Boolean);
}

/**
 * Opções do logger pino da API (CLAUDE.md regra 8; ADR 0013 §6): `req` só com método, caminho sem query e `request_id`;
 * `res` só com o status. Redação de reforço: `Authorization`, `Cookie` e todo `X-Macuxi-*` (chave e identificador do Conector)
 * nunca saem, mesmo que alguém registre um objeto de cabeçalhos por engano. `err` passa pelo `serializarErro`
 * (`log-seguro.ts`, T-0078 D-L1a): erro do Postgres sai só com SQLSTATE, `constraint` e nomes de tabela/coluna — nunca
 * `detail`, `where`, `parameters` nem a mensagem com valores da linha.
 */
export const CAMINHOS_REDIGIDOS_LOG: readonly string[] = [
  'headers.authorization',
  'headers.cookie',
  'headers["x-macuxi-conector-id"]',
  'headers["x-macuxi-conector-versao"]',
  'cabecalhos.authorization',
  'cabecalhos.cookie',
  'cabecalhos["x-macuxi-conector-id"]',
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-macuxi-conector-id"]',
  'authorization',
  'chave',
];

export function opcoesLogger(nivel: string) {
  return {
    level: nivel,
    redact: { paths: [...CAMINHOS_REDIGIDOS_LOG], censor: '[omitido]' },
    serializers: {
      req: (req: { method: string; url: string; id: string }) => ({ method: req.method, url: req.url.split('?')[0], request_id: req.id }),
      res: (res: { statusCode: number }) => ({ status: res.statusCode }),
      // o tipo do Fastify exige `stack`; o erro do Postgres sai sem ela (a pilha é a do parser do driver, sem valor)
      err: serializarErro as (e: Error) => ErroDeLog & { stack: string },
    },
  };
}
