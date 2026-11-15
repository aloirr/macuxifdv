/**
 * Adaptador da senha do autorizador (T-0173, RN-INT-16): o Hub confere a senha pelo `core.credencial_conferir@1` (`tx.consultar`).
 * A ação que a senha autoriza vai junto (o Core confere a permissão efetiva). `bloqueado` e `sem_permissao` viram `incorreta` (não
 * revelam o estado da conta nem a permissão e contam como tentativa); erro da consulta vira `indisponivel` (503).
 */
import { CONSULTA_CREDENCIAL_CONFERIR } from '@macuxi/core/contracts';
import { ConsultaIndisponivel, type TransacaoTenant } from '@macuxi/platform-sdk';
import { describe, expect, it, vi } from 'vitest';
import { verificarSenhaAutorizador } from '../src/senha-autorizador';

const TENANT = '00000000-0000-4000-8000-000000000001';
const USUARIO = '00000000-0000-4000-8000-0000000000aa';
const ACAO = { modulo: 'integracao', acao: 'lote.reprocessar' };

function txQue(consultar: (...a: unknown[]) => Promise<unknown>) {
  const fn = vi.fn(consultar);
  return { tx: { consultar: fn } as unknown as TransacaoTenant, fn };
}

describe('verificarSenhaAutorizador (RN-INT-16)', () => {
  it('chama core.credencial_conferir@1 com usuario_id, senha e a ação (o tenant vem do contexto da transação)', async () => {
    const { tx, fn } = txQue(async () => ({ resultado: 'ok' }));
    await verificarSenhaAutorizador({ tenant_id: TENANT, usuario_id: USUARIO, senha: 's3nha', acao: ACAO }, tx);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn.mock.calls[0]?.[0]).toBe(CONSULTA_CREDENCIAL_CONFERIR);
    expect(fn.mock.calls[0]?.[1]).toEqual({ usuario_id: USUARIO, senha: 's3nha', acao: ACAO });
  });

  it.each([
    ['ok', 'ok'],
    ['incorreta', 'incorreta'],
    // decisão do gerente (T-0173): não revela o estado da conta; conta como tentativa
    ['bloqueado', 'incorreta'],
    ['sem_permissao', 'incorreta'],
  ] as const)('resultado %s do Core vira %s', async (doCore, esperado) => {
    const { tx } = txQue(async () => ({ resultado: doCore }));
    expect(await verificarSenhaAutorizador({ tenant_id: TENANT, usuario_id: USUARIO, senha: 'x', acao: ACAO }, tx)).toBe(esperado);
  });

  it('erro da consulta (Core inativo ou falha) vira indisponivel, sem propagar', async () => {
    const indisponivel = txQue(async () => {
      throw new ConsultaIndisponivel('core.credencial_conferir@1', 'core');
    });
    expect(await verificarSenhaAutorizador({ tenant_id: TENANT, usuario_id: USUARIO, senha: 'x', acao: ACAO }, indisponivel.tx)).toBe('indisponivel');
    const falha = txQue(async () => {
      throw new Error('conexão caiu');
    });
    expect(await verificarSenhaAutorizador({ tenant_id: TENANT, usuario_id: USUARIO, senha: 'x', acao: ACAO }, falha.tx)).toBe('indisponivel');
  });
});
