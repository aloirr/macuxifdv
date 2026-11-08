/**
 * Super-admin do portal `config.` pelo comando (T-0093; ADR 0031; premissa P3; desenho docs/desenho/T-0093.md §7):
 *
 *   MACUXI_SUPERADMIN_SENHA=... pnpm super-admin criar --email fulana@macuxifdv.com.br --nome "Fulana" [--simular] [--confirmar <email>]
 *   MACUXI_SUPERADMIN_SENHA=... pnpm super-admin redefinir --email fulana@macuxifdv.com.br [--simular] [--confirmar <email>]
 *   pnpm super-admin desativar --email fulana@macuxifdv.com.br [--simular] [--confirmar <email>]
 *
 * - Não existe autocadastro nem convite: o time da Macuxi nasce por aqui (workflows "demo — super-admin" e
 *   "producao — super-admin", secret `DEMO_SUPERADMIN_SENHA` / `PROD_SUPERADMIN_SENHA`).
 * - Gravação por `plataforma.criar_super_admin(p jsonb)` (banco-dados, 0039), pela conexão de ADMINISTRAÇÃO
 *   (MACUXI_PG_ADMIN_*), nunca macuxi_app nem macuxi_portal (a função não tem EXECUTE para eles). Idempotente pelo e-mail:
 *   `criar` de quem já existe = `sem_mudanca` (use `redefinir`); `redefinir` e `desativar` encerram as sessões dele.
 * - Senha: só MACUXI_SUPERADMIN_SENHA (apagada do ambiente depois de lida) ou digitada com eco desligado; nunca em argumento.
 *   Conferida pela RN-CORE-32 do Core e gravada só como hash argon2id (`@macuxi/db`, o do `tenant:criar`). Saída: uma linha JSON sem senha, hash, nome nem
 *   e-mail em claro (e-mail mascarado).
 * - Fora do Postgres local exige `--confirmar <email>` (evita mexer no super-admin da produção por engano de .env).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { normalizarEmail, validarSenhaInicial } from '@macuxi/core/api';
import { ehBancoLocal, hashSenha, lerConfig, urlAdmin } from '@macuxi/db';
import pg from 'pg';
import { z } from 'zod';
import { limparMensagem, mascararEmail } from './tenant';

/** Única via da senha além da digitação oculta (no .env ou em `docker compose run -e` sem valor no argv). */
export const VAR_SENHA_SUPER_ADMIN = 'MACUXI_SUPERADMIN_SENHA';

export const ACOES_SUPER_ADMIN = ['criar', 'redefinir', 'desativar'] as const;
export type AcaoSuperAdmin = (typeof ACOES_SUPER_ADMIN)[number];

/** Entrada de `plataforma.criar_super_admin(p jsonb)` (0039): só as chaves que a função aceita. */
export type EntradaCriarSuperAdmin =
  | { acao: 'criar'; email: string; nome: string; senha_hash: string }
  | { acao: 'redefinir'; email: string; senha_hash: string }
  | { acao: 'desativar'; email: string };

/** Saída de `plataforma.criar_super_admin` (0039); conferida antes de imprimir. */
export const RespostaCriarSuperAdminSchema = z.object({
  resultado: z.enum(['criado', 'sem_mudanca', 'nao_encontrado', 'redefinido', 'desativado']),
  super_admin_id: z.string().uuid().nullable(),
  sessoes_revogadas: z.number().int().nonnegative(),
});

/** Conexão de administração já aberta. `simular` = mesma chamada numa transação desfeita no fim. */
export interface BancoSuperAdmin {
  /** Postgres local de desenvolvimento (sem `--confirmar`). */
  readonly local: boolean;
  executar(entrada: EntradaCriarSuperAdmin, opcoes: { simular: boolean }): Promise<unknown>;
  fechar(): Promise<void>;
}

/** Regras que são do Core (RN-CORE-32 e normalização do e-mail) e o hash argon2id da plataforma (`@macuxi/db`, como o `tenant:criar`). */
export interface PoliticaSuperAdmin {
  normalizarEmail(email: string): string;
  validarSenhaInicial(senha: string, email: string): string | null;
  hashSenha(senha: string): string | Promise<string>;
}

