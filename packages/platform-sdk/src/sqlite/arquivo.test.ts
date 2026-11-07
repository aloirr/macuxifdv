/**
 * Nome do banco do usuário no aparelho (desenho T-0088 §1.1): um arquivo por usuário e tenant. UUID fica legível; qualquer
 * outro id (demonstração) vira `h` + hash, sem caractere perigoso e sem colisão entre usuários e tenants.
 */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { ARQUIVO_DE_USUARIO_RE, arquivoDoUsuario, bancosDeUsuario, segmentoDoId } from './arquivo';

const U = '0a1b2c3d-0000-4000-8000-000000000001';
const T = '7f000000-0000-4000-8000-0000000000aa';
const hashDe = (id: string) => `h${createHash('sha256').update(id, 'utf8').digest('hex').slice(0, 32)}`;

describe('arquivo do usuário (T-0088 §1.1)', () => {
  it('usuário e tenant no nome; sem tenant = demo; maiúsculas do UUID viram minúsculas', () => {
    expect(arquivoDoUsuario({ usuarioId: U, tenantId: T })).toBe(`macuxi-u-${U}-t-${T}.db`);
    expect(arquivoDoUsuario({ usuarioId: U })).toBe(`macuxi-u-${U}-t-demo.db`);
    expect(arquivoDoUsuario({ usuarioId: U, tenantId: null })).toBe(`macuxi-u-${U}-t-demo.db`);
    expect(arquivoDoUsuario({ usuarioId: U, tenantId: '  ' })).toBe(`macuxi-u-${U}-t-demo.db`);
    expect(arquivoDoUsuario({ usuarioId: U.toUpperCase(), tenantId: T.toUpperCase() })).toBe(`macuxi-u-${U}-t-${T}.db`);
    // o mesmo usuário em outro tenant (base recriada) cai em outro arquivo
    expect(arquivoDoUsuario({ usuarioId: U, tenantId: T })).not.toBe(arquivoDoUsuario({ usuarioId: U, tenantId: U }));
  });

  it('id fora do formato de UUID (demonstração) também abre o SQLite: vira h + 32 hex do SHA-256 do id exato', () => {
    expect(arquivoDoUsuario({ usuarioId: 'u-vend-01', tenantId: null })).toBe(`macuxi-u-${hashDe('u-vend-01')}-t-demo.db`);
    expect(arquivoDoUsuario({ usuarioId: 'u-vend-01', tenantId: 'tenant-demo' })).toBe(
      `macuxi-u-${hashDe('u-vend-01')}-t-${hashDe('tenant-demo')}.db`,
    );
    expect(arquivoDoUsuario({ usuarioId: 'u-vend-01', tenantId: T })).toBe(`macuxi-u-${hashDe('u-vend-01')}-t-${T}.db`);
  });

  it.each([
    '../../etc/passwd',
    `${U}.db`,
    `${U}/x`,
    'C:\\x\\y',
    'ação ç 漢字 😀',
    'a'.repeat(5000),
    ' u1 ',
    'demo',
    '\u0000\n\t',
    '\ud800',
  ])('id hostil ou estranho (%j) vira um nome seguro, que casa a regex', (id) => {
    for (const nome of [arquivoDoUsuario({ usuarioId: id, tenantId: T })!, arquivoDoUsuario({ usuarioId: U, tenantId: id })!]) {
      expect(nome).toMatch(/^macuxi-u-[0-9a-z-]+\.db$/);
      expect(nome.length).toBeLessThan(120);
      expect(ARQUIVO_DE_USUARIO_RE.test(nome)).toBe(true);
    }
    expect(segmentoDoId(id)).toBe(hashDe(id));
  });

  it('sem id de usuário (vazio ou só espaços) = null: a sessão fica na reserva', () => {
    expect(arquivoDoUsuario({ usuarioId: '' })).toBeNull();
    expect(arquivoDoUsuario({ usuarioId: '   ', tenantId: T })).toBeNull();
  });

  it('sem colisão: ids distintos dão nomes distintos (caixa, espaço, demo literal, hash × UUID, usuário × tenant)', () => {
    const ids = ['u1', 'U1', ' u1', 'u1 ', 'u-1', 'demo', 'Demo', 'h' + '0'.repeat(32), U, T, `${U} `, 'vendedor', 'gestor'];
    const tenants: (string | null)[] = [null, 'demo', 'tenant-a', 'tenant-b', T, U];
    const nomes = new Set<string>();
    let n = 0;
    for (const u of ids)
      for (const t of tenants) {
        nomes.add(arquivoDoUsuario({ usuarioId: u, tenantId: t })!);
        n++;
      }
    expect(nomes.size).toBe(n);
    // o tenant literal 'demo' não cai no arquivo da demonstração sem tenant
    expect(arquivoDoUsuario({ usuarioId: 'u1', tenantId: 'demo' })).not.toBe(arquivoDoUsuario({ usuarioId: 'u1' }));
    // a mesma entrada dá sempre o mesmo nome (reabre o mesmo arquivo depois do logout)
    expect(arquivoDoUsuario({ usuarioId: 'u1', tenantId: 'tenant-a' })).toBe(arquivoDoUsuario({ usuarioId: 'u1', tenantId: 'tenant-a' }));
  });

  it('SHA-256 puro confere com o node:crypto (vetores do FIPS 180-4 e textos com acento e emoji)', () => {
    expect(segmentoDoId('abc')).toBe('hba7816bf8f01cfea414140de5dae2223');
    expect(segmentoDoId('')).toBe('he3b0c44298fc1c149afbf4c8996fb924');
    for (const s of ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', 'x'.repeat(55), 'x'.repeat(56), 'x'.repeat(64), 'São Gonçalo 😀 漢'])
      expect(segmentoDoId(s)).toBe(hashDe(s));
  });

  it('a regex casa o banco e os anexos do WAL e nada mais; bancosDeUsuario tira repetição e anexos', () => {
    const db = arquivoDoUsuario({ usuarioId: U, tenantId: T })!;
    const demo = arquivoDoUsuario({ usuarioId: 'u-vend-01' })!;
    for (const n of [db, `${db}-wal`, `${db}-shm`, `${db}-journal`, `macuxi-u-${U}-t-demo.db`, demo, `${demo}-wal`])
      expect(ARQUIVO_DE_USUARIO_RE.test(n)).toBe(true);
    for (const n of [
      'macuxi-diagnostico-carga.db',
      `macuxi-u-${U}.db`,
      `x${db}`,
      `${db}.bak`,
      `macuxi-u-${U}-t-demo2.db`,
      `macuxi-u-u1-t-demo.db`,
      `macuxi-u-h${'0'.repeat(31)}-t-demo.db`,
      `macuxi-u-H${'0'.repeat(32)}-t-demo.db`,
    ])
      expect(ARQUIVO_DE_USUARIO_RE.test(n)).toBe(false);
    expect(bancosDeUsuario([`${db}-wal`, db, `${db}-shm`, 'macuxi-diagnostico-carga.db', `macuxi-u-${U}-t-demo.db`, `${demo}-wal`])).toEqual(
      [db, `macuxi-u-${U}-t-demo.db`, demo].sort(),
    );
  });
});
