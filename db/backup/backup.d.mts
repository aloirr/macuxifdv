/** Tipos do script node puro backup.mjs (usados por db/testes/backup.test.ts). */
import type { Readable, Writable } from 'node:stream';
import type { ClienteS3, ConfigS3 } from './s3.mjs';

export declare const PREFIXO_PADRAO: string;
export declare const DIAS_PADRAO: number;
export declare const MAGICA_DUMP: string;

export interface ConfigBackup {
  s3: ConfigS3;
  prefixo: string;
  dias: number;
  banco: string;
}

export declare function lerConfigBackup(env?: NodeJS.ProcessEnv): ConfigBackup;
export declare function carimbo(quando: Date): string;
export declare function chaveDoBackup(prefixo: string, banco: string, quando: Date): string;
export declare const SUFIXO_CONTAGEM: string;
export declare const LIMITE_CONTAGEM: number;
export declare function chaveDaContagem(chaveDump: string): string;
export declare function lerCarimbo(texto: string): Date;
export declare function selecionarContagensExpiradas(
  chaves: readonly string[],
  opcoes: { prefixo: string; agora: number; dias: number; removidos?: readonly string[] },
): string[];
export declare function instanteDoBackup(chave: string, prefixo: string): number | null;
export declare function selecionarExpirados(chaves: readonly string[], opcoes: { prefixo: string; agora: number; dias: number }): string[];
export declare function maisNovo(chaves: readonly string[], prefixo: string): string | null;
export declare function podar(
  cliente: ClienteS3,
  cfg: ConfigBackup,
  opcoes?: { agora?: number; simular?: boolean; preservar?: readonly string[]; contagens?: string[] },
): Promise<string[]>;
export declare function enviarBackup(
  cliente: ClienteS3,
  cfg: ConfigBackup,
  entrada: Readable,
  opcoes?: { agora?: Date },
): Promise<{ chave: string; bytes: number; sha256: string; removidos: string[]; contagensRemovidas: string[] }>;
export declare function enviarContagem(
  cliente: ClienteS3,
  cfg: ConfigBackup,
  entrada: AsyncIterable<Buffer | string>,
  opcoes: { agora: Date },
): Promise<{ chave: string; bytes: number; sha256: string }>;
export declare function resolverBackup(cliente: ClienteS3, cfg: ConfigBackup, qual: string): Promise<string>;
export declare function baixarContagem(
  cliente: ClienteS3,
  cfg: ConfigBackup,
  qual: string,
  saida: Writable,
): Promise<{ chave: string; bytes: number; sha256: string; conferido: boolean }>;
export declare function baixarBackup(
  cliente: ClienteS3,
  cfg: ConfigBackup,
  qual: string,
  saida: Writable,
): Promise<{ chave: string; bytes: number; sha256: string; conferido: boolean }>;
