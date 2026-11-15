/**
 * Código da licença para as empresas com o código de antes (ADR 0048, migração 0068 §6; R-20261114-204500-alexandre,
 * "ajuste no banco a thathyany para o codigo novo"):
 *
 *   pnpm tenant:codigo-licenca --codigo thathyany [--simular]
 *   pnpm tenant:codigo-licenca --todos-legados [--simular]
 *
 * Para cada tenant: CNPJ gravado no banco (`plataforma.tenant.documento`; sem ele, o CNPJ da filial em `core.filial.cnpj`,
 * a padrão primeiro) → UF pela consulta de CNPJ (`ufDoCnpj`, a mesma do `uf-do-cnpj`) → `plataforma.atribuir_codigo_licenca`
 * (idempotente, auditoria `tenant.codigo_licenca`), pela conexão de ADMINISTRAÇÃO (MACUXI_PG_ADMIN_*), nunca macuxi_app.
 * Saída: uma linha JSON por tenant, `{ codigo_anterior, codigo, resultado, ... }`, com o CNPJ mascarado. Sem CNPJ ou sem UF,
 * nada muda e o motivo vai no `resultado`. `--simular` = cada chamada numa transação desfeita (o código mostrado é um
 * sorteio de exemplo: a rodada de verdade sorteia de novo).
 * Saída do processo: 0 tudo com código da licença · 1 erro · 2 uso errado · 3 código não encontrado · 4 algum tenant ficou
 * sem o código novo (motivo na linha).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { mascararDadoPessoal } from '@macuxi/comum/dado-pessoal';
import { cnpjValido, somenteDigitos } from '@macuxi/comum/documento';
import { CODIGO_EMPRESA_REGEX } from '@macuxi/core/contracts';
import { lerConfig, urlAdmin } from '@macuxi/db';
import pg from 'pg';
import { z } from 'zod';
import { consultaCnpjPadrao, type ConsultaCnpj } from '../consulta-cnpj';
import { MENSAGEM_FALHA_UF, ufDoCnpj, type FalhaUf } from './uf-do-cnpj';

/** Linha de `plataforma.tenant` com o que o comando usa. */
export interface TenantDoBanco {
  id: string;
  codigo: string;
  status: string;
  excluido: boolean;
  /** `plataforma.tenant.documento` (CNPJ só dígitos). */
  documento: string | null;
  /** CNPJ de uma filial viva (`core.filial.cnpj`, a padrão primeiro). */
  cnpj_filial: string | null;
}

/** Retorno de `plataforma.atribuir_codigo_licenca` (0068 §6). */
export const RespostaAtribuirSchema = z.object({
  tenant_id: z.string().uuid(),
  codigo_anterior: z.string(),
  codigo: z.string(),
  resultado: z.enum(['atribuido', 'sem_mudanca']),
});

/** Conexão de administração já aberta. `simular` = a mesma chamada numa transação desfeita. */
export interface BancoCodigoLicenca {
  buscarPorCodigo(codigo: string): Promise<TenantDoBanco | null>;
  listarTenants(): Promise<TenantDoBanco[]>;
  atribuir(tenantId: string, uf: string, opcoes: { simular: boolean }): Promise<unknown>;
  fechar(): Promise<void>;
}

export interface DepsCodigoLicenca {
  consulta: ConsultaCnpj;
  abrirBanco(): Promise<BancoCodigoLicenca>;
  saida(linha: string): void;
  erro(linha: string): void;
}

type Resultado = 'atribuido' | 'sem_mudanca' | 'sem_cnpj' | 'encerrado' | FalhaUf | 'erro';
type OrigemCnpj = 'tenant.documento' | 'filial';

export interface LinhaCodigoLicenca {
  codigo_anterior: string;
  codigo: string;
  resultado: Resultado;
  motivo?: string;
  uf?: string;
  cnpj?: string;
  origem_cnpj?: OrigemCnpj;
  simulado?: true;
}

/** A regra do login (`CODIGO_EMPRESA_REGEX`, core/contracts/auth) sem a flag `i`: aqui só maiúsculas, como no banco. */
const CODIGO_LICENCA = new RegExp(CODIGO_EMPRESA_REGEX.source);

/** Código da licença: UF (uma das 27, maiúsculas) + 4 dígitos — o mesmo CHECK `tenant_codigo_formato` da 0068. */
export function ehCodigoLicenca(codigo: string): boolean {
  return CODIGO_LICENCA.test(codigo);
}

