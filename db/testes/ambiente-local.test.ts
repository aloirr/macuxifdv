/**
 * Senhas padrão e seed de demonstração só no Postgres local (revisão T-0002, 🟡 1; CLAUDE.md regra 8).
 * Estático: roda sempre, sem Postgres (clientes falsos que registram as consultas).
 */
import { describe, expect, it } from 'vitest';
import { carregarDemo } from '../seeds/demo/demo';
import { carregarFaseM } from '../seeds/fase-m/fase-m';
import {
  AMBIENTE_DEMO, ehBancoLocal, exigirBancoDemo, HOSTS_LOCAIS, lerConfig, lerConfigApp, SENHA_ADMIN_LOCAL, SENHA_APP_LOCAL, urlAdmin, urlApp, urlWorker,
} from '../src/config';
import { garantirPapelApp } from '../src/papeis';

/** Cliente pg falso: guarda as consultas; `host` como o pg.Client conectado expõe. */
function clienteFalso(host: string | undefined) {
  const consultas: string[] = [];
  const cliente = {
    host,
    consultas,
    escapeLiteral: (s: string) => `'${s.replace(/'/g, "''")}'`,
    query: async (sql: string) => {
      consultas.push(sql);
      return { rows: [], rowCount: sql.startsWith('select 1 from pg_roles') ? 1 : 0 };
    },
  };
  return cliente as typeof cliente & Parameters<typeof garantirPapelApp>[0];
}

const SENHAS = { MACUXI_PG_ADMIN_SENHA: 'admin-forte', MACUXI_PG_APP_SENHA: 'app-forte' };

describe('lerConfig: padrões locais só no Postgres local', () => {
  it('local sem variáveis usa os padrões do docker-compose', () => {
    const cfg = lerConfig({});
    expect(cfg).toMatchObject({ host: 'localhost', porta: 5432, adminUsuario: 'postgres', banco: 'macuxi' });
    expect(cfg.adminSenha).toBe(SENHA_ADMIN_LOCAL);
    expect(cfg.appSenha).toBe(SENHA_APP_LOCAL);
    for (const host of HOSTS_LOCAIS) expect(lerConfig({ MACUXI_PG_HOST: host }).appSenha).toBe(SENHA_APP_LOCAL);
  });

  it.each([
    ['sem as duas senhas', {}, /MACUXI_PG_ADMIN_SENHA e MACUXI_PG_APP_SENHA/],
    ['sem a senha do papel da API', { MACUXI_PG_ADMIN_SENHA: 'admin-forte' }, /defina MACUXI_PG_APP_SENHA no \.env/],
    ['sem a senha do admin', { MACUXI_PG_APP_SENHA: 'app-forte' }, /defina MACUXI_PG_ADMIN_SENHA no \.env/],
    ['com senha vazia', { MACUXI_PG_ADMIN_SENHA: 'admin-forte', MACUXI_PG_APP_SENHA: '' }, /MACUXI_PG_APP_SENHA/],
    ['com a senha pública do papel', { MACUXI_PG_ADMIN_SENHA: 'admin-forte', MACUXI_PG_APP_SENHA: SENHA_APP_LOCAL }, /senha pública/],
    ['com a senha pública do admin', { MACUXI_PG_ADMIN_SENHA: SENHA_ADMIN_LOCAL, MACUXI_PG_APP_SENHA: 'app-forte' }, /senha pública/],
  ])('host não local %s: FALHA com mensagem clara', (_caso, senhas, erro) => {
    expect(() => lerConfig({ MACUXI_PG_HOST: 'db.exemplo.com.br', ...senhas })).toThrow(erro);
    expect(() => lerConfig({ MACUXI_PG_HOST: 'db.exemplo.com.br', ...senhas })).toThrow(/host db\.exemplo\.com\.br não é local/);
  });

  it('NODE_ENV=production falha sem senha mesmo com host local', () => {
    expect(() => lerConfig({ NODE_ENV: 'production' })).toThrow(/NODE_ENV=production.*MACUXI_PG_ADMIN_SENHA e MACUXI_PG_APP_SENHA/);
    expect(() => lerConfig({ NODE_ENV: 'production', MACUXI_PG_ADMIN_SENHA: 'a', MACUXI_PG_APP_SENHA: SENHA_APP_LOCAL })).toThrow(/senha pública/);
  });

  it('host não local com as duas senhas definidas funciona e nunca cai no padrão', () => {
    const cfg = lerConfig({ MACUXI_PG_HOST: 'db.exemplo.com.br', ...SENHAS });
    expect(cfg.adminSenha).toBe('admin-forte');
    expect(cfg.appSenha).toBe('app-forte');
  });

  it('ehBancoLocal: lista fechada de hosts, sem diferenciar maiúsculas; production nunca é local', () => {
    expect(ehBancoLocal('LOCALHOST', {})).toBe(true);
    expect(ehBancoLocal('macuxi-postgres', {})).toBe(true);
    expect(ehBancoLocal('localhost.exemplo.com', {})).toBe(false);
    expect(ehBancoLocal('10.0.0.5', {})).toBe(false);
    expect(ehBancoLocal(undefined, {})).toBe(false);
    expect(ehBancoLocal('localhost', { NODE_ENV: 'production' })).toBe(false);
  });
});