export interface DepsSuperAdmin {
  env: NodeJS.ProcessEnv;
  /** Política do Core (`POLITICA_SUPER_ADMIN_DO_CORE`); os testes injetam uma de mentira. */
  politica: PoliticaSuperAdmin;
  /** Digitação com eco desligado; `null` = sem terminal interativo. */
  lerSenhaOculta: ((pergunta: string) => Promise<string>) | null;
  abrirBanco(): Promise<BancoSuperAdmin>;
  saida(linha: string): void;
  erro(linha: string): void;
}

const USO =
  'Uso: pnpm super-admin <criar|redefinir|desativar> --email <email> [--nome "<nome>" (só no criar)] [--simular] [--confirmar <email>]. ' +
  `Senha (criar e redefinir): variável ${VAR_SENHA_SUPER_ADMIN} ou digitada (nunca em argumento).`;

const OPCOES = {
  email: { type: 'string' },
  nome: { type: 'string' },
  simular: { type: 'boolean', default: false },
  confirmar: { type: 'string' },
} as const;

class ErroUso extends Error {}

/** Recusa senha em argumento ANTES de qualquer análise (a mensagem nunca repete o valor). */
function recusarSenhaEmArgumento(argv: readonly string[]): void {
  for (const a of argv) {
    const opcao = a.startsWith('-') ? a.split('=')[0]!.toLowerCase() : '';
    if (opcao.includes('senha') || opcao.includes('password') || opcao.includes('hash')) {
      throw new ErroUso(`Senha nunca vai em argumento (fica no histórico e na lista de processos): use a variável ${VAR_SENHA_SUPER_ADMIN} ou digite quando o comando pedir.`);
    }
  }
}

function lerArgumentos(argv: readonly string[]) {
  recusarSenhaEmArgumento(argv);
  try {
    return parseArgs({ args: [...argv], options: OPCOES, strict: true, allowPositionals: false }).values;
  } catch (e) {
    // A mensagem do parseArgs pode repetir o que foi digitado (um valor solto pode ser uma senha): só o tipo do erro.
    const codigo = (e as { code?: string }).code;
    const motivo = codigo === 'ERR_PARSE_ARGS_UNKNOWN_OPTION' ? 'opção desconhecida' : codigo === 'ERR_PARSE_ARGS_UNEXPECTED_POSITIONAL' ? 'argumento solto inesperado' : 'argumento inválido';
    throw new ErroUso(`${motivo}. ${USO}`);
  }
}

/** Lê e apaga a variável SEMPRE (também no desativar, que não usa senha): ela não fica no ambiente do processo. */
function tirarSenhaDoAmbiente(env: NodeJS.ProcessEnv): string | undefined {
  const valor = env[VAR_SENHA_SUPER_ADMIN];
  delete env[VAR_SENHA_SUPER_ADMIN];
  return valor;
}

async function obterSenha(doAmbiente: string | undefined, deps: DepsSuperAdmin): Promise<string> {
  if (doAmbiente !== undefined && doAmbiente.length > 0) return doAmbiente;
  if (!deps.lerSenhaOculta) throw new ErroUso(`Defina ${VAR_SENHA_SUPER_ADMIN} ou rode num terminal interativo para digitar a senha do super-admin.`);
  const senha = await deps.lerSenhaOculta('Senha do super-admin: ');
  const confirmacao = await deps.lerSenhaOculta('Repita a senha: ');
  if (senha !== confirmacao) throw new ErroUso('As senhas digitadas não conferem.');
  return senha;
}

/** E-mail mínimo (o banco confere de novo); a mensagem nunca repete o valor. */
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * `super-admin <acao> ...`. Devolve o código de saída (0 = ok). Nunca lança: todo erro vira uma linha em português no `erro`,
 * sem senha, hash, nome ou e-mail. `nao_encontrado` (redefinir/desativar de quem não existe) = saída 1.
 */
