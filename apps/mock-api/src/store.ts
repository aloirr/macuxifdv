import { existsSync, watch, type FSWatcher, statSync } from 'node:fs';
import path from 'node:path';
import { FILES, type FileKey, TABLE_FILE } from './excel/tables';
import { FileLockedError, readFile, writeFileSafe } from './excel/io';
import { emptyTables, type TableKey, type Tables } from './excel/rows';

type Logger = { info: (msg: string) => void; warn: (msg: string) => void; error: (msg: string) => void };
const consoleLogger: Logger = {
  info: (m) => console.log(`[mock-data] ${m}`),
  warn: (m) => console.warn(`[mock-data] ${m}`),
  error: (m) => console.error(`[mock-data] ${m}`),
};

/**
 * Banco em memória carregado das planilhas. As rotas leem daqui; toda gravação
 * passa por `commit`, que regrava só os arquivos tocados, com escrita segura.
 * Arquivo aberto no Excel: a mudança fica em memória e é regravada sozinha a cada 5 s.
 */
export class Store {
  tables: Tables = emptyTables();
  /** arquivos com mudança ainda não gravada (Excel aberto) */
  readonly dirty = new Set<FileKey>();
  /** versão incrementada a cada mudança (útil para cache) */
  version = 0;
  private lastOwnWrite = new Map<FileKey, number>();
  private watchers: FSWatcher[] = [];
  private retryTimer: NodeJS.Timeout | null = null;
  private reloadTimers = new Map<FileKey, NodeJS.Timeout>();

  constructor(
    readonly dataDir: string,
    private readonly log: Logger = consoleLogger,
  ) {}

  abs(fk: FileKey): string {
    return path.join(this.dataDir, FILES[fk].file);
  }

  missingFiles(): string[] {
    return (Object.keys(FILES) as FileKey[]).filter((fk) => !existsSync(this.abs(fk))).map((fk) => FILES[fk].file);
  }

  async loadAll(): Promise<void> {
    const t = emptyTables();
    for (const fk of Object.keys(FILES) as FileKey[]) {
      const abs = this.abs(fk);
      if (!existsSync(abs)) continue;
      const data = await readFile(abs, FILES[fk]);
      Object.assign(t, data);
    }
    this.tables = t;
    this.dirty.clear();
    this.version++;
  }

  async reloadFile(fk: FileKey): Promise<void> {
    if (this.dirty.has(fk)) {
      this.log.warn(`${FILES[fk].file} mudou no disco, mas há gravação pendente; mantendo a versão em memória.`);
      return;
    }
    const data = await readFile(this.abs(fk), FILES[fk]);
    Object.assign(this.tables, data);
    this.version++;
    this.log.info(`recarregado ${FILES[fk].file}`);
  }

  /** Substitui todas as tabelas e grava todos os arquivos (seed / reset). */
  async replaceAll(tables: Tables): Promise<void> {
    this.tables = tables;
    this.version++;
    const locked: string[] = [];
    for (const fk of Object.keys(FILES) as FileKey[]) {
      try {
        await this.writeFile(fk);
      } catch (e) {
        if (e instanceof FileLockedError) {
          this.dirty.add(fk);
          locked.push(e.fileName);
        } else throw e;
      }
    }
    if (locked.length) {
      this.scheduleRetry();
      throw new FileLockedError(locked.join(', '));
    }
  }

  /**
   * Grava os arquivos das tabelas alteradas. Se algum estiver aberto no Excel,
   * mantém em memória, agenda nova tentativa e lança FileLockedError.
   */
  async commit(tables: TableKey[]): Promise<void> {
    this.version++;
    const files = new Set<FileKey>(tables.map((t) => TABLE_FILE[t]!).filter(Boolean));
    let locked: FileLockedError | null = null;
    for (const fk of files) {
      try {
        await this.writeFile(fk);
        this.dirty.delete(fk);
      } catch (e) {
        if (e instanceof FileLockedError) {
          this.dirty.add(fk);
          locked ??= e;
        } else throw e;
      }
    }
    if (locked) {
      this.scheduleRetry();
      throw locked;
    }
  }

  /** Algum dos arquivos destas tabelas ainda está pendente de gravação? */
  pendingFileFor(tables: TableKey[]): string | null {
    for (const t of tables) {
      const fk = TABLE_FILE[t];
      if (fk && this.dirty.has(fk)) return path.basename(FILES[fk].file);
    }
    return null;
  }

  private async writeFile(fk: FileKey): Promise<void> {
    const def = FILES[fk];
    const data: Record<string, Record<string, unknown>[]> = {};
    for (const table of Object.keys(def.sheets)) {
      data[table] = this.tables[table as TableKey] as unknown as Record<string, unknown>[];
    }
    await writeFileSafe(this.abs(fk), def, data);
    this.lastOwnWrite.set(fk, Date.now());
  }

  private scheduleRetry(): void {
    if (this.retryTimer) return;
    this.retryTimer = setInterval(() => {
      void this.flushDirty();
    }, 5000);
    this.retryTimer.unref?.();
  }

  async flushDirty(): Promise<void> {
    for (const fk of [...this.dirty]) {
      try {
        await this.writeFile(fk);
        this.dirty.delete(fk);
        this.log.info(`gravação pendente concluída: ${FILES[fk].file}`);
      } catch (e) {
        if (!(e instanceof FileLockedError)) this.log.error(String(e));
      }
    }
    if (this.dirty.size === 0 && this.retryTimer) {
      clearInterval(this.retryTimer);
      this.retryTimer = null;
    }
  }

  /** Recarrega quando você edita uma planilha no Excel e salva. */
  watch(onReload?: (fk: FileKey) => void): void {
    const byDir = new Map<string, FileKey[]>();
    for (const fk of Object.keys(FILES) as FileKey[]) {
      const dir = path.dirname(this.abs(fk));
      byDir.set(dir, [...(byDir.get(dir) ?? []), fk]);
    }
    for (const [dir, keys] of byDir) {
      if (!existsSync(dir)) continue;
      const w = watch(dir, (_event, filename) => {
        if (!filename) return;
        const name = filename.toString();
        if (name.startsWith('~$') || name.startsWith('.') || name.endsWith('.tmp')) return;
        const fk = keys.find((k) => path.basename(FILES[k].file) === name);
        if (!fk) return;
        const own = this.lastOwnWrite.get(fk) ?? 0;
        if (Date.now() - own < 2500) return;
        const prev = this.reloadTimers.get(fk);
        if (prev) clearTimeout(prev);
        this.reloadTimers.set(
          fk,
          setTimeout(() => {
            this.reloadTimers.delete(fk);
            try {
              if (!existsSync(this.abs(fk)) || statSync(this.abs(fk)).size === 0) return;
            } catch {
              return;
            }
            this.reloadFile(fk)
              .then(() => onReload?.(fk))
              .catch((e) => this.log.warn(`não consegui reler ${FILES[fk].file}: ${String(e)}`));
          }, 600),
        );
      });
      this.watchers.push(w);
    }
  }

  close(): void {
    for (const w of this.watchers) w.close();
    this.watchers = [];
    if (this.retryTimer) clearInterval(this.retryTimer);
    this.retryTimer = null;
    for (const t of this.reloadTimers.values()) clearTimeout(t);
  }
}
