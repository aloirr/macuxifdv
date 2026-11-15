/**
 * Conferência da senha do autorizador do reprocessamento de lote (T-0173, RN-INT-16): o módulo de integração recebe esta porta em
 * `criarModuloApiIntegracao({ verificarSenha })` e ela chama `core.credencial_conferir@1` pela `tx.consultar` (mesma transação,
 * tenant e RLS; o tenant vem do contexto). `bloqueado` responde `incorreta`: não revela o estado da conta e conta como tentativa
 * (decisão do gerente, T-0173). Qualquer erro da consulta vira `indisponivel` (503 na rota) e não é registrado aqui, para a senha
 * nunca chegar a log.
 */
import { CONSULTA_CREDENCIAL_CONFERIR } from '@macuxi/core/contracts';
import type { criarModuloApiIntegracao } from '@macuxi/integracao/api';

export type VerificadorSenhaAutorizador = NonNullable<Parameters<typeof criarModuloApiIntegracao>[0]['verificarSenha']>;

export const verificarSenhaAutorizador: VerificadorSenhaAutorizador = async ({ usuario_id, senha }, tx) => {
  try {
    const { resultado } = await tx.consultar(CONSULTA_CREDENCIAL_CONFERIR, { usuario_id, senha });
    return resultado === 'ok' ? 'ok' : 'incorreta';
  } catch {
    return 'indisponivel';
  }
};
