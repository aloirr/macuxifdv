/**
 * T-0003 — autenticação pela API real (Core + createApp + Postgres como macuxi_app): cenários S0-070..S0-073 do plano.
 * Login com código da empresa + e-mail + senha (RF-CORE-01), mesma resposta para qualquer credencial errada,
 * bloqueio por tentativas e remoto, aparelho bloqueado, limite por IP + código, refresh rotativo com revogação da
 * família no reuso, JWT adulterado/expirado e logs sem dado pessoal (CLAUDE.md regra 8).
 */
import { createHmac } from 'node:crypto';
import { RefreshRespostaSchema } from '@macuxi/core/contracts';
import { semBanco } from '@macuxi/db/teste/estado';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { A, B, erroDe, ids, novoIp, SEGREDO_JWT, SENHA, subirApi, type ApiDeTeste } from '../apoio/api';

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** JWT HS256 montado à mão (independente do código do Core). */
function jwt(payload: Record<string, unknown>, segredo = SEGREDO_JWT, alg = 'HS256'): string {
  const corpo = `${b64({ alg, typ: 'JWT' })}.${b64(payload)}`;
  const assinatura = alg === 'none' ? '' : createHmac('sha256', segredo).update(corpo).digest('base64url');
  return `${corpo}.${assinatura}`;
}
const agoraS = () => Math.floor(Date.now() / 1000);

