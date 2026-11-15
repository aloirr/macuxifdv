/// <reference types="node" />
/**
 * Driver `node:sqlite` (embutido no Node ≥ 22.13; aqui Node ≥ 24.7) para testes, carga no CI e ferramentas
 * (desenho T-0008 §3.2). Exportado SÓ pelo subcaminho `@macuxi/platform-sdk/sqlite-node`: o app Android nunca o importa.
 * API síncrona embrulhada em promessas (o contrato `DriverSqlite` é assíncrono por causa do expo-sqlite).
 */
import { isAbsolute, join } from 'node:path';
import { DatabaseSync, type StatementSync } from 'node:sqlite';

import type { ComandoPreparado, DriverSqlite, ValorSql } from './driver';

const APELIDO_RE = /^[a-z_]+$/;

export interface OpcoesDriverNode {
  /**
   * ADR 0054: diretório que faz o papel dos documentos do app para `anexar` (caminho relativo = relativo a ele, como no
   * shell). Sem ele, relativo ao diretório atual do processo.
   */
  diretorioArquivos?: string;
}

/** Abre (ou cria) o banco. `':memory:'` = banco temporário (um por chamada). */
export function criarDriverNode(caminho = ':memory:', opcoes: OpcoesDriverNode = {}): DriverSqlite {
  const db = new DatabaseSync(caminho);
  let emTransacao = false;
  const p = (params?: readonly ValorSql[]) => (params ?? []) as ValorSql[];
  /** Comandos preparados reaproveitados por texto SQL (o adaptador repete os mesmos milhares de vezes no pull). */
  const cache = new Map<string, StatementSync>();
  const preparado = (sql: string) => {
    let st = cache.get(sql);
    if (!st) {
      st = db.prepare(sql);
      cache.set(sql, st);
    }
    return st;
  };

  const driver: DriverSqlite = {
    async executar(sql) {
      db.exec(sql);
      // DDL pode invalidar comandos guardados (DROP/CREATE): recomeça o cache
      cache.clear();
    },
    async rodar(sql, params) {
      const r = preparado(sql).run(...p(params));
      return { alteradas: Number(r.changes) };
    },
    async todas<T>(sql: string, params?: readonly ValorSql[]) {
      return preparado(sql).all(...p(params)) as T[];
    },
    async primeira<T>(sql: string, params?: readonly ValorSql[]) {
      return (preparado(sql).get(...p(params)) as T | undefined) ?? null;
    },
    async preparar(sql): Promise<ComandoPreparado> {
      const st = preparado(sql);
      return {
        async rodar(params) {
          st.run(...p(params));
        },
        async finalizar() {
          // node:sqlite finaliza o comando no coletor de lixo
        },
      };
    },
    async transacaoExclusiva<T>(fn: (tx: DriverSqlite) => Promise<T>): Promise<T> {
      if (emTransacao) return fn(driver);
      db.exec('BEGIN IMMEDIATE');
      emTransacao = true;
      try {
        const r = await fn(driver);
        db.exec('COMMIT');
        return r;
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      } finally {
        emTransacao = false;
      }
    },
    async anexar(arquivo, apelido) {
      if (!APELIDO_RE.test(apelido)) throw new Error(`Apelido inválido para ATTACH: ${apelido}`);
      const alvo = isAbsolute(arquivo) || !opcoes.diretorioArquivos ? arquivo : join(opcoes.diretorioArquivos, arquivo);
      // caminho por parâmetro (nunca concatenado); o apelido vem de lista fixa
      db.prepare(`ATTACH DATABASE ? AS ${apelido}`).run(alvo);
    },
    async desanexar(apelido) {
      if (!APELIDO_RE.test(apelido)) throw new Error(`Apelido inválido para DETACH: ${apelido}`);
      db.exec(`DETACH DATABASE ${apelido}`);
      // comandos guardados podem citar o banco anexado
      cache.clear();
    },
    async fechar() {
      db.close();
    },
  };
  return driver;
}
