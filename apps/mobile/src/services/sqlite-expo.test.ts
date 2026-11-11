/**
 * T-0144 — causa das quedas da 1ª abertura (relatório de bug do aparelho, 10/11): o app caía com SIGABRT em
 * `SQLiteModule.closeDatabase` ao fechar a conexão de cada transação exclusiva, porque o expo-sqlite finalizava em massa os
 * comandos que o FTS5 da busca guarda, e o `sqlite3_close` os finalizava de novo. O crash é nativo (não roda em Node); aqui
 * fica a garantia de que o banco abre SEM a finalização em massa e de que a conexão da transação herda a opção, como no
 * `withExclusiveTransactionAsync` do expo-sqlite (`{ ...db.options, useNewConnection: true }`).
 */
import { describe, expect, it, vi } from 'vitest';

vi.mock('expo', () => ({ requireOptionalNativeModule: () => null }));
vi.mock('expo-file-system', () => ({ Directory: class {}, Paths: {} }));

import { abrirDriverCom, OPCOES_ABERTURA, type OpcoesAberturaExpo } from './sqlite-expo';

interface BancoFalso {
  execAsync(): Promise<void>;
  runAsync(): Promise<{ changes: number }>;
  getAllAsync(): Promise<never[]>;
  getFirstAsync(): Promise<null>;
  prepareAsync(): Promise<{ executeAsync(): Promise<void>; finalizeAsync(): Promise<void> }>;
  withExclusiveTransactionAsync(fn: (txn: BancoFalso) => Promise<void>): Promise<void>;
  closeAsync(): Promise<void>;
}

/** Imita o expo-sqlite: cada transação exclusiva abre outra conexão com as opções do banco e a fecha no fim. */
function expoSqliteFalso() {
  const conexoes: { opcoes: OpcoesAberturaExpo | undefined; fechada: boolean }[] = [];
  const conexao = (opcoes: OpcoesAberturaExpo | undefined): BancoFalso => {
    const c = { opcoes, fechada: false };
    conexoes.push(c);
    const banco: BancoFalso = {
      execAsync: async () => undefined,
      runAsync: async () => ({ changes: 1 }),
      getAllAsync: async () => [],
      getFirstAsync: async () => null,
      prepareAsync: async () => ({ executeAsync: async () => undefined, finalizeAsync: async () => undefined }),
      async withExclusiveTransactionAsync(fn) {
        const txn = conexao(c.opcoes);
        try {
          await fn(txn);
        } finally {
          await txn.closeAsync();
        }
      },
      closeAsync: async () => {
        c.fechada = true;
      },
    };
    return banco;
  };
  return { conexoes, mod: { openDatabaseAsync: vi.fn(async (_nome: string, opcoes?: OpcoesAberturaExpo) => conexao(opcoes)) } };
}

describe('sqlite-expo — abertura sem a finalização em massa (T-0144)', () => {
  it('abre o banco com finalizeUnusedStatementsBeforeClosing: false', async () => {
    const { mod } = expoSqliteFalso();
    await abrirDriverCom(mod, 'macuxi-u-teste.db');
    expect(OPCOES_ABERTURA).toEqual({ finalizeUnusedStatementsBeforeClosing: false });
    expect(mod.openDatabaseAsync).toHaveBeenCalledWith('macuxi-u-teste.db', OPCOES_ABERTURA);
  });

  it('a conexão da transação exclusiva herda a opção e é fechada no fim (o fechamento que derrubava o app)', async () => {
    const { mod, conexoes } = expoSqliteFalso();
    const driver = await abrirDriverCom(mod, 'macuxi-u-teste.db');
    await driver.transacaoExclusiva(async (tx) => {
      await tx.rodar('INSERT INTO kv (chave, valor) VALUES (?, ?)', ['a', '1']);
    });
    expect(conexoes).toHaveLength(2);
    expect(conexoes[1]).toEqual({ opcoes: { finalizeUnusedStatementsBeforeClosing: false }, fechada: true });
    // a conexão principal continua aberta
    expect(conexoes[0]!.fechada).toBe(false);
  });
});