describe.skipIf(semBanco())('T-0003 — login, sessão e bloqueio pela API real (Postgres)', () => {
  let api: ApiDeTeste;

  beforeAll(async () => {
    api = await subirApi();
  });
  afterAll(async () => {
    await api?.fechar();
  });

  it('S0-070: login com código da empresa devolve acesso de 15 min + refresh, usuário e tenant (nome e fuso só depois da senha)', async () => {
    const r = await api.entrar('gerente@exemplo.com.br');
    expect(r.statusCode, r.body).toBe(200);
    const s = r.json();
    expect(s).toMatchObject({ token_type: 'Bearer', expires_in: 900, usuario: { perfil: 'gerente', id: A.usuarios.gerente }, tenant: { id: A.tenantId, codigo: 'alfa', nome: 'Distribuidora Alfa', fuso: 'America/Manaus' } });
    const claims = JSON.parse(Buffer.from(s.access_token.split('.')[1], 'base64url').toString()) as { iat: number; exp: number };
    expect(claims.exp - claims.iat).toBe(900);
    expect(s.refresh_token.startsWith(`${A.tenantId}.`)).toBe(true);
  });

  it('S0-070: código da empresa errado, e-mail inexistente e senha errada dão EXATAMENTE a mesma resposta (sem enumeração)', async () => {
    const respostas = await Promise.all([
      api.entrar('gerente@exemplo.com.br', { senha: 'senha-errada' }),
      api.entrar('ninguem@exemplo.com.br'),
      api.entrar('gerente@exemplo.com.br', { tenant: { ...A, codigo: 'nao-existe' } as never }),
      api.entrar('admin.b@exemplo.com.br'), // e-mail de outro tenant com o código de A
    ]);
    const corpos = respostas.map((r) => ({ status: r.statusCode, corpo: r.json() }));
    for (const c of corpos) expect(c).toEqual(corpos[0]);
    expect(corpos[0]!.status).toBe(401);
    expect(corpos[0]!.corpo.codigo).toBe('CREDENCIAIS_INVALIDAS');
    for (const r of respostas) expect(r.body).not.toMatch(/Alfa|Beta|Manaus|Sao_Paulo/);
  });

  it('S0-072: o mesmo e-mail em A e B — o código da empresa decide o tenant e o token nunca mistura', async () => {
    const sa = await api.sessao('vendedor@exemplo.com.br', A);
    const sb = await api.sessao('vendedor@exemplo.com.br', B);
    expect([sa.tenant.id, sa.usuario.id]).toEqual([A.tenantId, A.usuarios.vendedor1]);
    expect([sb.tenant.id, sb.usuario.id]).toEqual([B.tenantId, B.usuarios.vendedor]);
    const pa = await api.chamar(sa.access_token, { method: 'GET', url: '/v1/sync/pull?entidade=cliente' });
    const pb = await api.chamar(sb.access_token, { method: 'GET', url: '/v1/sync/pull?entidade=cliente' });
    expect(pa.statusCode).toBe(200);
    expect(pb.statusCode).toBe(200);
    // o horizonte do pull pode ainda não ter passado da fixture: o que vier, vem só do próprio tenant
    for (const l of pa.json().itens as { id: string }[]) expect(l.id.startsWith('aaaaaaaa')).toBe(true);
    for (const l of pb.json().itens as { id: string }[]) expect(l.id.startsWith('bbbbbbbb')).toBe(true);
  });

  it('bloqueio por tentativas: 5 senhas erradas bloqueiam; senha certa depois → 423; senha errada no bloqueio continua 401', async () => {
    const email = 'assistente@exemplo.com.br';
    for (let i = 0; i < 5; i++) expect((await api.entrar(email, { senha: `errada-${i}` })).statusCode).toBe(401);
    const certa = await api.entrar(email);
    expect([certa.statusCode, erroDe(certa).codigo]).toEqual([423, 'USUARIO_BLOQUEADO']);
    const errada = await api.entrar(email, { senha: 'errada-de-novo' });
    expect([errada.statusCode, erroDe(errada).codigo]).toEqual([401, 'CREDENCIAIS_INVALIDAS']);
    const c = await api.admin.connect();
    try {
      const u = await c.query('select tentativas_falhas, bloqueio_ate > now() as bloqueado from core.usuario where id = $1', [A.usuarios.assistente]);
      expect(u.rows[0]).toMatchObject({ bloqueado: true });
      await c.query('update core.usuario set tentativas_falhas = 0, bloqueio_ate = null where id = $1', [A.usuarios.assistente]);
    } finally {
      c.release();
    }
    expect((await api.entrar(email)).statusCode).toBe(200);
  });

  it('limite por IP + código da empresa: a 6ª tentativa em 5 min → 429 MUITAS_TENTATIVAS com Retry-After; outro IP segue', async () => {
    const ip = novoIp();
    // e-mail inexistente: o limite é da plataforma (IP + código), não conta tentativa de nenhum usuário
    for (let i = 0; i < 5; i++) expect((await api.entrar('ninguem@exemplo.com.br', { ip, senha: 'x' })).statusCode).toBe(401);
    const r = await api.entrar('analista@exemplo.com.br', { ip });
    expect([r.statusCode, erroDe(r).codigo]).toEqual([429, 'MUITAS_TENTATIVAS']);
    expect(Number(r.headers['retry-after'])).toBeGreaterThan(0);
    expect((await api.entrar('analista@exemplo.com.br')).statusCode).toBe(200);
  });

  it('bloqueio remoto (RF-CORE-01): bloquear o usuário derruba o acesso já emitido (401) e o refresh (SESSAO_INVALIDA)', async () => {
    const s = await api.sessao('supervisor@exemplo.com.br');
    expect((await api.meusModulos(s.access_token)).modulos.length).toBeGreaterThan(0);
    const c = await api.admin.connect();
    try {
      await c.query('update core.usuario set bloqueado_em = now() where id = $1', [A.usuarios.supervisor]);
      const r = await api.chamar(s.access_token, { method: 'GET', url: '/v1/me/modulos' });
      expect([r.statusCode, erroDe(r).codigo]).toEqual([401, 'NAO_AUTENTICADO']);
      const rf = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
      expect([rf.statusCode, erroDe(rf).codigo]).toEqual([401, 'SESSAO_INVALIDA']);
      const login = await api.entrar('supervisor@exemplo.com.br');
      expect([login.statusCode, erroDe(login).codigo]).toEqual([423, 'USUARIO_BLOQUEADO']);
    } finally {
      await c.query('update core.usuario set bloqueado_em = null where id = $1', [A.usuarios.supervisor]);
      c.release();
    }
  });

  it('aparelho bloqueado: login do promotor pelo aparelho bloqueado → 423; por outro aparelho → 200', async () => {
    const r = await api.entrar('promotor@exemplo.com.br', { dispositivo_id: A.dispositivos.promotorBloqueado });
    expect([r.statusCode, erroDe(r).codigo]).toEqual([423, 'USUARIO_BLOQUEADO']);
    expect((await api.entrar('promotor@exemplo.com.br', { dispositivo_id: '0d000000-0000-4000-8000-0000000000f1' })).statusCode).toBe(200);
  });

  it('aparelho de OUTRO tenant (id do aparelho do vendedor de B no login de A) → 403 DISPOSITIVO_INVALIDO, nunca 500', async () => {
    const r = await api.entrar('vendedor@exemplo.com.br', { tenant: A, dispositivo_id: B.dispositivos.vendedor });
    expect([r.statusCode, erroDe(r).codigo]).toEqual([403, 'DISPOSITIVO_INVALIDO']);
    expect(r.body).not.toMatch(/Beta|bbbbbbbb/);
  });

  it('S0-071: refresh rotativo — par novo a cada troca; reuso do antigo → 401 e a FAMÍLIA inteira cai (até o refresh novo)', async () => {
    const s = await api.sessao('gerente@exemplo.com.br');
    const r1 = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
    expect(r1.statusCode, r1.body).toBe(200);
    const novo = RefreshRespostaSchema.parse(r1.json());
    expect(novo.refresh_token).not.toBe(s.refresh_token);
    const reuso = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
    expect([reuso.statusCode, erroDe(reuso).codigo]).toEqual([401, 'SESSAO_INVALIDA']);
    const depois = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: novo.refresh_token } });
    expect([depois.statusCode, erroDe(depois).codigo]).toEqual([401, 'SESSAO_INVALIDA']);
  });

  it('refresh: lixo, segredo de A com o prefixo de B e refresh após logout → 401 SESSAO_INVALIDA; logout responde igual sempre', async () => {
    const s = await api.sessao('analista@exemplo.com.br');
    const segredo = s.refresh_token.slice(s.refresh_token.indexOf('.') + 1);
    for (const token of ['lixo-sem-tenant-'.padEnd(60, 'x'), `${B.tenantId}.${segredo}`, `${A.tenantId}.outro-segredo`]) {
      const r = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: token } });
      expect([r.statusCode, erroDe(r).codigo], token).toEqual([401, 'SESSAO_INVALIDA']);
    }
    const sair = await api.app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { refresh_token: s.refresh_token } });
    const sairDeNovo = await api.app.inject({ method: 'POST', url: '/v1/auth/logout', payload: { refresh_token: s.refresh_token } });
    expect([sair.statusCode, sair.body]).toEqual([sairDeNovo.statusCode, sairDeNovo.body]);
    const r = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
    expect(r.statusCode).toBe(401);
  });

  it('S0-071: JWT expirado, com alg none, assinado com outro segredo ou com o perfil adulterado → 401', async () => {
    const base = { sub: A.usuarios.vendedor1, tid: A.tenantId, perfil: 'vendedor', iat: agoraS() - 60 };
    const valido = jwt({ ...base, exp: agoraS() + 600 });
    expect((await api.chamar(valido, { method: 'GET', url: '/v1/me/modulos' })).statusCode).toBe(200); // controle
    const ruins = {
      expirado: jwt({ ...base, iat: agoraS() - 2000, exp: agoraS() - 1 }),
      none: jwt({ ...base, exp: agoraS() + 600 }, SEGREDO_JWT, 'none'),
      outroSegredo: jwt({ ...base, exp: agoraS() + 600 }, 'outro-segredo-com-mais-de-32-caracteres-aqui'),
      adulterado: `${valido.split('.')[0]}.${b64({ ...base, perfil: 'admin', exp: agoraS() + 600 })}.${valido.split('.')[2]}`,
      outroTenant: jwt({ ...base, tid: B.tenantId, exp: agoraS() + 600 }),
    };
    for (const [k, t] of Object.entries(ruins)) {
      const r = await api.chamar(t, { method: 'GET', url: '/v1/me/modulos' });
      expect([r.statusCode, erroDe(r).codigo], k).toEqual([401, 'NAO_AUTENTICADO']);
    }
  });

  it('o perfil vale do BANCO na hora (troca de perfil não espera o token expirar)', async () => {
    const s = await api.sessao('vendedor2@exemplo.com.br');
    expect(ids(await api.meusModulos(s.access_token))).toContain('vendedor');
    const c = await api.admin.connect();
    try {
      await c.query("update core.usuario set perfil = 'promotor' where id = $1", [A.usuarios.vendedor2]);
      const r = await api.chamar(s.access_token, { method: 'POST', url: '/v1/vendedor/pedidos/x/cancelar', payload: {} });
      expect(r.statusCode).toBe(403);
    } finally {
      await c.query("update core.usuario set perfil = 'vendedor' where id = $1", [A.usuarios.vendedor2]);
      c.release();
    }
  });
});