describe('garantirPapelApp: senha pública nunca vai para papel de banco não local', () => {
  it('recusa a senha pública com cliente conectado a host não local, sem tocar no banco', async () => {
    const c = clienteFalso('db.exemplo.com.br');
    await expect(garantirPapelApp(c, SENHA_APP_LOCAL)).rejects.toThrow(/fora do ambiente local/);
    expect(c.consultas).toEqual([]);
  });

  it('recusa a senha pública quando o host do cliente é desconhecido', async () => {
    const c = clienteFalso(undefined);
    await expect(garantirPapelApp(c, SENHA_APP_LOCAL)).rejects.toThrow(/host desconhecido/);
    expect(c.consultas).toEqual([]);
  });

  it('aceita senha própria em host não local e a senha pública no local', async () => {
    const remoto = clienteFalso('db.exemplo.com.br');
    await garantirPapelApp(remoto, 'app-forte');
    expect(remoto.consultas.some((q) => q.startsWith('alter role macuxi_app'))).toBe(true);
    const local = clienteFalso('localhost');
    await garantirPapelApp(local, SENHA_APP_LOCAL);
    expect(local.consultas.some((q) => q.startsWith('alter role macuxi_app'))).toBe(true);
  });
});

describe('seed Fase M (senha demo-macuxi): só no Postgres local', () => {
  it.each(['db.exemplo.com.br', '10.0.0.5', undefined])('recusa host %s sem nenhuma consulta', async (host) => {
    const c = clienteFalso(host);
    await expect(carregarFaseM(c, { senha: 'x' })).rejects.toThrow(/Seed de demonstração da Fase M recusado/);
    expect(c.consultas).toEqual([]);
  });

  it('recusa com NODE_ENV=production mesmo em host local', async () => {
    const antes = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';
    try {
      const c = clienteFalso('localhost');
      await expect(carregarFaseM(c, { senha: 'x' })).rejects.toThrow(/NODE_ENV=production/);
      expect(c.consultas).toEqual([]);
    } finally {
      if (antes === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = antes;
    }
  });
});

describe('exigirBancoDemo: seed da demo num servidor só com MACUXI_AMBIENTE=demo (T-0074, ADR 0020 §5)', () => {
  it('aceita o Postgres local e o servidor marcado com MACUXI_AMBIENTE=demo, mesmo em production', () => {
    expect(() => exigirBancoDemo('localhost', 'Seed', {})).not.toThrow();
    expect(() => exigirBancoDemo('postgres', 'Seed', { MACUXI_AMBIENTE: AMBIENTE_DEMO })).not.toThrow();
    expect(() => exigirBancoDemo('postgres', 'Seed', { MACUXI_AMBIENTE: 'demo', NODE_ENV: 'production' })).not.toThrow();
  });

  it.each([{}, { MACUXI_AMBIENTE: 'DEMO' }, { MACUXI_AMBIENTE: 'demo ' }, { MACUXI_AMBIENTE: 'homologacao' }, { MACUXI_AMBIENTE: '' }])(
    'recusa servidor sem a marca exata (%o)',
    (env) => {
      expect(() => exigirBancoDemo('postgres', 'Seed da demo', { NODE_ENV: 'production', ...env })).toThrow(/Seed da demo recusado.*MACUXI_AMBIENTE=demo/);
    },
  );

  it('carregarDemo: sem a marca recusa sem consultar; com MACUXI_AMBIENTE=demo passa da trava (e cai na checagem das migrações)', async () => {
    const antes = { amb: process.env.MACUXI_AMBIENTE, node: process.env.NODE_ENV };
    try {
      process.env.NODE_ENV = 'production';
      delete process.env.MACUXI_AMBIENTE;
      const semMarca = clienteFalso('postgres');
      await expect(carregarDemo(semMarca, { senha: 'x' })).rejects.toThrow(/Seed da base de demonstração recusado/);
      expect(semMarca.consultas).toEqual([]);
      process.env.MACUXI_AMBIENTE = 'demo';
      const comMarca = clienteFalso('postgres');
      await expect(carregarDemo(comMarca, { senha: 'x' })).rejects.toThrow(/precisa das migrações/);
      expect(comMarca.consultas.length).toBeGreaterThan(0);
    } finally {
      if (antes.amb === undefined) delete process.env.MACUXI_AMBIENTE;
      else process.env.MACUXI_AMBIENTE = antes.amb;
      if (antes.node === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = antes.node;
    }
  });

  it('a marca não libera o seed da Fase M nem a senha pública dos papéis', async () => {
    const env = { MACUXI_AMBIENTE: 'demo', NODE_ENV: 'production' };
    expect(() => lerConfig({ ...env, MACUXI_PG_HOST: 'postgres', MACUXI_PG_ADMIN_SENHA: 'a', MACUXI_PG_APP_SENHA: SENHA_APP_LOCAL })).toThrow(/senha pública/);
    const antes = process.env.MACUXI_AMBIENTE;
    process.env.MACUXI_AMBIENTE = 'demo';
    try {
      const c = clienteFalso('db.exemplo.com.br');
      await expect(carregarFaseM(c, { senha: 'x' })).rejects.toThrow(/Seed de demonstração da Fase M recusado/);
      expect(c.consultas).toEqual([]);
    } finally {
      if (antes === undefined) delete process.env.MACUXI_AMBIENTE;
      else process.env.MACUXI_AMBIENTE = antes;
    }
  });
});

describe('lerConfigApp: API e worker sem a senha do admin (T-0074)', () => {
  const servidor = { NODE_ENV: 'production', MACUXI_PG_HOST: 'postgres', MACUXI_PG_APP_SENHA: 'app-forte', MACUXI_PG_WORKER_SENHA: 'worker-forte' };

  it('fora do local, sem MACUXI_PG_ADMIN_SENHA: urlApp e urlWorker funcionam, urlAdmin lança', () => {
    const cfg = lerConfigApp(servidor);
    expect(cfg.adminSenha).toBe('');
    expect(urlApp(cfg)).toBe('postgres://macuxi_app:app-forte@postgres:5432/macuxi');
    expect(urlWorker(cfg)).toBe('postgres://macuxi_worker:worker-forte@postgres:5432/macuxi');
    expect(() => urlAdmin(cfg)).toThrow(/MACUXI_PG_ADMIN_SENHA não definida/);
  });

  it('lerConfig (migrações, papéis, seeds) segue exigindo o admin', () => {
    expect(() => lerConfig(servidor)).toThrow(/defina MACUXI_PG_ADMIN_SENHA/);
  });

  it('mantém as travas: senha do papel obrigatória e senhas públicas recusadas', () => {
    expect(() => lerConfigApp({ ...servidor, MACUXI_PG_APP_SENHA: '' })).toThrow(/defina MACUXI_PG_APP_SENHA/);
    expect(() => lerConfigApp({ ...servidor, MACUXI_PG_APP_SENHA: SENHA_APP_LOCAL })).toThrow(/senha pública/);
    expect(() => lerConfigApp({ ...servidor, MACUXI_PG_ADMIN_SENHA: SENHA_ADMIN_LOCAL })).toThrow(/senha pública/);
  });

  it('no local continua igual ao lerConfig (padrões do docker-compose)', () => {
    expect(lerConfigApp({})).toEqual(lerConfig({}));
    expect(urlAdmin(lerConfigApp({}))).toContain('postgres:postgres@localhost:5432');
  });
});
