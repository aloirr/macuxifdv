/**
 * Driver `expo-sqlite` do contrato `DriverSqlite` do platform-sdk (desenho T-0008 §3.1 e §3.3; P4/P7) e a pasta dos
 * bancos do app (T-0088: `SistemaSqlite` do motor do usuário, `services/armazenamento.ts`).
 *
 * O `expo-sqlite ~57.0.4` está no app e o plugin (`enableFTS`) é obrigatório no `app.config.ts` desde a T-0088. Mesmo
 * assim o pacote é carregado com `require` dentro de `try` e só com o módulo nativo `ExpoSQLite` no APK: um APK sem ele
 * (ou o navegador da demonstração) não quebra, `expoSqliteDisponivel()` = `false` e o motor fica no AsyncStorage
 * (reserva, desenho T-0088 §4). Tipos mínimos locais só da API usada.
 *
 * No expo-sqlite, `withExclusiveTransactionAsync` abre OUTRA conexão: dentro de `transacaoExclusiva` só o `tx` recebido
 * escreve (o adaptador do SDK já serializa as escritas). Por isso o banco é sempre um ARQUIVO (nada de `:memory:`).
 *
 * T-0144 (causa das quedas da 1ª abertura, relatório de bug do aparelho de 10/11): toda transação exclusiva FECHA a sua
 * conexão no fim (`closeAsync`). Com o padrão do expo-sqlite (`finalizeUnusedStatementsBeforeClosing: true`), o fechamento
 * finaliza TODOS os comandos da conexão, inclusive os que o próprio FTS5 da busca guarda abertos; em seguida o
 * `sqlite3_close` desliga a tabela FTS5, que finaliza os mesmos comandos de novo: memória liberada duas vezes e o Android
 * mata o processo (SIGABRT "Scudo ERROR: invalid chunk state", em `SQLiteModule.closeDatabase`), sem tela de erro. Por isso
 * o banco abre com a opção desligada (`OPCOES_ABERTURA`), herdada pelas conexões das transações; quem prepara comando
 * (o SDK) sempre o finaliza.
 */
import { requireOptionalNativeModule } from 'expo';

import type { ComandoPreparado, DriverSqlite, ValorSql } from '@macuxi/platform-sdk';
import { Directory, Paths } from 'expo-file-system';

interface ComandoExpo {
  executeAsync(params: ValorSql[]): Promise<unknown>;
  finalizeAsync(): Promise<void>;
}

