/**
 * Nome do banco do usuário no aparelho (desenho T-0088 §1.1): um arquivo por usuário e tenant; id fora do formato de
 * UUID não vira nome de arquivo (a sessão fica no AsyncStorage).
 */
import { describe, expect, it } from 'vitest';
import { ARQUIVO_DE_USUARIO_RE, arquivoDoUsuario, bancosDeUsuario } from './arquivo';

const U = '0a1b2c3d-0000-4000-8000-000000000001';
const T = '7f000000-0000-4000-8000-0000000000aa';

describe('arquivo do usuário (T-0088 §1.1)', () => {
  it('usuário e tenant no nome; sem tenant = demo; maiúsculas viram minúsculas', () => {
    expect(arquivoDoUsuario({ usuarioId: U, tenantId: T })).toBe(`macuxi-u-${U}-t-${T}.db`);
    expect(arquivoDoUsuario({ usuarioId: U })).toBe(`macuxi-u-${U}-t-demo.db`);
    expect(arquivoDoUsuario({ usuarioId: U, tenantId: null })).toBe(`macuxi-u-${U}-t-demo.db`);
    expect(arquivoDoUsuario({ usuarioId: U.toUpperCase(), tenantId: T.toUpperCase() })).toBe(`macuxi-u-${U}-t-${T}.db`);
    // o mesmo usuário em outro tenant (base recriada) cai em outro arquivo
    expect(arquivoDoUsuario({ usuarioId: U, tenantId: T })).not.toBe(arquivoDoUsuario({ usuarioId: U, tenantId: U }));
  });

  it.each([
    ['../../etc/passwd', T],
    [`${U}.db`, T],
    ['u1', T],
    [U, '../x'],
    [U, 'demo2'],
    ['', T],
    [`${U}/x`, T],
  ])('recusa id hostil ou fora do formato (%s / %s)', (usuarioId, tenantId) => {
    expect(arquivoDoUsuario({ usuarioId, tenantId })).toBeNull();
  });

  it('a regex casa o banco e os anexos do WAL e nada mais; bancosDeUsuario tira repetição e anexos', () => {
    const db = arquivoDoUsuario({ usuarioId: U, tenantId: T })!;
    for (const n of [db, `${db}-wal`, `${db}-shm`, `${db}-journal`, `macuxi-u-${U}-t-demo.db`]) expect(ARQUIVO_DE_USUARIO_RE.test(n)).toBe(true);
    for (const n of ['macuxi-diagnostico-carga.db', `macuxi-u-${U}.db`, `x${db}`, `${db}.bak`, `macuxi-u-${U}-t-demo2.db`])
      expect(ARQUIVO_DE_USUARIO_RE.test(n)).toBe(false);
    expect(bancosDeUsuario([`${db}-wal`, db, `${db}-shm`, 'macuxi-diagnostico-carga.db', `macuxi-u-${U}-t-demo.db`])).toEqual(
      [db, `macuxi-u-${U}-t-demo.db`].sort(),
    );
  });
});
