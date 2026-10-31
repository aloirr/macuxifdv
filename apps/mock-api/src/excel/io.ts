import { promises as fs, existsSync, openSync, closeSync } from 'node:fs';
import path from 'node:path';
import ExcelJS from 'exceljs';
import { fromCents, toCents } from '../legado/dominio';
import type { ColumnDef, FileDef } from './tables';

/** Erro de arquivo aberto no Excel (Windows bloqueia a gravação). */
export class FileLockedError extends Error {
  constructor(public readonly fileName: string) {
    super(`Feche ${fileName} no Excel e tente de novo.`);
    this.name = 'FileLockedError';
  }
}

/** Excel cria "~$nome.xlsx" ao lado do arquivo aberto; no Windows o arquivo também fica travado. */
export function isFileLocked(absPath: string): boolean {
  const lockFile = path.join(path.dirname(absPath), `~$${path.basename(absPath)}`);
  if (existsSync(lockFile)) return true;
  if (!existsSync(absPath)) return false;
  try {
    const fd = openSync(absPath, 'r+');
    closeSync(fd);
    return false;
  } catch (e) {
    const code = (e as NodeJS.ErrnoException).code;
    return code === 'EBUSY' || code === 'EPERM' || code === 'EACCES';
  }
}

type Row = Record<string, unknown>;

function cellToJs(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value;
  if (typeof value === 'object') {
    if ('result' in value) return cellToJs(value.result as ExcelJS.CellValue); // fórmula: usa o resultado
    if ('richText' in value) return value.richText.map((r) => r.text).join('');
    if ('text' in value) return value.text; // hyperlink
    if ('error' in value) return null;
  }
  return value;
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

function toIsoDate(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return `${v.getUTCFullYear()}-${pad(v.getUTCMonth() + 1)}-${pad(v.getUTCDate())}`;
  const s = String(v).trim();
  const br = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s); // 12/10/2026 digitado no Excel
  if (br) return `${br[3]}-${br[2]}-${br[1]}`;
  return s.slice(0, 10);
}

function toIsoDateTime(v: unknown): string {
  if (v === null || v === undefined || v === '') return '';
  if (v instanceof Date) return v.toISOString();
  return String(v).trim();
}

function toBool(v: unknown): boolean {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  return s === 'true' || s === '1' || s === 'sim' || s === 's' || s === 'yes' || s === 'verdadeiro';
}

function toNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  if (typeof v === 'number') return v;
  const n = Number(String(v).replace(/\s/g, '').replace(',', '.'));
  return Number.isFinite(n) ? n : null;
}

export function parseCell(col: ColumnDef, raw: unknown): [string, unknown] {
  const v = cellToJs(raw as ExcelJS.CellValue);
  switch (col.type) {
    case 's':
      return [col.name, v === null ? '' : v instanceof Date ? v.toISOString() : String(v).trim()];
    case 'i': {
      const n = toNum(v);
      return [col.name, n === null ? 0 : Math.trunc(n)];
    }
    case 'n':
      return [col.name, toNum(v)];
    case 'b':
      return [col.name, toBool(v)];
    case 'd':
      return [col.name, toIsoDate(v)];
    case 'dt':
      return [col.name, toIsoDateTime(v)];
    case 'm':
      return [`${col.name}_cents`, toCents(toNum(v) ?? 0)];
  }
}

function serializeCell(col: ColumnDef, row: Row): ExcelJS.CellValue {
  if (col.type === 'm') return fromCents(Number(row[`${col.name}_cents`] ?? 0));
  const v = row[col.name];
  if (v === null || v === undefined) return null;
  if (col.type === 'b') return v ? 'sim' : 'não';
  if (col.type === 'n' || col.type === 'i') return typeof v === 'number' ? v : toNum(v);
  return String(v);
}

/** Lê um arquivo inteiro: { tabela: linhas }. Aba ausente vira lista vazia. */
export async function readFile(absPath: string, def: FileDef): Promise<Record<string, Row[]>> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.readFile(absPath);
  const out: Record<string, Row[]> = {};
  for (const [table, sheetDef] of Object.entries(def.sheets)) {
    const ws = wb.getWorksheet(sheetDef.sheet);
    const rows: Row[] = [];
    if (ws) {
      const header = new Map<string, number>();
      ws.getRow(1).eachCell((cell, colNumber) => {
        const name = String(cellToJs(cell.value) ?? '').trim();
        if (name) header.set(name, colNumber);
      });
      ws.eachRow((r, rowNumber) => {
        if (rowNumber === 1) return;
        const obj: Row = {};
        let hasValue = false;
        for (const col of sheetDef.columns) {
          const idx = header.get(col.name);
          const raw = idx ? r.getCell(idx).value : null;
          if (raw !== null && raw !== undefined && raw !== '') hasValue = true;
          const [k, v] = parseCell(col, raw);
          obj[k] = v;
        }
        if (hasValue) rows.push(obj);
      });
    }
    out[table] = rows;
  }
  return out;
}

/** Monta o workbook de um arquivo a partir das linhas em memória. */
export function buildWorkbook(def: FileDef, data: Record<string, Row[]>): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'mock-api (fase M)';
  for (const [table, sheetDef] of Object.entries(def.sheets)) {
    const ws = wb.addWorksheet(sheetDef.sheet, { views: [{ state: 'frozen', ySplit: 1 }] });
    ws.columns = sheetDef.columns.map((col) => ({
      header: col.name,
      key: col.name,
      width: col.width ?? Math.max(10, col.name.length + 2),
      style: col.type === 'm' ? { numFmt: '0.00' } : {},
    }));
    ws.getRow(1).font = { bold: true };
    for (const row of data[table] ?? []) {
      ws.addRow(sheetDef.columns.map((col) => serializeCell(col, row)));
    }
  }
  return wb;
}

/**
 * Escrita segura: grava num temporário na mesma pasta e renomeia por cima.
 * Se o Excel estiver com o arquivo aberto, lança FileLockedError sem tocar no original.
 */
export async function writeFileSafe(absPath: string, def: FileDef, data: Record<string, Row[]>): Promise<void> {
  if (isFileLocked(absPath)) throw new FileLockedError(path.basename(absPath));
  await fs.mkdir(path.dirname(absPath), { recursive: true });
  const tmp = path.join(path.dirname(absPath), `.${path.basename(absPath)}.${process.pid}.${Date.now()}.tmp`);
  const wb = buildWorkbook(def, data);
  await wb.xlsx.writeFile(tmp);
  try {
    await fs.rename(tmp, absPath);
  } catch (e) {
    await fs.rm(tmp, { force: true });
    const code = (e as NodeJS.ErrnoException).code;
    if (code === 'EBUSY' || code === 'EPERM' || code === 'EACCES') throw new FileLockedError(path.basename(absPath));
    throw e;
  }
}