interface BancoExpo {
  execAsync(sql: string): Promise<void>;
  runAsync(sql: string, params: ValorSql[]): Promise<{ changes: number }>;
  getAllAsync<T>(sql: string, params: ValorSql[]): Promise<T[]>;
  getFirstAsync<T>(sql: string, params: ValorSql[]): Promise<T | null>;
  prepareAsync(sql: string): Promise<ComandoExpo>;
  withExclusiveTransactionAsync(fn: (txn: BancoExpo) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

/** Opções de abertura (`SQLiteOpenOptions` do expo-sqlite), só as usadas. */
export interface OpcoesAberturaExpo {
  finalizeUnusedStatementsBeforeClosing: boolean;
}

/** T-0144: sem a finalização em massa no fechamento (ela finaliza duas vezes os comandos do FTS5 e derruba o app). */
export const OPCOES_ABERTURA: OpcoesAberturaExpo = { finalizeUnusedStatementsBeforeClosing: false };

export interface ModExpoSqlite {
  openDatabaseAsync(nome: string, opcoes?: OpcoesAberturaExpo): Promise<BancoExpo>;
  deleteDatabaseAsync(nome: string): Promise<void>;
  /** Pasta dos bancos (no Android, `<files>/SQLite`, caminho sem `file://`). */
  defaultDatabaseDirectory?: unknown;
}

function carregar(): ModExpoSqlite | null {
  try {
    if (!requireOptionalNativeModule('ExpoSQLite')) return null;
    return require('expo-sqlite') as ModExpoSqlite;
  } catch {
    return null;
  }
}

let mod: ModExpoSqlite | null | undefined;
const expoSqlite = (): ModExpoSqlite | null => (mod === undefined ? (mod = carregar()) : mod);

/** O APK tem o expo-sqlite (pacote no bundle e módulo nativo)? */
export function expoSqliteDisponivel(): boolean {
  return expoSqlite() !== null;
}

function driverSobre(db: BancoExpo, dentroDeTransacao: boolean): DriverSqlite {
  const p = (params?: readonly ValorSql[]) => [...(params ?? [])];
  const driver: DriverSqlite = {
    executar: (sql) => db.execAsync(sql),
    async rodar(sql, params) {
      const r = await db.runAsync(sql, p(params));
      return { alteradas: r.changes };
    },
    todas: <T>(sql: string, params?: readonly ValorSql[]) => db.getAllAsync<T>(sql, p(params)),
    primeira: <T>(sql: string, params?: readonly ValorSql[]) => db.getFirstAsync<T>(sql, p(params)),
    async preparar(sql): Promise<ComandoPreparado> {
      const st = await db.prepareAsync(sql);
      return {
        async rodar(params) {
          await st.executeAsync(p(params));
        },
        finalizar: () => st.finalizeAsync(),
      };
    },
    async transacaoExclusiva<T>(fn: (tx: DriverSqlite) => Promise<T>): Promise<T> {
      // aninhada: roda direto na transação de fora (contrato do DriverSqlite)
      if (dentroDeTransacao) return fn(driver);
      let resultado: T | undefined;
      await db.withExclusiveTransactionAsync(async (txn) => {
        resultado = await fn(driverSobre(txn, true));
      });
      return resultado as T;
    },
    fechar: () => (dentroDeTransacao ? Promise.resolve() : db.closeAsync()),
  };
  return driver;
}

/** Abre o arquivo no módulo dado (separado para o teste, sem o módulo nativo). */
export async function abrirDriverCom(m: Pick<ModExpoSqlite, 'openDatabaseAsync'>, nome: string): Promise<DriverSqlite> {
  // as conexões das transações exclusivas herdam as opções do banco (`{ ...db.options, useNewConnection: true }`)
  return driverSobre(await m.openDatabaseAsync(nome, OPCOES_ABERTURA), false);
}

/** Abre (ou cria) o arquivo `nome` na pasta de bancos do app. Lança se o expo-sqlite não estiver no APK. */
export async function abrirDriverExpo(nome: string): Promise<DriverSqlite> {
  const m = expoSqlite();
  if (!m) throw new Error('expo-sqlite não está neste APK');
  return abrirDriverCom(m, nome);
}

/** Apaga o arquivo do banco (fechado antes). Sem arquivo ou sem expo-sqlite: nada acontece. */
export async function apagarBancoExpo(nome: string): Promise<void> {
  const m = expoSqlite();
  if (!m) return;
  try {
    await m.deleteDatabaseAsync(nome);
  } catch {
    // arquivo inexistente (primeira vez) ou já apagado
  }
}

/**
 * Apaga o banco e os anexos `-wal`/`-shm` (`deleteDatabaseAsync`), LANÇANDO na falha: o bloqueio do aparelho
 * (RN-CORE-15) registra e segue para o próximo arquivo (`criarSistemaSqlite`). Sem expo-sqlite: nada a apagar.
 */
export async function apagarBancoExpoOuLancar(nome: string): Promise<void> {
  const m = expoSqlite();
  if (!m) return;
  await m.deleteDatabaseAsync(nome);
}

/** Pasta dos bancos do expo-sqlite: a do módulo nativo; sem ela, `<documentos>/SQLite` (o padrão no Android). */
function pastaDosBancos(m: ModExpoSqlite): Directory {
  const d = m.defaultDatabaseDirectory;
  if (typeof d === 'string' && d.length > 0) return new Directory(d.startsWith('file:') ? d : `file://${d}`);
  return new Directory(Paths.document, 'SQLite');
}

/** Nomes dos arquivos da pasta dos bancos (com os anexos `-wal`/`-shm`). Sem expo-sqlite ou sem a pasta: nenhum. */
export function listarBancosExpo(): string[] {
  const m = expoSqlite();
  if (!m) return [];
  const pasta = pastaDosBancos(m);
  if (!pasta.exists) return [];
  return pasta.list().map((x) => x.name);
}