export async function executarSuperAdmin(argv: readonly string[], deps: DepsSuperAdmin): Promise<number> {
  const [comando, ...resto] = argv;
  const segredos: string[] = [];
  // a variável sai do ambiente antes de qualquer validação (inclusive em erro de uso)
  const senhaDoAmbiente = tirarSenhaDoAmbiente(deps.env);
  if (senhaDoAmbiente) segredos.push(senhaDoAmbiente);
  let banco: BancoSuperAdmin | null = null;
  try {
    if (!ACOES_SUPER_ADMIN.includes(comando as AcaoSuperAdmin)) throw new ErroUso(`Comando desconhecido. ${USO}`);
    const acao = comando as AcaoSuperAdmin;
    const a = lerArgumentos(resto);
    if (!a.email) throw new ErroUso(`Falta --email. ${USO}`);
    segredos.push(a.email);
    const email = deps.politica.normalizarEmail(a.email);
    segredos.push(email);
    if (!EMAIL_RE.test(email) || email.length > 254) throw new ErroUso('E-mail inválido.');
    const nome = a.nome?.trim() ?? '';
    if (nome) segredos.push(nome);
    if (acao === 'criar' && (nome.length < 2 || nome.length > 120)) throw new ErroUso(`criar exige --nome com 2 a 120 caracteres. ${USO}`);
    if (acao !== 'criar' && a.nome !== undefined) throw new ErroUso(`--nome só vale no criar. ${USO}`);

    let entrada: EntradaCriarSuperAdmin;
    if (acao === 'desativar') {
      entrada = { acao, email };
    } else {
      const senha = await obterSenha(senhaDoAmbiente, deps);
      segredos.push(senha);
      const problema = deps.politica.validarSenhaInicial(senha, email);
      if (problema) throw new ErroUso(`Senha recusada (RN-CORE-32): ${problema}`);
      const senhaHash = await deps.politica.hashSenha(senha);
      segredos.push(senhaHash);
      entrada = acao === 'criar' ? { acao, email, nome, senha_hash: senhaHash } : { acao, email, senha_hash: senhaHash };
    }

    banco = await deps.abrirBanco();
    if (!banco.local && a.confirmar?.trim().toLowerCase() !== email) {
      throw new ErroUso('Banco fora do ambiente local: repita o e-mail do super-admin em --confirmar para prosseguir.');
    }

    const bruto = await banco.executar(entrada, { simular: a.simular });
    const resposta = RespostaCriarSuperAdminSchema.safeParse(bruto);
    if (!resposta.success) throw new Error('Resposta inesperada de plataforma.criar_super_admin (formato diferente do combinado na 0039).');
    const r = resposta.data;
    deps.saida(
      JSON.stringify({
        acao,
        resultado: r.resultado,
        super_admin_id: r.super_admin_id,
        email: mascararEmail(email),
        sessoes_revogadas: r.sessoes_revogadas,
        ...(a.simular ? { simulado: true } : {}),
      }),
    );
    if (r.resultado === 'nao_encontrado') {
      deps.erro('[super-admin] erro: nenhum super-admin com esse e-mail (use criar).');
      return 1;
    }
    return 0;
  } catch (e) {
    deps.erro(`[super-admin] erro: ${mensagemDeErro(e, segredos)}`);
    return 1;
  } finally {
    await banco?.fechar().catch(() => undefined);
  }
}

function mensagemDeErro(e: unknown, segredos: readonly string[]): string {
  if (e instanceof ErroUso) return limparMensagem(e.message, segredos);
  const pgErro = e as { code?: unknown; message?: unknown };
  // Só código e mensagem do Postgres: o `detail` traz a linha recusada (com o hash e o e-mail).
  if (pgErro.code === '42883') return 'a função plataforma.criar_super_admin não existe neste banco: aplique as migrações (pnpm db:migrar).';
  if (pgErro.code === '42501') return 'a conexão não tem permissão para criar super-admin: use a conexão de administração (MACUXI_PG_ADMIN_*), nunca macuxi_app nem macuxi_portal.';
  const msg = typeof pgErro.message === 'string' ? pgErro.message : String(e);
  return limparMensagem(typeof pgErro.code === 'string' ? `${msg} (código ${pgErro.code})` : msg, segredos);
}

