/**
 * Conferência da senha do autorizador do reprocessamento de lote (T-0173, RN-INT-16): o módulo de integração recebe esta porta em
 * `criarModuloApiIntegracao({ verificarSenha })` e ela chama `core.credencial_conferir@1` pela `tx.consultar` (mesma transação,
 * tenant e RLS; o tenant vem do contexto), com a ação que a senha autoriza (o Core confere a permissão efetiva do usuário).
 * `bloqueado` e `sem_permissao` respondem `incorreta`: não revelam o estado da conta nem a permissão e contam como tentativa
 * (decisão do gerente, T-0173). Qualquer erro da consulta vira `indisponivel` (503 na rota) e não é registrado aqui, para a senha
 * nunca chegar a log.
 */
import { CONSULTA_CREDENCIAL_CONFERIR } from '@macuxi/core/contracts';
import type { VerificadorSenha } from '@macuxi/integracao/api';

export const verificarSenhaAutorizador: VerificadorSenha = async ({ usuario_id, senha, acao }, tx) => {
  try {
    const { resultado } = await tx.consultar(CONSULTA_CREDENCIAL_CONFERIR, { usuario_id, senha, acao });
    return resultado === 'ok' ? 'ok' : 'incorreta';
  } catch {
    return 'indisponivel';
  }
};
