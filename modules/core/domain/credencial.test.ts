import { describe, expect, it } from 'vitest';
import { decidirCredencial } from './credencial';

const agora = new Date('2026-11-15T12:00:00Z');
const ok = { ativo: true, excluido: false, bloqueadoEm: null, bloqueioAte: null };

describe('RN-INT-16 e RN-CORE-15: conferência de credencial do autorizador', () => {
  it('RN-INT-16: usuário ativo com a senha certa = ok', () => expect(decidirCredencial({ usuario: ok, senhaConfere: true, permitido: true, agora })).toBe('ok'));
  it('RN-INT-16: senha errada = incorreta', () => expect(decidirCredencial({ usuario: ok, senhaConfere: false, permitido: true, agora })).toBe('incorreta'));
  it('RN-CORE-15: usuário inexistente = incorreta (não revela quem existe)', () => expect(decidirCredencial({ usuario: null, senhaConfere: false, permitido: true, agora })).toBe('incorreta'));
  it('RN-CORE-15: inativo, excluído ou bloqueado com a senha certa = bloqueado', () => {
    for (const u of [{ ...ok, ativo: false }, { ...ok, excluido: true }, { ...ok, bloqueadoEm: agora }, { ...ok, bloqueioAte: new Date('2026-11-15T12:10:00Z') }]) expect(decidirCredencial({ usuario: u, senhaConfere: true, permitido: true, agora })).toBe('bloqueado');
  });
  it('RN-CORE-15: bloqueado com senha errada = incorreta (só quem acertou a senha vê o bloqueio)', () => expect(decidirCredencial({ usuario: { ...ok, ativo: false }, senhaConfere: false, permitido: true, agora })).toBe('incorreta'));
  it('RN-CORE-15: bloqueio por tentativas já vencido não bloqueia', () => expect(decidirCredencial({ usuario: { ...ok, bloqueioAte: new Date('2026-11-15T11:00:00Z') }, senhaConfere: true, permitido: true, agora })).toBe('ok'));
  it('RN-CORE-35: senha certa, conta ativa e sem a permissão efetiva = sem_permissao', () => expect(decidirCredencial({ usuario: ok, senhaConfere: true, permitido: false, agora })).toBe('sem_permissao'));
  it('RN-CORE-15: sem a permissão, senha errada = incorreta e bloqueado = bloqueado (sem_permissao só a quem acertou a senha e está ativo)', () => {
    expect(decidirCredencial({ usuario: ok, senhaConfere: false, permitido: false, agora })).toBe('incorreta');
    expect(decidirCredencial({ usuario: { ...ok, ativo: false }, senhaConfere: true, permitido: false, agora })).toBe('bloqueado');
  });
});
