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

/** Flag ligada: só `1`/`true`/`sim` (sem diferença de maiúsculas e espaços); ausente ou outro valor = DESLIGADO. */
const ligado = (env: NodeJS.ProcessEnv, nome: string): boolean =>
  ['1', 'true', 'sim'].includes(String(env[nome] ?? '').trim().toLowerCase());

/**
 * T-0158 (ADR 0043): `MACUXI_DIAGNOSTICOS` liga o diagnóstico na nuvem do lado do servidor (Portal › Diagnósticos na API;
 * alerta e expurgo no worker). Só `1`/`true`/`sim` liga; ausente ou outro valor = DESLIGADO (padrão até a v1.0.4).
 */
export function diagnosticosLigados(env: NodeJS.ProcessEnv): boolean {
  return ligado(env, 'MACUXI_DIAGNOSTICOS');
}

/**
 * ADR 0047: `MACUXI_PLANOS` liga as rotas de planos e licenças do portal. Só `1`/`true`/`sim` liga; ausente ou outro valor =
 * DESLIGADO (padrão até a migração de `plataforma.plano`/`plataforma.assinatura` do banco-dados).
 */
export function planosLigados(env: NodeJS.ProcessEnv): boolean {
  return ligado(env, 'MACUXI_PLANOS');
}

/**
 * ADR 0052: `MACUXI_EMPRESA_ACOES` liga as ações da empresa no portal (Inativar/Reativar, Backup, Excluir e o bloco `acoes` da
 * lista). Só `1`/`true`/`sim` liga; ausente ou outro valor = DESLIGADO (padrão até a migração 0072 do banco-dados).
 */
export function empresaAcoesLigadas(env: NodeJS.ProcessEnv): boolean {
  return ligado(env, 'MACUXI_EMPRESA_ACOES');
}

/** Chave AES-256 do backup de empresa: 32 bytes em base64 ou em 64 caracteres hex. `null` = ausente ou inválida. Nunca vai a log. */
export function chaveBackupEmpresa(env: NodeJS.ProcessEnv): Buffer | null {
  const v = String(env.MACUXI_BACKUP_EMPRESA_CHAVE ?? '').trim();
  if (!v) return null;
  if (/^[0-9a-fA-F]{64}$/.test(v)) return Buffer.from(v, 'hex');
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(v)) return null;
  const b = Buffer.from(v, 'base64');
  return b.length === 32 ? b : null;
}

/**
 * ADR 0052 §2.3: o backup de empresa só existe com o bucket (`MACUXI_ARQUIVOS_DRIVER=s3`) e a chave de cifra
 * (`MACUXI_BACKUP_EMPRESA_CHAVE`, 32 bytes). Falso = o pedido de backup responde 503 `BACKUP_INDISPONIVEL` (falha fechada).
 */
export function backupEmpresaDisponivel(env: NodeJS.ProcessEnv): boolean {
  const driver = String(env.MACUXI_ARQUIVOS_DRIVER ?? '').trim().toLowerCase();
  return driver === 's3' && chaveBackupEmpresa(env) !== null;
}

/**
 * T-0158 (R-20261111-011107): `MACUXI_DIAGNOSTICOS_APP` é a chave remota do botão "Enviar diagnóstico" no app
 * (`recursos.diagnosticos` do `GET /v1/saude`). Flag próprio, fora dos `compose.yml`, para o `MACUXI_DIAGNOSTICOS=1` da demo
 * (portal, alerta, expurgo) não ligar o botão sem a decisão do dono do produto. Só vale com `MACUXI_DIAGNOSTICOS` também
 * ligado (o portal precisa existir para ler o que chega). Mesmos valores: `1`/`true`/`sim`; o resto = DESLIGADO.
 */
export function diagnosticosAppLigados(env: NodeJS.ProcessEnv): boolean {
  return diagnosticosLigados(env) && ligado(env, 'MACUXI_DIAGNOSTICOS_APP');
}

/**
 * T-0117 (ADR 0038): `MACUXI_SESSAO_COOKIE_SEGURO` → cookie do token de renovação do BKO com HTTPS (`__Secure-macuxi_rt`,
 * `Secure`) ou sem (`macuxi_rt`, para o `http://localhost` do PC). `1`/`true`/`sim` liga, `0`/`false`/`nao` desliga; ausente
 * ou outro valor: seguro fora do ambiente local (demo e produção) e local no PC (`ehAmbienteLocal`).
 */
export function lerSessaoWeb(env: NodeJS.ProcessEnv, hostBanco: string): { seguro: boolean } {
  const v = (env.MACUXI_SESSAO_COOKIE_SEGURO ?? '').trim().toLowerCase();
  if (['1', 'true', 'sim'].includes(v)) return { seguro: true };
  if (['0', 'false', 'nao', 'não'].includes(v)) return { seguro: false };
  return { seguro: !ehAmbienteLocal(env, hostBanco) };
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
  // T-0087: `ctx.cabecalhos` das rotas públicas registrado por engano (o objeto já se serializa censurado; isto é reforço)
  '*.cabecalhos.authorization',
  'cabecalhos.cookie',
  'cabecalhos["x-macuxi-conector-id"]',
  'req.headers.authorization',
  'req.headers.cookie',
  // T-0117 (ADR 0038): o token de renovação do BKO vai em cookie; nem o `Set-Cookie` nem o campo do corpo saem no log
  'headers["set-cookie"]',
  'res.headers["set-cookie"]',
  'refresh_token',
  '*.refresh_token',
  'req.headers["x-macuxi-conector-id"]',
  'authorization',
  'chave',
  // ADR 0029 (T-0087): segredos do super-admin, se alguém registrar o corpo por engano (o Core não registra)
  'senha',
  'convite',
  // `codigo` solto fica de fora: é o código de erro dos logs (ex.: `modulo_inativo`); o TOTP só vem no corpo
  'codigo_recuperacao',
  'codigos_recuperacao',
  'segredo_base32',
  'otpauth_uri',
  'token',
  'desafio',
  'corpo.senha',
  'corpo.convite',
  'corpo.codigo',
  'corpo.codigo_recuperacao',
  'corpo.desafio',
  // T-0093 (desenho §6): senha e e-mail do login do portal e do admin inicial no passo Empresa, se alguém registrar o corpo
  'email',
  'corpo.email',
  '*.senha',
  '*.email',
  'senha_hash',
  '*.senha_hash',
  'admin.senha',
  'admin.email',
  'corpo.admin.senha',
  'corpo.admin.email',
  // T-0094 (desenho §12, fatia S): "Crie sua senha" (`senha_atual`, `senha_nova`) e o e-mail transacional (`para`), se alguém
  // registrar o corpo ou a mensagem por engano (o Core e a porta do e-mail não registram)
  'senha_atual',
  'senha_nova',
  '*.senha_atual',
  '*.senha_nova',
  'corpo.senha_atual',
  'corpo.senha_nova',
  'para',
  '*.para',
  '*.login',
  'dados.senha',
  '*.dados.senha',
  'dados.login',
  '*.dados.login',
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