const ehVivo = (t: TenantDoBanco): boolean => !t.excluido && t.status !== 'encerrado';

/** Tenants vivos (nem encerrados nem excluídos) com o código de antes. */
export function filtrarLegados(tenants: readonly TenantDoBanco[]): TenantDoBanco[] {
  return tenants.filter((t) => ehVivo(t) && !ehCodigoLicenca(t.codigo));
}

/** Só os 2 primeiros dígitos e a ordem do estabelecimento (ex.: 63.***.***, barra, 0001-**): o CNPJ nunca sai em claro. */
export function mascararCnpj(cnpj: string): string {
  const d = somenteDigitos(cnpj);
  return d.length === 14 ? `${d.slice(0, 2)}.***.***/${d.slice(8, 12)}-**` : '***';
}

/** CNPJ gravado: `plataforma.tenant.documento` válido; senão o da filial. */
export function cnpjDoTenant(t: TenantDoBanco): { cnpj: string; origem: OrigemCnpj } | null {
  if (cnpjValido(t.documento)) return { cnpj: somenteDigitos(t.documento), origem: 'tenant.documento' };
  if (cnpjValido(t.cnpj_filial)) return { cnpj: somenteDigitos(t.cnpj_filial), origem: 'filial' };
  return null;
}

/** Linha sem mudança: o código fica o mesmo e o motivo explica. */
function semMudar(t: TenantDoBanco, resultado: Resultado, motivo: string, extra: Partial<LinhaCodigoLicenca> = {}): LinhaCodigoLicenca {
  return { codigo_anterior: t.codigo, codigo: t.codigo, resultado, motivo, ...extra };
}

function mensagemDoBanco(e: unknown): string {
  const pgErro = e as { code?: unknown; message?: unknown };
  if (pgErro.code === '42883') return 'a função plataforma.atribuir_codigo_licenca não existe neste banco: aplique a migração 0068.';
  if (pgErro.code === '42501') return 'a conexão não tem permissão: use a conexão de administração (MACUXI_PG_ADMIN_*), nunca macuxi_app.';
  const msg = typeof pgErro.message === 'string' ? pgErro.message : String(e);
  const texto = mascararDadoPessoal(typeof pgErro.code === 'string' ? `${msg} (código ${pgErro.code})` : msg);
  return texto.length > 300 ? `${texto.slice(0, 300)}…` : texto;
}

async function processar(t: TenantDoBanco, banco: BancoCodigoLicenca, consulta: ConsultaCnpj, simular: boolean): Promise<LinhaCodigoLicenca> {
  if (!ehVivo(t)) return semMudar(t, 'encerrado', 'o tenant está encerrado ou excluído: nada muda.');
  if (ehCodigoLicenca(t.codigo)) return semMudar(t, 'sem_mudanca', 'já tem o código da licença.');
  const doc = cnpjDoTenant(t);
  if (!doc) return semMudar(t, 'sem_cnpj', 'sem CNPJ válido no banco (plataforma.tenant.documento nem core.filial.cnpj).');
  const extra = { cnpj: mascararCnpj(doc.cnpj), origem_cnpj: doc.origem };
  const uf = await ufDoCnpj(consulta, doc.cnpj);
  if (!uf.ok) return semMudar(t, uf.falha, MENSAGEM_FALHA_UF[uf.falha], extra);
  const simulado = simular ? { simulado: true as const } : {};
  try {
    const r = RespostaAtribuirSchema.safeParse(await banco.atribuir(t.id, uf.uf, { simular }));
    if (!r.success) return semMudar(t, 'erro', 'resposta inesperada de plataforma.atribuir_codigo_licenca (formato diferente da 0068 §6).', { uf: uf.uf, ...extra });
    return { codigo_anterior: r.data.codigo_anterior, codigo: r.data.codigo, resultado: r.data.resultado, uf: uf.uf, ...extra, ...simulado };
  } catch (e) {
    return semMudar(t, 'erro', mensagemDoBanco(e), { uf: uf.uf, ...extra });
  }
}

const USO = 'Uso: pnpm tenant:codigo-licenca (--codigo <código antigo> | --todos-legados) [--simular].';

class ErroUso extends Error {}

