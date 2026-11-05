/**
 * Onboarding de tenant pelo comando (RN-CORE-31, desenho docs/desenho/T-0083.md §1–§3):
 *
 *   MACUXI_TENANT_ADMIN_SENHA=... pnpm tenant:criar --codigo distribuidora-x --nome "Distribuidora X" \
 *     --modulos core,catalogo,vendedor [--licencas vendedor=20,promotor=5] [--documento ...] [--fuso America/Manaus] \
 *     [--plano piloto] --admin-email admin@x.com.br --admin-nome "Fulana" [--redefinir-senha] [--simular] [--confirmar <codigo>]
 *
 * - Plano pelos manifestos instalados (`planoDeOnboarding`, platform-sdk); gravação idempotente pela chave `codigo` em
 *   `plataforma.provisionar_tenant(jsonb)` (banco-dados), pela conexão de ADMINISTRAÇÃO (MACUXI_PG_ADMIN_*), nunca macuxi_app.
 * - Senha do admin: só MACUXI_TENANT_ADMIN_SENHA ou digitada com eco desligado; nunca em argumento. Ao banco vai só o hash
 *   argon2id. Saída: uma linha JSON sem senha, hash, nome ou e-mail em claro (e-mail mascarado).
 * - Fora do Postgres local exige `--confirmar <codigo>` (evita criar tenant em produção por engano de .env).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { normalizarEmail, validarSenhaInicial } from '@macuxi/core/api';
import { ehBancoLocal, hashSenha, lerConfig, urlAdmin } from '@macuxi/db';
import { planoDeOnboarding, type Manifesto, type PlanoOnboarding } from '@macuxi/platform-sdk';
import pg from 'pg';
import { z } from 'zod';
import { MODULOS_API } from '../modulos';

/** Única via da senha do admin inicial além da digitação oculta (no .env ou em `docker compose run -e`). */
export const VAR_SENHA_ADMIN = 'MACUXI_TENANT_ADMIN_SENHA';

/** Entrada de `plataforma.provisionar_tenant(p jsonb)` (desenho §5, pedido R-20261105-060454). */
export interface EntradaProvisionar {
  codigo: string;
  nome: string;
  documento: string | null;
  fuso: string;
  plano: string;
  modulos: { modulo: string; licencas: number | null; perfis: string[] }[];
  admin: { email: string; nome: string; senha_hash: string };
  redefinir_senha: boolean;
}

/** Saída de `plataforma.provisionar_tenant` (desenho §3); conferida antes de imprimir. */
export const RespostaProvisionarSchema = z.object({
  tenant_id: z.string().uuid(),
  resultado: z.enum(['criado', 'atualizado', 'sem_mudanca']),
  modulos_adicionados: z.array(z.string()),
  admin: z.enum(['criado', 'existente', 'senha_redefinida']),
  avisos: z.array(z.string()).default([]),
});
export type RespostaProvisionar = z.infer<typeof RespostaProvisionarSchema>;

/** Conexão de administração já aberta. `simular` = mesma chamada numa transação desfeita no fim. */
export interface BancoOnboarding {
  /** Postgres local de desenvolvimento (sem `--confirmar`). */
  readonly local: boolean;
  provisionar(entrada: EntradaProvisionar, opcoes: { simular: boolean }): Promise<unknown>;
  fechar(): Promise<void>;
}

/** Regras do admin inicial que são do domain do Core (RN-CORE-31 item 5; mesma regra da gestão de usuários). */
export interface PoliticaAdmin {
  normalizarEmail(email: string): string;
  validarSenhaInicial(senha: string, email: string): string | null;
}

export interface DepsTenant {
  env: NodeJS.ProcessEnv;
  manifestos: readonly Manifesto[];
  /** Política do Core (`POLITICA_DO_CORE`); os testes injetam uma de mentira. */
  politica: PoliticaAdmin;
  hashSenha(senha: string): string | Promise<string>;
  /** Digitação com eco desligado; `null` = sem terminal interativo. */
  lerSenhaOculta: ((pergunta: string) => Promise<string>) | null;
  abrirBanco(): Promise<BancoOnboarding>;
  saida(linha: string): void;
  erro(linha: string): void;
}

