/**
 * uso: node --import tsx apps/api/src/cli/reprocessar-outbox.ts --empresa <código> [--confirmar]
 * Saída: 0 ok · 1 erro · 2 uso errado · 3 empresa não encontrada · 5 acima do teto (nada mudou).
 * Regras: desenho, §7 (docs/desenho/outbox-parada-v1014.md).
 */
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import { ErroTetoReprocesso, resumirPorClasse, type ResultadoReprocesso } from '../reprocessar-outbox';

const USO = 'uso: reprocessar-outbox --empresa <código> [--confirmar]';
const RE_CODIGO = /^([a-z0-9][a-z0-9-]{1,39}|[A-Z]{2}[0-9]{4})$/;

export interface BancoReprocesso {
  /** `plataforma.tenant_por_codigo` (macuxi_app): id do tenant vivo, ou `null`. */
  tenantPorCodigo(codigo: string): Promise<string | null>;
  reprocessar(o: { tenantId: string; confirmar: boolean }): Promise<ResultadoReprocesso>;
  fechar(): Promise<void>;
}

export interface DepsReprocesso {
  abrirBanco(): Promise<BancoReprocesso>;
  saida(linha: string): void;
  erro(linha: string): void;
}

/** Linhas do resultado: só contagens, nomes de evento e classes. */
export function formatarResultado(empresa: string, r: ResultadoReprocesso): string[] {
  const l: string[] = [];
  const modo = r.modo === 'leitura' ? 'só leitura (confirmar=false): nada mudou' : 'reprocesso (confirmar=true): uma tentativa por evento';
  l.push(`empresa ${empresa} · ${modo}`);
  l.push(`parados (tentativas = ${r.maxTentativas}): ${r.selecionados.length} · já reprocessados antes e parados de novo (fora): ${r.ja_tentados}`);
  l.push('parados por evento e classe do erro:');
  for (const g of resumirPorClasse(r.selecionados)) l.push(`  ${g.eventos} | ${g.nome} | ${g.classe}`);
  if (r.modo === 'leitura') return l;
  const publicados = r.itens.filter((i) => i.resultado === 'publicado').length;
  const deNovo = r.itens.filter((i) => i.resultado === 'parado_de_novo');
  l.push(`resultado: ${publicados} publicados · ${deNovo.length} pararam de novo (não serão tentados outra vez)`);
  if (deNovo.length > 0) {
    l.push('pararam de novo, por evento e classe do erro:');
    for (const g of resumirPorClasse(deNovo.map((i) => ({ nome: i.nome, classe: i.classe_depois ?? '(sem erro)' })))) l.push(`  ${g.eventos} | ${g.nome} | ${g.classe}`);
  }
  return l;
}

/** Devolve o código de saída. Nunca lança. */
export async function executarReprocessarOutbox(argv: readonly string[], deps: DepsReprocesso): Promise<number> {
  let empresa: string;
  let confirmar: boolean;
  try {
    const v = parseArgs({ args: [...argv], options: { empresa: { type: 'string' }, confirmar: { type: 'boolean', default: false } }, strict: true, allowPositionals: false }).values;
    empresa = (v.empresa ?? '').trim();
    confirmar = v.confirmar;
    if (!RE_CODIGO.test(empresa)) throw new Error('código de empresa inválido');
  } catch (e) {
    deps.erro(`[reprocessar-outbox] erro: ${(e as Error).message}. ${USO}`);
    return 2;
  }
  let banco: BancoReprocesso | null = null;
  try {
    banco = await deps.abrirBanco();
    const tenantId = await banco.tenantPorCodigo(empresa);
    if (!tenantId) {
      deps.erro(`[reprocessar-outbox] empresa ${empresa} não encontrada (código errado ou empresa excluída).`);
      return 3;
    }
    const r = await banco.reprocessar({ tenantId, confirmar });
    for (const linha of formatarResultado(empresa, r)) deps.saida(linha);
    return 0;
  } catch (e) {
    if (e instanceof ErroTetoReprocesso) {
      deps.erro(`[reprocessar-outbox] ${e.message}.`);
      return 5;
    }
    // só o nome do erro: a mensagem pode trazer valor do banco
    deps.erro(`[reprocessar-outbox] erro: ${(e as Error)?.name ?? 'Error'}`);
    return 1;
  } finally {
    await banco?.fechar().catch(() => undefined);
  }
}

// ------------------------------------------------------------------------------------------------------------------
// Ligações reais (fora dos testes): as mesmas do worker.ts.

async function abrirBancoWorker(): Promise<BancoReprocesso> {
  const [{ lerConfigApp, urlApp, urlWorker }, { default: pg }, { default: pino }, { criarBancoApp }, { criarDespachante, verificarPapelWorker }, { MODULOS_API }, { serializarErro }] =
    await Promise.all([import('@macuxi/db'), import('pg'), import('pino'), import('../banco'), import('../despachante'), import('../modulos'), import('../log-seguro')]);
  const cfg = lerConfigApp();
  const poolWorker = new pg.Pool({ connectionString: urlWorker(cfg), max: 1, options: '-c statement_timeout=30000' });
  const poolApp = new pg.Pool({ connectionString: urlApp(cfg), max: 2, options: '-c idle_in_transaction_session_timeout=60000 -c statement_timeout=30000' });
  const fechar = async () => void (await Promise.all([poolWorker.end(), poolApp.end()]));
  try {
    const app = criarBancoApp(poolApp);
    await verificarPapelWorker(poolWorker);
    await app.verificar();
    // log no stderr, só os campos técnicos do despachante: sem `erro` (texto da falha; a classe já sai no resultado) e
    // nível fixo (o MACUXI_API_LOG=info do serviço worker não vale aqui)
    const log = pino({ level: 'warn', base: { processo: 'reprocessar-outbox' }, serializers: { err: serializarErro } }, pino.destination(2));
    const tecnico = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'erro' && k !== 'err'));
    const d = criarDespachante({
      worker: poolWorker,
      app,
      modulos: MODULOS_API,
      log: { info: (o, m) => log.info(tecnico(o), m), warn: (o, m) => log.warn(tecnico(o), m), error: (o, m) => log.error(tecnico(o), m) },
    });
    return {
      tenantPorCodigo: async (codigo) => (await poolApp.query<{ id: string }>('select id from plataforma.tenant_por_codigo($1)', [codigo])).rows[0]?.id ?? null,
      reprocessar: (o) => d.reprocessarParados(o),
      fechar,
    };
  } catch (e) {
    await fechar().catch(() => undefined);
    throw e;
  }
}

const ehPrincipal = !!process.argv[1] && resolve(fileURLToPath(import.meta.url)).toLowerCase() === resolve(process.argv[1]).toLowerCase();
if (ehPrincipal) {
  void executarReprocessarOutbox(process.argv.slice(2), {
    abrirBanco: abrirBancoWorker,
    saida: (l) => process.stdout.write(`${l}\n`),
    erro: (l) => process.stderr.write(`${l}\n`),
  }).then((codigo) => {
    process.exitCode = codigo;
  });
}
