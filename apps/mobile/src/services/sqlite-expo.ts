/**
 * Driver `expo-sqlite` do contrato `DriverSqlite` do platform-sdk (desenho T-0008 §3.1 e §3.3; P4/P7).
 *
 * O `expo-sqlite` entra pela janela de instalação do engenheiro-software (`~57.0.4`, com o plugin `enableFTS` no
 * `app.config.ts`). Até lá ele é OPCIONAL: carregado com `require` dentro de `try` (o Metro aceita dependência opcional)
 * e só se o módulo nativo `ExpoSQLite` estiver no APK. Sem ele, `expoSqliteDisponivel()` = `false` e a tela de
 * diagnóstico avisa; nada mais do app usa este arquivo por enquanto (o motor segue no AsyncStorage).
 * Tipos mínimos locais da API usada (o pacote ainda não está no node_modules); conferir com o `.d.ts` dele na instalação.
 *
 * No expo-sqlite, `withExclusiveTransactionAsync` abre OUTRA conexão: dentro de `transacaoExclusiva` só o `tx` recebido
 * escreve (o adaptador do SDK já serializa as escritas). Por isso o banco é sempre um ARQUIVO (nada de `:memory:`).
 */
import { requireOptionalNativeModule } from 'expo';

import type { ComandoPreparado, DriverSqlite, ValorSql } from '@macuxi/platform-sdk';

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

interface ModExpoSqlite {
  openDatabaseAsync(nome: string): Promise<BancoExpo>;
  deleteDatabaseAsync(nome: string): Promise<void>;
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

/** Abre (ou cria) o arquivo `nome` na pasta de bancos do app. Lança se o expo-sqlite não estiver no APK. */
export async function abrirDriverExpo(nome: string): Promise<DriverSqlite> {
  const m = expoSqlite();
  if (!m) throw new Error('expo-sqlite não está neste APK');
  return driverSobre(await m.openDatabaseAsync(nome), false);
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