const USO =
  'Uso: pnpm tenant:criar --codigo <codigo> --nome "<nome>" --modulos core,catalogo,... --admin-email <email> --admin-nome "<nome>" ' +
  '[--licencas modulo=N,...] [--documento <doc>] [--fuso <IANA>] [--plano <plano>] [--redefinir-senha] [--simular] [--confirmar <codigo>]. ' +
  `Senha do admin: variável ${VAR_SENHA_ADMIN} ou digitada (nunca em argumento).`;

const OPCOES = {
  codigo: { type: 'string' },
  nome: { type: 'string' },
  documento: { type: 'string' },
  fuso: { type: 'string' },
  plano: { type: 'string' },
  modulos: { type: 'string' },
  licencas: { type: 'string' },
  'admin-email': { type: 'string' },
  'admin-nome': { type: 'string' },
  'redefinir-senha': { type: 'boolean', default: false },
  simular: { type: 'boolean', default: false },
  confirmar: { type: 'string' },
} as const;

class ErroUso extends Error {}

const TAMANHO_MINIMO_SEGREDO = 3;

/** `a***@dominio` (desenho §2 item 5): nada do e-mail em claro na saída. */
export function mascararEmail(email: string): string {
  const arroba = email.lastIndexOf('@');
  if (arroba <= 0) return '***';
  return `${email[0]}***${email.slice(arroba)}`;
}

/**
 * Tira da mensagem qualquer segredo ou dado pessoal conhecido e qualquer hash argon2 (erro do banco pode trazer a linha).
 * Valores com menos de 3 caracteres (nome "A") não são trocados: viravam "[omitido] senha precisa..." no texto do Core.
 */
export function limparMensagem(texto: string, segredos: readonly string[]): string {
  let t = texto
    .replace(/\$argon2id\$v=\d+\$[a-z0-9=,]+\$[A-Za-z0-9+/]+\$[A-Za-z0-9+/]+/g, '[hash]')
    .replace(/\$argon2id\$\S*/g, '[hash]'); // pedaço de hash fora do formato PHC completo: tira tudo até o espaço
  for (const s of [...segredos].filter((x) => x.length >= TAMANHO_MINIMO_SEGREDO).sort((a, b) => b.length - a.length)) t = t.split(s).join('[omitido]');
  return t.length > 300 ? `${t.slice(0, 300)}…` : t;
}

