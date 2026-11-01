import { randomUUID } from 'node:crypto';
import type { Armazenamento } from './armazenamento/armazenamento';
import type { ConfigConector } from './config/esquema';
import type { ConexaoErp } from './erp/driver';
import type { ClienteHub } from './hub/cliente';
import type { Logger } from './log/logger';
import type { Relogio } from './util/relogio';

/** Tudo de que os serviços do Conector precisam, injetado (facilita os testes). */
export interface Contexto {
  config: ConfigConector;
  erp: ConexaoErp;
  hub: ClienteHub;
  store: Armazenamento;
  log: Logger;
  relogio: Relogio;
  uuid: () => string;
  aleatorio: () => number;
  /** Versão em uso (padrão `VERSAO_CONECTOR`); os testes trocam para simular versão antiga. */
  versao?: string;
}

export const uuidReal = () => randomUUID();

/** Mensagem curta e sem dados pessoais para guardar/mostrar um erro. */
export function resumoErro(e: unknown): string {
  const msg = e instanceof Error ? e.message : String(e);
  return msg.split('\n')[0]?.slice(0, 300) ?? '';
}
