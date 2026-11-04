/** Tipos do cliente S3 node puro s3.mjs (usados por db/testes/backup.test.ts). */
import type { IncomingMessage } from 'node:http';
import type { Readable } from 'node:stream';

export declare const SHA256_VAZIO: string;

export interface ConfigS3 {
  endpoint: string;
  regiao: string;
  bucket: string;
  chaveId: string;
  segredo: string;
  estilo?: 'caminho' | 'virtual';
}

export interface PedidoAssinavel {
  metodo: string;
  /** Caminho já codificado. */
  caminho: string;
  query?: Record<string, string>;
  /** Todos são assinados (inclua host). */
  cabecalhos: Record<string, string>;
  hashCorpo: string;
}

export interface ClienteS3 {
  gravar(chave: string, corpo: Buffer | Readable, opcoes: { tamanho: number; hashCorpo: string; metadados?: Record<string, string> }): Promise<void>;
  ler(chave: string): Promise<IncomingMessage | null>;
  info(chave: string): Promise<{ tamanho: number; metadados: Record<string, string> } | null>;
  remover(chave: string): Promise<void>;
  listar(prefixo: string): Promise<Array<{ chave: string; tamanho: number; modificado: string | null }>>;
}

export declare class ErroS3 extends Error {
  readonly operacao: string;
  readonly status: number;
  readonly codigo: string | null;
  constructor(operacao: string, status: number, codigo: string | null);
}

export declare function codificarRfc3986(s: string): string;
export declare function codificarCaminho(caminho: string): string;
export declare function queryCanonica(query: Record<string, string>): string;
export declare function dataAmz(quando: Date): string;
export declare function assinarSigV4(pedido: PedidoAssinavel, cred: { chaveId: string; segredo: string; regiao: string }, quando: Date): string;
export declare function criarClienteS3(cfg: ConfigS3, opcoes?: { agora?: () => Date; timeoutMs?: number }): ClienteS3;