describe.skipIf(semBanco())('S0-073 — logs sem dado pessoal (regra 8), com o logger em trace', () => {
  for (const variante of ['serializadores do servidor.ts', 'serializadores padrão do Fastify'] as const) {
    it(`nenhum e-mail, senha, token ou refresh nos logs (${variante})`, async () => {
      const linhas: string[] = [];
      const stream = { write: (s: string) => void linhas.push(s) };
      const serializers =
        variante === 'serializadores do servidor.ts'
          ? {
              req: (req: { method: string; url: string; id: string }) => ({ method: req.method, url: req.url.split('?')[0], request_id: req.id }),
              res: (res: { statusCode: number }) => ({ status: res.statusCode }),
            }
          : undefined;
      const api = await subirApi({ logger: { level: 'trace', stream, ...(serializers ? { serializers } : {}) } });
      try {
        const segredos: string[] = [SENHA, 'senha-errada-123', 'gerente@exemplo.com.br', 'vendedor@exemplo.com.br'];
        const s = await api.sessao('gerente@exemplo.com.br');
        segredos.push(s.access_token, s.refresh_token, s.refresh_token.split('.')[1]!);
        await api.entrar('gerente@exemplo.com.br', { senha: 'senha-errada-123' });
        await api.entrar('vendedor@exemplo.com.br', { tenant: B });
        await api.meusModulos(s.access_token);
        await api.chamar(s.access_token, { method: 'GET', url: '/v1/sync/pull?entidade=cliente' });
        await api.chamar(s.access_token, { method: 'POST', url: '/v1/vendedor/pedidos/x/cancelar', payload: { motivo: 'gerente@exemplo.com.br' } });
        const rf = await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } });
        segredos.push((rf.json() as { access_token: string; refresh_token: string }).access_token, (rf.json() as { refresh_token: string }).refresh_token);
        await api.app.inject({ method: 'POST', url: '/v1/auth/refresh', payload: { refresh_token: s.refresh_token } }); // reuso: log de aviso
        const tudo = linhas.join('');
        expect(linhas.length).toBeGreaterThan(5);
        for (const x of segredos) expect(tudo.includes(x), `vazou no log: ${x.slice(0, 12)}…`).toBe(false);
        expect(tudo).not.toMatch(/authorization|bearer/i);
        expect(tudo).toMatch(/"msg":"login"/);
      } finally {
        await api.fechar();
      }
      // cria o banco efêmero (migrações + fixture) DENTRO do teste: com a raiz inteira rodando em paralelo passa de 30 s
    }, 120_000);
  }
});