function lerArgumentos(argv: readonly string[]): { codigo: string | null; simular: boolean } {
  let v;
  try {
    v = parseArgs({
      args: [...argv],
      options: { codigo: { type: 'string' }, 'todos-legados': { type: 'boolean', default: false }, simular: { type: 'boolean', default: false } },
      strict: true,
      allowPositionals: false,
    }).values;
  } catch {
    throw new ErroUso(`argumento inválido. ${USO}`);
  }
  const codigo = v.codigo?.trim();
  if (v.codigo !== undefined && !codigo) throw new ErroUso(`--codigo vazio. ${USO}`);
  if (!!codigo === v['todos-legados']) throw new ErroUso(`use --codigo OU --todos-legados. ${USO}`);
  return { codigo: codigo ?? null, simular: v.simular };
}

/** `tenant:codigo-licenca`. Devolve o código de saída. Nunca lança: todo erro vira uma linha sem CNPJ em claro. */
export async function executarCodigoLicenca(argv: readonly string[], deps: DepsCodigoLicenca): Promise<number> {
  let a: { codigo: string | null; simular: boolean };
  try {
    a = lerArgumentos(argv);
  } catch (e) {
    deps.erro(`[codigo-licenca] erro: ${(e as Error).message}`);
    return 2;
  }
  let banco: BancoCodigoLicenca | null = null;
  try {
    banco = await deps.abrirBanco();
    let alvos: TenantDoBanco[];
    if (a.codigo) {
      const t = await banco.buscarPorCodigo(a.codigo);
      if (!t) {
        deps.erro(`[codigo-licenca] erro: nenhum tenant com o código ${a.codigo}.`);
        return 3;
      }
      alvos = [t];
    } else {
      alvos = filtrarLegados(await banco.listarTenants());
      if (alvos.length === 0) deps.erro('[codigo-licenca] nenhum tenant vivo com o código de antes: nada a fazer.');
    }
    let saida = 0;
    for (const t of alvos) {
      const linha = await processar(t, banco, deps.consulta, a.simular);
      deps.saida(JSON.stringify(linha));
      if (linha.resultado === 'erro') saida = 1;
      else if (saida === 0 && linha.resultado !== 'atribuido' && linha.resultado !== 'sem_mudanca') saida = 4;
    }
    return saida;
  } catch (e) {
    deps.erro(`[codigo-licenca] erro: ${mensagemDoBanco(e)}`);
    return 1;
  } finally {
    await banco?.fechar().catch(() => undefined);
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Ligações reais (fora dos testes)

const SELECT_TENANT = `
  select t.id, t.codigo, t.status, t.deleted_at is not null as excluido, t.documento,
         (select f.cnpj from core.filial f
           where f.tenant_id = t.id and f.cnpj is not null and f.deleted_at is null
           order by f.padrao desc, f.created_at, f.id limit 1) as cnpj_filial
    from plataforma.tenant t`;

/** Conexão de administração pelo .env (MACUXI_PG_ADMIN_*, como o `tenant:criar`). Cada atribuição na sua transação. */
export async function abrirBancoAdmin(env: NodeJS.ProcessEnv = process.env): Promise<BancoCodigoLicenca> {
  const cliente = new pg.Client({ connectionString: urlAdmin(lerConfig(env)), application_name: 'macuxi-codigo-licenca-cli' });
  await cliente.connect();
  return {
    async buscarPorCodigo(codigo) {
      const r = await cliente.query<TenantDoBanco>(`${SELECT_TENANT} where lower(t.codigo) = lower($1) limit 1`, [codigo]);
      return r.rows[0] ?? null;
    },
    async listarTenants() {
      return (await cliente.query<TenantDoBanco>(`${SELECT_TENANT} order by t.created_at, t.id`)).rows;
    },
    async atribuir(tenantId, uf, { simular }) {
      await cliente.query('begin');
      try {
        const r = await cliente.query<{ r: unknown }>('select plataforma.atribuir_codigo_licenca($1::uuid, $2) as r', [tenantId, uf]);
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

const ehExecucaoDireta = (): boolean =>
  !!process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();

if (ehExecucaoDireta()) {
  try {
    lerConfig(); // carrega o .env (raiz e db/) e falha cedo sem a conexão de administração
  } catch (e) {
    console.error(`[codigo-licenca] erro: ${(e as Error).message}`);
    process.exit(1);
  }
  void executarCodigoLicenca(process.argv.slice(2), {
    consulta: consultaCnpjPadrao(),
    abrirBanco: () => abrirBancoAdmin(),
    saida: (l) => process.stdout.write(`${l}\n`),
    erro: (l) => process.stderr.write(`${l}\n`),
  }).then((codigo) => {
    process.exitCode = codigo;
  });
}