/** Recusa senha em argumento ANTES de qualquer análise (a mensagem nunca repete o valor). */
function recusarSenhaEmArgumento(argv: readonly string[]): void {
  for (const a of argv) {
    const opcao = a.startsWith('-') ? a.split('=')[0]!.toLowerCase() : '';
    if (opcao.includes('senha') && opcao !== '--redefinir-senha') {
      throw new ErroUso(`Senha nunca vai em argumento (fica no histórico e na lista de processos): use a variável ${VAR_SENHA_ADMIN} ou digite quando o comando pedir.`);
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

function lerLicencas(texto: string | undefined): Record<string, number> {
  const r: Record<string, number> = {};
  for (const par of (texto ?? '').split(',').map((s) => s.trim()).filter(Boolean)) {
    const [modulo, n, ...resto] = par.split('=');
    if (!modulo || n === undefined || resto.length > 0 || !/^\s*-?\d+(\.\d+)?\s*$/.test(n)) throw new ErroUso(`--licencas: use modulo=N separados por vírgula (ex.: vendedor=20). ${USO}`);
    r[modulo.trim()] = Number(n);
  }
  return r;
}

async function obterSenha(deps: DepsTenant): Promise<string> {
  const doAmbiente = deps.env[VAR_SENHA_ADMIN];
  if (doAmbiente !== undefined) {
    delete deps.env[VAR_SENHA_ADMIN]; // não fica no ambiente do processo depois de lida
    if (doAmbiente.length > 0) return doAmbiente;
  }
  if (!deps.lerSenhaOculta) throw new ErroUso(`Defina ${VAR_SENHA_ADMIN} ou rode num terminal interativo para digitar a senha do admin.`);
  const senha = await deps.lerSenhaOculta('Senha do admin inicial: ');
  const confirmacao = await deps.lerSenhaOculta('Repita a senha: ');
  if (senha !== confirmacao) throw new ErroUso('As senhas digitadas não conferem.');
  return senha;
}

function montarEntrada(plano: PlanoOnboarding, email: string, senhaHash: string, redefinir: boolean): EntradaProvisionar {
  return {
    ...plano.tenant,
    modulos: plano.modulos.map((m) => ({ modulo: m.modulo, licencas: m.licencas, perfis: [...m.perfis] })),
    admin: { email, nome: plano.admin.nome, senha_hash: senhaHash },
    redefinir_senha: redefinir,
  };
}

/**
 * `tenant criar ...`. Devolve o código de saída (0 = ok). Nunca lança: todo erro vira uma linha em português no `erro`,
 * sem senha, hash, nome ou e-mail do admin.
 */
export async function executarTenant(argv: readonly string[], deps: DepsTenant): Promise<number> {
  const [comando, ...resto] = argv;
  const segredos: string[] = [];
  let banco: BancoOnboarding | null = null;
  try {
    if (comando !== 'criar') throw new ErroUso(`Comando desconhecido. ${USO}`);
    const a = lerArgumentos(resto);
    if (!a.codigo || !a.nome || !a['admin-email'] || !a['admin-nome'] || a.modulos === undefined) {
      throw new ErroUso(`Faltam --codigo, --nome, --modulos, --admin-email ou --admin-nome. ${USO}`);
    }
    segredos.push(a['admin-email'], a['admin-nome'].trim());

    const r = planoDeOnboarding(
      {
        codigo: a.codigo,
        nome: a.nome,
        documento: a.documento ?? null,
        fuso: a.fuso ?? null,
        plano: a.plano ?? null,
        modulos: a.modulos.split(',').map((s) => s.trim()).filter(Boolean),
        licencas: lerLicencas(a.licencas),
        admin: { email: a['admin-email'], nome: a['admin-nome'] },
      },
      deps.manifestos,
    );
    if (!r.ok) {
      for (const e of r.erros) deps.erro(`[tenant] ${e.campo}: ${limparMensagem(e.mensagem, segredos)}`);
      return 1;
    }
    const plano = r.plano;

    const email = deps.politica.normalizarEmail(plano.admin.email);
    segredos.push(email);

    const senha = await obterSenha(deps);
    segredos.push(senha);
    const problema = deps.politica.validarSenhaInicial(senha, email);
    if (problema) throw new ErroUso(`Senha do admin recusada: ${problema}`);
    const senhaHash = await deps.hashSenha(senha);
    segredos.push(senhaHash);

    banco = await deps.abrirBanco();
    if (!banco.local && a.confirmar?.trim().toLowerCase() !== plano.tenant.codigo) {
      throw new ErroUso(`Banco fora do ambiente local: repita o código do tenant em --confirmar ${plano.tenant.codigo} para prosseguir.`);
    }

    const bruto = await banco.provisionar(montarEntrada(plano, email, senhaHash, a['redefinir-senha']), { simular: a.simular });
    const resposta = RespostaProvisionarSchema.safeParse(bruto);
    if (!resposta.success) throw new Error('Resposta inesperada de plataforma.provisionar_tenant (formato diferente do combinado no desenho T-0083 §3).');
    const s = resposta.data;
    deps.saida(
      JSON.stringify({
        tenant_id: s.tenant_id,
        codigo: plano.tenant.codigo,
        resultado: s.resultado,
        modulos_adicionados: s.modulos_adicionados,
        admin: s.admin,
        admin_email: mascararEmail(email),
        avisos: s.avisos.map((x) => limparMensagem(x, segredos)),
        ...(a.simular ? { simulado: true } : {}),
      }),
    );
    return 0;
  } catch (e) {
    deps.erro(`[tenant] erro: ${mensagemDeErro(e, segredos)}`);
    return 1;
  } finally {
    await banco?.fechar().catch(() => undefined);
  }
}

function mensagemDeErro(e: unknown, segredos: readonly string[]): string {
  if (e instanceof ErroUso) return limparMensagem(e.message, segredos);
  const pgErro = e as { code?: unknown; message?: unknown };
  // Só código e mensagem do Postgres: o `detail` traz a linha recusada (com o hash e o e-mail).
  if (pgErro.code === '42883') return 'a função plataforma.provisionar_tenant não existe neste banco: aplique as migrações (pnpm db:migrar).';
  if (pgErro.code === '42501') return 'a conexão não tem permissão para provisionar tenant: use a conexão de administração (MACUXI_PG_ADMIN_*), nunca macuxi_app.';
  const msg = typeof pgErro.message === 'string' ? pgErro.message : String(e);
  return limparMensagem(typeof pgErro.code === 'string' ? `${msg} (código ${pgErro.code})` : msg, segredos);
}

// ------------------------------------------------------------------------------------------------------------------
// Ligações reais (fora dos testes)

/** Conexão de administração pelo .env (MACUXI_PG_ADMIN_*, como o `migrar`); "local" = `ehBancoLocal` de `@macuxi/db` (R-20261105-072635). */
export function abrirBancoAdmin(env: NodeJS.ProcessEnv = process.env): Promise<BancoOnboarding> {
  const cfg = lerConfig(env);
  return conectarBancoAdmin(urlAdmin(cfg), ehBancoLocal(cfg.host, env));
}

/** A chamada roda numa transação sem log de comando (leva o hash, como `garantirPapel`); `simular` = rollback. */
export async function conectarBancoAdmin(url: string, local: boolean): Promise<BancoOnboarding> {
  const cliente = new pg.Client({ connectionString: url, application_name: 'macuxi-tenant-cli' });
  await cliente.connect();
  return {
    local,
    async provisionar(entrada, { simular }) {
      await cliente.query('begin');
      try {
        await cliente.query(
          "select set_config('log_min_duration_statement', '-1', true), set_config('log_statement', 'none', true) where current_setting('is_superuser') = 'on'",
        );
        const r = await cliente.query<{ r: unknown }>('select plataforma.provisionar_tenant($1::jsonb) as r', [JSON.stringify(entrada)]);
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
 * Política do Core pelo que `@macuxi/core/api` exporta (a fronteira não deixa o shell ler o domain): a mesma regra da gestão
 * de usuários (RN-CORE-31 item 5), nunca uma cópia no comando. Reexport do Core em R-20261105-071929.
 */
export const POLITICA_DO_CORE: PoliticaAdmin = { normalizarEmail, validarSenhaInicial };

const ehExecucaoDireta = (): boolean =>
  !!process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (ehExecucaoDireta()) {
  try {
    lerConfig(); // carrega o .env (raiz e db/) antes de ler a senha e falha cedo sem a conexão de administração
  } catch (e) {
    console.error(`[tenant] erro: ${(e as Error).message}`);
    process.exit(1);
  }
  executarTenant(process.argv.slice(2), {
    env: process.env,
    manifestos: MODULOS_API.map((m) => m.manifesto),
    politica: POLITICA_DO_CORE,
    hashSenha,
    lerSenhaOculta: process.stdin.isTTY ? lerSenhaOcultaTty : null,
    abrirBanco: () => abrirBancoAdmin(),
    saida: (l) => process.stdout.write(`${l}\n`),
    erro: (l) => process.stderr.write(`${l}\n`),
  }).then((codigo) => {
    process.exitCode = codigo;
  });
}