// ------------------------------------------------------------------------------------------------------------------
// Ligações reais (fora dos testes)

/** Conexão de administração pelo .env (MACUXI_PG_ADMIN_*, como o `migrar` e o `tenant:criar`). */
export function abrirBancoSuperAdmin(env: NodeJS.ProcessEnv = process.env): Promise<BancoSuperAdmin> {
  const cfg = lerConfig(env);
  return conectarBancoSuperAdmin(urlAdmin(cfg), ehBancoLocal(cfg.host, env));
}

/** A chamada roda numa transação sem log de comando (leva o hash; a função também desliga); `simular` = rollback. */
export async function conectarBancoSuperAdmin(url: string, local: boolean): Promise<BancoSuperAdmin> {
  const cliente = new pg.Client({ connectionString: url, application_name: 'macuxi-super-admin-cli' });
  await cliente.connect();
  return {
    local,
    async executar(entrada, { simular }) {
      await cliente.query('begin');
      try {
        await cliente.query(
          "select set_config('log_min_duration_statement', '-1', true), set_config('log_statement', 'none', true) where current_setting('is_superuser') = 'on'",
        );
        const r = await cliente.query<{ r: unknown }>('select plataforma.criar_super_admin($1::jsonb) as r', [JSON.stringify(entrada)]);
        await cliente.query(simular ? 'rollback' : 'commit');
        return r.rows[0]?.r;
      } catch (e) {
        await cliente.query('rollback').catch(() => undefined);
        throw e;
      }
    },
    fechar: () => cliente.end(),
  };
}

/** Digitação com eco desligado no terminal (nada vai para o histórico do shell). */
function lerSenhaOcultaTty(pergunta: string): Promise<string> {
  const entrada = process.stdin;
  return new Promise((ok, falha) => {
    let valor = '';
    const fim = (e?: Error) => {
      entrada.off('data', aoDigitar);
      entrada.setRawMode(false);
      entrada.pause();
      process.stderr.write('\n');
      if (e) falha(e);
      else ok(valor);
    };
    const aoDigitar = (pedaco: string) => {
      for (const c of pedaco) {
        if (c === '\r' || c === '\n') return fim();
        if (c === '\u0003') return fim(new ErroUso('Cancelado.'));
        if (c === '\u007f' || c === '\b') valor = valor.slice(0, -1);
        else if (c >= ' ') valor += c;
      }
    };
    process.stderr.write(pergunta);
    entrada.setEncoding('utf8');
    entrada.setRawMode(true);
    entrada.resume();
    entrada.on('data', aoDigitar);
  });
}

/**
 * Política do Core pelo que `@macuxi/core/api` exporta (a fronteira não deixa o shell ler o domain): a RN-CORE-32 é a mesma
 * de toda senha da plataforma (P1), nunca uma cópia no comando; o hash é o argon2id PHC da plataforma (`@macuxi/db`).
 */
export const POLITICA_SUPER_ADMIN_DO_CORE: PoliticaSuperAdmin = { normalizarEmail, validarSenhaInicial, hashSenha: (s) => hashSenha(s) };

const ehExecucaoDireta = (): boolean =>
  !!process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (ehExecucaoDireta()) {
  try {
    lerConfig(); // carrega o .env (raiz e db/) antes de ler a senha e falha cedo sem a conexão de administração
  } catch (e) {
    console.error(`[super-admin] erro: ${(e as Error).message}`);
    process.exit(1);
  }
  executarSuperAdmin(process.argv.slice(2), {
    env: process.env,
    politica: POLITICA_SUPER_ADMIN_DO_CORE,
    lerSenhaOculta: process.stdin.isTTY ? lerSenhaOcultaTty : null,
    abrirBanco: () => abrirBancoSuperAdmin(),
    saida: (l) => process.stdout.write(`${l}\n`),
    erro: (l) => process.stderr.write(`${l}\n`),
  }).then((codigo) => {
    process.exitCode = codigo;
  });
}
