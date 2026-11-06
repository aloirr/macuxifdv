/**
 * DROP DATABASE de base efêmera que funciona também SEM superusuário (dono: banco-dados; T-0075, ADR 0024).
 *
 * `drop database ... with (force)` encerra as outras sessões da base, mas sem superusuário o Postgres só deixa encerrar
 * processo de papel do qual o admin tem os privilégios (ou com pg_signal_backend). Se, na hora do DROP, ainda houver na
 * base uma sessão do macuxi_app/macuxi_worker saindo (o `client.end()` do pg resolve quando o socket fecha, antes de o
 * backend sumir do servidor) ou um autovacuum worker (sem papel), o DROP falha INTEIRO com 42501 "permission denied to
 * terminate process" — o CI do main 6cbcd87 (run 42159762560) ficou vermelho assim, de forma intermitente.
 *
 * Aqui: tenta o DROP com FORCE; se vier 42501 E ainda houver sessão na base, tenta o DROP comum (o Postgres mesmo
 * encerra o autovacuum e espera até 5 s as sessões saírem, sem exigir privilégio de sinal) e repete com espera
 * crescente até o prazo. Nada de conceder pg_signal_backend nem de filiar o admin aos papéis da aplicação (a política
 * de RLS "to macuxi_app" passaria a valer para ele): a correção é só esperar quem já está saindo. Passado o prazo, o erro
 * sobe com o resumo de quem segura a base (papel ou tipo de processo e quantidade; sem consulta nem dado pessoal) —
 * conexão vazada por um teste continua aparecendo como falha. Com superusuário o 1º DROP passa e nada muda.
 */
import { validarNomeBanco } from './config';

/** SQLSTATE insufficient_privilege: no DROP ... WITH (FORCE), sessão de papel que o admin não pode sinalizar. */
export const SEM_PRIVILEGIO = '42501';
/** SQLSTATE object_in_use: DROP comum com sessão que não saiu nos 5 s de espera do próprio Postgres. */
export const BASE_EM_USO = '55006';
/** Prazo padrão para as sessões que estão saindo sumirem da base. */
export const PRAZO_APAGAR_MS = 30_000;

/** O que se usa do pg.Client (e o que um cliente falso de teste precisa ter). */
export interface ClienteSql {
  query(sql: string, params?: unknown[]): Promise<{ rows: unknown[] }>;
}

export interface OpcoesApagarBanco {
  /** Prazo total (ms) para as sessões de outros papéis saírem (padrão PRAZO_APAGAR_MS). */
  prazoMs?: number;
  /** Relógio e espera injetáveis (teste sem banco). */
  agora?: () => number;
  esperar?: (ms: number) => Promise<void>;
}

/** Quem ainda está conectado à base (papel, ou o tipo do processo quando não há papel, ex.: autovacuum worker). */
export interface SessaoNaBase {
  quem: string;
  n: number;
}

const codigoDe = (e: unknown): string | undefined => (e as { code?: string } | null)?.code;

/** Espera entre tentativas: 100, 200, 400, 800 ms e depois 1 s. */
export function esperaDaTentativa(tentativa: number): number {
  return Math.min(100 * 2 ** tentativa, 1_000);
}

/** Sessões abertas na base `nome` (pg_stat_activity mostra datname, usename e backend_type a qualquer papel). */
export async function sessoesNaBase(c: ClienteSql, nome: string): Promise<SessaoNaBase[]> {
  const r = await c.query(
    `select coalesce(usename::text, backend_type, '?') as quem, count(*)::int as n
       from pg_stat_activity
      where datname = $1 and pid <> pg_backend_pid()
      group by 1
      order by 1`,
    [nome],
  );
  return r.rows as SessaoNaBase[];
}

export function descreverSessoes(s: SessaoNaBase[]): string {
  return s.length ? s.map((x) => `${x.quem} (${x.n})`).join(', ') : 'nenhuma';
}

/**
 * Apaga a base `nome` com o cliente `c` (admin conectado a OUTRA base, ex.: postgres). Idempotente (if exists).
 * Lança o erro original se não for 42501/55006, se o 42501 vier sem sessão na base (falta de privilégio de verdade,
 * ex.: admin não é dono) ou se o prazo acabar.
 */
export async function apagarBancoForcado(c: ClienteSql, nome: string, opcoes: OpcoesApagarBanco = {}): Promise<void> {
  validarNomeBanco(nome);
  const agora = opcoes.agora ?? Date.now;
  const esperar = opcoes.esperar ?? ((ms: number) => new Promise<void>((ok) => setTimeout(ok, ms)));
  const limite = agora() + (opcoes.prazoMs ?? PRAZO_APAGAR_MS);
  let semSessaoAntes = false;
  for (let tentativa = 0; ; tentativa += 1) {
    let erro: unknown;
    try {
      await c.query(`drop database if exists ${nome} with (force)`);
      return;
    } catch (e) {
      if (codigoDe(e) !== SEM_PRIVILEGIO) throw e;
      erro = e;
    }
    const sessoes = await sessoesNaBase(c, nome);
    if (sessoes.length === 0) {
      // 42501 sem ninguém na base: na 1ª vez as sessões podem ter acabado de sair (tenta de novo já); na 2ª seguida é
      // falta de privilégio de verdade (ex.: admin não é dono da base) e o erro original sobe
      if (semSessaoAntes) throw erro;
      semSessaoAntes = true;
      continue;
    }
    semSessaoAntes = false;
    try {
      // DROP comum: o Postgres encerra o autovacuum worker sozinho e espera até 5 s quem está saindo, sem sinal do admin
      await c.query(`drop database if exists ${nome}`);
      return;
    } catch (e) {
      if (codigoDe(e) !== BASE_EM_USO) throw e;
    }
    if (agora() >= limite) throw comContexto(erro, nome, await sessoesNaBase(c, nome));
    await esperar(esperaDaTentativa(tentativa));
  }
}

function comContexto(erro: unknown, nome: string, sessoes: SessaoNaBase[]): Error {
  const msg = erro instanceof Error ? erro.message : String(erro);
  const e = new Error(
    `drop database ${nome}: ${msg} — sessões que o admin sem superusuário não pode encerrar continuam na base: ${descreverSessoes(sessoes)}` +
      ' (conexão de teste não fechada? feche o cliente/pool antes do apagar())',
    { cause: erro },
  );
  (e as Error & { code?: string }).code = codigoDe(erro);
  return e;
}
