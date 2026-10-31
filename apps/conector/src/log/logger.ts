/**
 * Log em JSON por linha, com rotação (diária + por tamanho) e retenção, sempre mascarado.
 * Arquivos: `<pasta>/conector-AAAA-MM-DD.log`; estourou `maxBytes` vira `.1`, `.2`…; apaga o que passa de `retencaoDias`.
 */
import { appendFileSync, existsSync, mkdirSync, readdirSync, renameSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { mascararValor } from './mascara';
import { relogioReal, type Relogio } from '../util/relogio';

export type Nivel = 'debug' | 'info' | 'aviso' | 'erro';
const PESO: Record<Nivel, number> = { debug: 10, info: 20, aviso: 30, erro: 40 };

export interface Logger {
  debug(evento: string, campos?: Record<string, unknown>): void;
  info(evento: string, campos?: Record<string, unknown>): void;
  aviso(evento: string, campos?: Record<string, unknown>): void;
  erro(evento: string, campos?: Record<string, unknown>): void;
}

export interface OpcoesLogger {
  pasta?: string;
  nivel?: Nivel;
  maxBytes?: number;
  maxArquivosPorDia?: number;
  retencaoDias?: number;
  console?: boolean;
  relogio?: Relogio;
  /** Destino alternativo (testes). */
  escrever?: (linha: string) => void;
}

const PADRAO_ARQUIVO = /^conector-(\d{4}-\d{2}-\d{2})(?:\.(\d+))?\.log$/;

export function criarLogger(o: OpcoesLogger = {}): Logger {
  const nivelMin = PESO[o.nivel ?? 'info'];
  const maxBytes = o.maxBytes ?? 10 * 1024 * 1024;
  const maxPartes = o.maxArquivosPorDia ?? 5;
  const retencao = o.retencaoDias ?? 30;
  const relogio = o.relogio ?? relogioReal;
  let diaLimpeza = '';
  if (o.pasta) mkdirSync(o.pasta, { recursive: true });

  function arquivoDoDia(dia: string): string {
    const base = join(o.pasta as string, `conector-${dia}.log`);
    if (existsSync(base) && statSync(base).size >= maxBytes) {
      const nome = (i: number) => (i === 0 ? base : base.replace(/\.log$/, `.${i}.log`));
      rmSync(nome(maxPartes - 1), { force: true });
      for (let i = maxPartes - 1; i >= 1; i--) if (existsSync(nome(i - 1))) renameSync(nome(i - 1), nome(i));
    }
    return base;
  }

  function limpar(dia: string): void {
    if (!o.pasta || dia === diaLimpeza) return;
    diaLimpeza = dia;
    const limite = Date.parse(`${dia}T00:00:00Z`) - retencao * 86_400_000;
    for (const nome of readdirSync(o.pasta)) {
      const m = PADRAO_ARQUIVO.exec(nome);
      if (m && Date.parse(`${m[1]}T00:00:00Z`) < limite) rmSync(join(o.pasta, nome), { force: true });
    }
  }

  function emitir(nivel: Nivel, evento: string, campos?: Record<string, unknown>): void {
    if (PESO[nivel] < nivelMin) return;
    const agora = new Date(relogio.agora());
    const linha = JSON.stringify({
      t: agora.toISOString(),
      nivel,
      evento,
      ...(campos ? (mascararValor(campos) as Record<string, unknown>) : {}),
    });
    if (o.escrever) o.escrever(linha);
    if (o.pasta) {
      const dia = agora.toISOString().slice(0, 10);
      try {
        limpar(dia);
        appendFileSync(arquivoDoDia(dia), `${linha}\n`);
      } catch {
        // log nunca derruba o Conector
      }
    }
    if (o.console) (nivel === 'erro' ? console.error : console.log)(linha);
  }

  return {
    debug: (e, c) => emitir('debug', e, c),
    info: (e, c) => emitir('info', e, c),
    aviso: (e, c) => emitir('aviso', e, c),
    erro: (e, c) => emitir('erro', e, c),
  };
}

export const loggerMudo: Logger = { debug() {}, info() {}, aviso() {}, erro() {} };
