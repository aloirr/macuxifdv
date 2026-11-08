/**
 * T-0118 (D-T0107a): transação aberta na cadeia assíncrona corrente.
 *
 * O defeito: o push do pedido abria a transação (`ctx.comTenant`) e, dentro dela, `ctx.carteira()` pedia OUTRA conexão ao
 * mesmo pool. Com pushes simultâneos >= tamanho do pool, cada requisição segurava uma conexão esperando outra, e a API
 * travava até o `idle_in_transaction_session_timeout` do Postgres.
 *
 * Duas peças, ambas com `AsyncLocalStorage` (só no servidor; o SDK roda também no aparelho e não importa `node:*`):
 * - `dentroDaTransacao(dono, db, tenant, fn)`: marca que `fn` roda com a transação `db` aberta, para o `dono` (o pool do
 *   `criarBancoApp` ou o `AcessoBanco` da API). `transacaoAberta(dono)` devolve a mais interna ainda aberta.
 * - `criarGuardaConexao(dono, opcoes)`: chamada ANTES de pedir conexão ao pool; acusa o pedido feito com uma transação do
 *   mesmo pool aberta na cadeia. Modo `erro` (padrão fora de produção: teste e desenvolvimento) lança
 *   `ErroConexaoNaTransacao`; `aviso` (padrão em produção) só avisa, uma vez por ponto de chamada; `desligado` não olha.
 *   Variável `MACUXI_GUARDA_CONEXAO=erro|aviso|desligado`.
 *
 * A marca termina com a transação (`aberta = false` no `finally`): promessa solta que continue depois do commit não é acusada.
 */
import { AsyncLocalStorage } from 'node:async_hooks';
import type { ClienteBanco } from '@macuxi/platform-sdk';

export interface TransacaoAberta {
  /** Quem abriu: o pool (guarda) ou o `AcessoBanco` da API (reuso da conexão). */
  readonly dono: object;
  readonly db: ClienteBanco;
  /** Tenant da transação (`comTenant`); `null` = `semTenant`. */
  readonly tenantId: string | null;
  aberta: boolean;
  readonly anterior: TransacaoAberta | undefined;
}

const corrente = new AsyncLocalStorage<TransacaoAberta>();

/** Roda `fn` marcada como dentro da transação `db` do `dono`. A marca vale só enquanto `fn` não termina. */
export function dentroDaTransacao<T>(dono: object, db: ClienteBanco, tenantId: string | null, fn: () => Promise<T>): Promise<T> {
  const t: TransacaoAberta = { dono, db, tenantId, aberta: true, anterior: corrente.getStore() };
  return corrente.run(t, async () => {
    try {
      return await fn();
    } finally {
      t.aberta = false;
    }
  });
}

/** Transação do `dono` ainda aberta nesta cadeia assíncrona (a mais interna), ou `undefined`. */
export function transacaoAberta(dono: object): TransacaoAberta | undefined {
  for (let t = corrente.getStore(); t; t = t.anterior) if (t.aberta && t.dono === dono) return t;
  return undefined;
}

export type ModoGuardaConexao = 'erro' | 'aviso' | 'desligado';

/** `MACUXI_GUARDA_CONEXAO`; ausente ou inválida = `aviso` em produção (`NODE_ENV=production`) e `erro` no resto. */
export function modoGuardaConexao(env: Readonly<Record<string, string | undefined>> = process.env): ModoGuardaConexao {
  const v = env.MACUXI_GUARDA_CONEXAO?.trim().toLowerCase();
  if (v === 'erro' || v === 'aviso' || v === 'desligado') return v;
  return env.NODE_ENV === 'production' ? 'aviso' : 'erro';
}

export const CODIGO_CONEXAO_NA_TRANSACAO = 'MACUXI_CONEXAO_NA_TRANSACAO';

export class ErroConexaoNaTransacao extends Error {
  readonly codigo = CODIGO_CONEXAO_NA_TRANSACAO;
  constructor(onde: string) {
    super(
      `${onde}: pedido de outra conexão do pool com uma transação do mesmo pool aberta (D-T0107a, T-0118). Com requisições ` +
        'simultâneas >= pool, a API trava. Use o `db` da transação corrente ou faça a leitura antes de abrir a transação.',
    );
    this.name = 'ErroConexaoNaTransacao';
  }
}

export interface OpcoesGuardaConexao {
  /** Padrão: `modoGuardaConexao()`. */
  modo?: ModoGuardaConexao;
  /** Destino do modo `aviso` (padrão: `process.emitWarning`). Recebe o erro com a pilha de quem pediu a conexão. */
  avisar?: (e: ErroConexaoNaTransacao) => void;
}

/** Teto de pontos de chamada distintos lembrados no modo `aviso` (cada ponto avisa uma vez por processo). */
const MAX_PONTOS_AVISADOS = 200;

/** Guarda do `dono` (o pool): chame antes de cada `pool.connect()`/`pool.query()`. */
export function criarGuardaConexao(dono: object, opcoes: OpcoesGuardaConexao = {}): (onde: string) => void {
  const modo = opcoes.modo ?? modoGuardaConexao();
  const avisar = opcoes.avisar ?? ((e: ErroConexaoNaTransacao) => process.emitWarning(e.message, { code: CODIGO_CONEXAO_NA_TRANSACAO, detail: e.stack }));
  const avisados = new Set<string>();
  return (onde) => {
    if (modo === 'desligado' || !transacaoAberta(dono)) return;
    const e = new ErroConexaoNaTransacao(onde);
    if (modo === 'erro') throw e;
    const ponto = e.stack ?? onde;
    if (avisados.has(ponto) || avisados.size >= MAX_PONTOS_AVISADOS) return;
    avisados.add(ponto);
    avisar(e);
  };
}
