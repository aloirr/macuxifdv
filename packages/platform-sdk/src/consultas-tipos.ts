/**
 * Tipo do contrato de consulta entre módulos (ADR 0012), separado de `consultas.ts` para `api.ts` e `ambiente.ts`
 * o usarem sem ciclo entre arquivos (mesmo motivo de `busca-tipos.ts`).
 */
import type { z } from 'zod';
import type { ModuloId } from './nomes';

/** Contrato de uma consulta (fica no `contracts` do dono; crie com `definirConsulta`). */
export interface DefinicaoConsulta<E extends z.ZodTypeAny = z.ZodTypeAny, S extends z.ZodTypeAny = z.ZodTypeAny> {
  /** `<modulo>.<consulta>@vN`. */
  readonly nome: string;
  /** Dono (prefixo do nome). */
  readonly modulo: ModuloId;
  readonly versao: number;
  readonly entrada: E;
  readonly saida: S;
  /**
   * ADR 0025 §4.1 (T-0114): o DONO declara que a resposta é CONFIGURAÇÃO DO TENANT — a mesma para qualquer usuário, sem
   * recorte por perfil, carteira ou usuário (ex.: `integracao.cancelamento_erp@1`, "o ERP deste tenant aceita
   * cancelamento?"). Só com isso uma rota de ESCRITA pode pedir `{ licenca: 'tenant' }`, e a API então executa a consulta
   * num savepoint somente leitura (o Postgres recusa qualquer escrita) desfeito ao fim. Ausente = consulta comum.
   */
  readonly configuracaoDoTenant?: true;
}
