/**
 * Comando `pnpm super-admin` (T-0093; ADR 0031; premissa P3; desenho docs/desenho/T-0093.md §7) com banco FALSO: a função
 * `plataforma.criar_super_admin` é do banco-dados (0039) e o teste dela roda no CI com Postgres.
 * Aqui: senha nunca em argumento nem na saída, variável apagada do ambiente, RN-CORE-32 pela política do Core, `--simular`,
 * trava fora do local, `nao_encontrado` = saída 1 e o desativar sem senha.
 */
import { describe, expect, it } from 'vitest';
import {
  executarSuperAdmin,
  POLITICA_SUPER_ADMIN_DO_CORE,
  VAR_SENHA_SUPER_ADMIN,
  type BancoSuperAdmin,
  type DepsSuperAdmin,
  type EntradaCriarSuperAdmin,
} from '../src/cli/super-admin';

const SENHA = 'Macuxi#2026xyz';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsLWZhbHNv$dGFnLWZhbHNhLWRvLXRlc3Rl';
const EMAIL = 'Fulana.Time@MacuxiFDV.com.br';
const NOME = 'Fulana do Time';
const SA_ID = '5a000000-0000-4000-8000-000000000001';

interface Cenario {
  deps: DepsSuperAdmin;
  env: NodeJS.ProcessEnv;
  saida: string[];
  erro: string[];
  chamadas: { entrada: EntradaCriarSuperAdmin; simular: boolean }[];
  abriu: () => number;
  fechou: () => number;
}

function cenario(o: { env?: NodeJS.ProcessEnv; local?: boolean; resposta?: unknown; falha?: unknown; tty?: string[] | null; politica?: DepsSuperAdmin['politica'] } = {}): Cenario {
  const saida: string[] = [];
  const erro: string[] = [];
  const chamadas: Cenario['chamadas'] = [];
  let abriu = 0;
  let fechou = 0;
  const digitadas = o.tty === undefined ? null : o.tty;
  const banco: BancoSuperAdmin = {
    local: o.local ?? true,
    async executar(entrada, { simular }) {
      chamadas.push({ entrada, simular });
      if (o.falha) throw o.falha;
      return o.resposta ?? { resultado: entrada.acao === 'criar' ? 'criado' : entrada.acao === 'redefinir' ? 'redefinido' : 'desativado', super_admin_id: SA_ID, sessoes_revogadas: entrada.acao === 'criar' ? 0 : 2 };
    },
    async fechar() {
      fechou++;
    },
  };
  const env = o.env ?? { [VAR_SENHA_SUPER_ADMIN]: SENHA };
  const deps: DepsSuperAdmin = {
    env,
    politica: o.politica ?? {
      normalizarEmail: (e) => e.trim().toLowerCase(),
      validarSenhaInicial: (s, e) => (!/[^\p{L}\p{N}\s]/u.test(s) ? 'Falta um caractere especial.' : s.toLowerCase() === e ? 'A senha não pode ser igual ao e-mail.' : null),
      hashSenha: (s) => (s === SENHA ? HASH : `$argon2id$v=19$m=1,t=1,p=1$x$${s.length}`),
    },
    lerSenhaOculta: digitadas ? async () => digitadas.shift() ?? '' : null,
    abrirBanco: async () => {
      abriu++;
      return banco;
    },
    saida: (l) => saida.push(l),
    erro: (l) => erro.push(l),
  };
  return { deps, env, saida, erro, chamadas, abriu: () => abriu, fechou: () => fechou };
}

const CRIAR = ['criar', '--email', EMAIL, '--nome', NOME];
/** Nada de senha, hash, nome nem e-mail em claro em nenhuma linha que o comando escreveu. */
const semSegredo = (c: Cenario, extra: string[] = []) => {
  const tudo = [...c.saida, ...c.erro].join('\n');
  for (const s of [SENHA, HASH, NOME, EMAIL, EMAIL.toLowerCase(), ...extra]) expect(tudo).not.toContain(s);
};

describe('pnpm super-admin (T-0093, P3)', () => {
  it('criar: e-mail normalizado, só o hash ao banco, saída de uma linha JSON com o e-mail mascarado; variável apagada', async () => {
    const c = cenario();
    expect(await executarSuperAdmin(CRIAR, c.deps)).toBe(0);
    expect(c.chamadas).toEqual([{ entrada: { acao: 'criar', email: EMAIL.toLowerCase(), nome: NOME, senha_hash: HASH }, simular: false }]);
    expect(c.env[VAR_SENHA_SUPER_ADMIN]).toBeUndefined();
    expect(c.saida).toHaveLength(1);
    expect(JSON.parse(c.saida[0]!)).toEqual({ acao: 'criar', resultado: 'criado', super_admin_id: SA_ID, email: 'f***@macuxifdv.com.br', sessoes_revogadas: 0 });
    expect(c.fechou()).toBe(1);
    semSegredo(c);
  });

  it('senha nunca em argumento: --senha, --senha=..., --password e --senha-hash recusados antes de tudo, sem repetir o valor', async () => {
    for (const extra of [['--senha', 'Valor#123x'], ['--senha=Valor#123x'], ['--password', 'Valor#123x'], ['--senha-hash', 'Valor#123x']]) {
      const c = cenario();
      expect(await executarSuperAdmin([...CRIAR, ...extra], c.deps)).toBe(1);
      expect(c.erro.join('\n')).toMatch(/nunca vai em argumento/);
      expect(c.abriu()).toBe(0);
      // mesmo no erro de uso, a variável sai do ambiente
      expect(c.env[VAR_SENHA_SUPER_ADMIN]).toBeUndefined();
      semSegredo(c, ['Valor#123x']);
    }
  });

  it('argumento solto ou opção desconhecida: erro sem repetir o valor (pode ser uma senha)', async () => {
    const c = cenario();
    expect(await executarSuperAdmin([...CRIAR, 'Solta#123x'], c.deps)).toBe(1);
    const d = cenario();
    expect(await executarSuperAdmin([...CRIAR, '--x', 'Solta#123x'], d.deps)).toBe(1);
    for (const x of [c, d]) {
      expect(x.erro.join('\n')).not.toContain('Solta#123x');
      expect(x.abriu()).toBe(0);
    }
  });

  it('RN-CORE-32 pela política do Core: senha fraca recusada antes do banco, sem repetir a senha', async () => {
    const c = cenario({ env: { [VAR_SENHA_SUPER_ADMIN]: 'SemEspecial123' } });
    expect(await executarSuperAdmin(CRIAR, c.deps)).toBe(1);
    expect(c.erro.join('\n')).toMatch(/RN-CORE-32.*caractere especial/);
    expect(c.abriu()).toBe(0);
    semSegredo(c, ['SemEspecial123']);
  });

  it('a política real é a do Core (RN-CORE-32, hash argon2id)', async () => {
    expect(POLITICA_SUPER_ADMIN_DO_CORE.normalizarEmail('  Fulana@X.com.BR ')).toBe('fulana@x.com.br');
    expect(POLITICA_SUPER_ADMIN_DO_CORE.validarSenhaInicial('Macuxi2026', 'a@x.com')).toMatch(/caractere especial/);
    expect(POLITICA_SUPER_ADMIN_DO_CORE.validarSenhaInicial(SENHA, EMAIL)).toBeNull();
    expect(await POLITICA_SUPER_ADMIN_DO_CORE.hashSenha(SENHA)).toMatch(/^\$argon2id\$v=19\$/);
  });

  it('sem a variável: digitação oculta com confirmação; diferentes = erro; sem terminal = erro', async () => {
    const c = cenario({ env: {}, tty: [SENHA, SENHA] });
    expect(await executarSuperAdmin(CRIAR, c.deps)).toBe(0);
    expect(c.chamadas[0]!.entrada).toMatchObject({ senha_hash: HASH });
    const d = cenario({ env: {}, tty: [SENHA, `${SENHA}x`] });
    expect(await executarSuperAdmin(CRIAR, d.deps)).toBe(1);
    expect(d.erro.join('\n')).toMatch(/não conferem/);
    const e = cenario({ env: {} });
    expect(await executarSuperAdmin(CRIAR, e.deps)).toBe(1);
    expect(e.erro.join('\n')).toMatch(new RegExp(VAR_SENHA_SUPER_ADMIN));
  });

  it('redefinir: sem nome, com hash; desativar: sem senha nem nome (a variável é ignorada e apagada)', async () => {
    const r = cenario();
    expect(await executarSuperAdmin(['redefinir', '--email', EMAIL], r.deps)).toBe(0);
    expect(r.chamadas[0]!.entrada).toEqual({ acao: 'redefinir', email: EMAIL.toLowerCase(), senha_hash: HASH });
    expect(JSON.parse(r.saida[0]!)).toMatchObject({ resultado: 'redefinido', sessoes_revogadas: 2 });
    const d = cenario();
    expect(await executarSuperAdmin(['desativar', '--email', EMAIL], d.deps)).toBe(0);
    expect(d.chamadas[0]!.entrada).toEqual({ acao: 'desativar', email: EMAIL.toLowerCase() });
    expect(d.env[VAR_SENHA_SUPER_ADMIN]).toBeUndefined();
    // --nome fora do criar e criar sem nome: erro de uso
    expect(await executarSuperAdmin(['redefinir', '--email', EMAIL, '--nome', NOME], cenario().deps)).toBe(1);
    expect(await executarSuperAdmin(['criar', '--email', EMAIL], cenario().deps)).toBe(1);
  });

  it('nao_encontrado = saída 1 com a linha JSON; sem_mudanca = 0', async () => {
    const c = cenario({ resposta: { resultado: 'nao_encontrado', super_admin_id: null, sessoes_revogadas: 0 } });
    expect(await executarSuperAdmin(['redefinir', '--email', EMAIL], c.deps)).toBe(1);
    expect(JSON.parse(c.saida[0]!)).toMatchObject({ resultado: 'nao_encontrado' });
    expect(c.erro.join('\n')).toMatch(/use criar/);
    const s = cenario({ resposta: { resultado: 'sem_mudanca', super_admin_id: SA_ID, sessoes_revogadas: 0 } });
    expect(await executarSuperAdmin(CRIAR, s.deps)).toBe(0);
  });

  it('--simular repassa; fora do local exige --confirmar <email> (sem o e-mail na mensagem)', async () => {
    const s = cenario();
    expect(await executarSuperAdmin([...CRIAR, '--simular'], s.deps)).toBe(0);
    expect(s.chamadas[0]!.simular).toBe(true);
    expect(JSON.parse(s.saida[0]!).simulado).toBe(true);
    const f = cenario({ local: false });
    expect(await executarSuperAdmin(CRIAR, f.deps)).toBe(1);
    expect(f.chamadas).toEqual([]);
    expect(f.erro.join('\n')).toMatch(/--confirmar/);
    semSegredo(f);
    const ok = cenario({ local: false });
    expect(await executarSuperAdmin([...CRIAR, '--confirmar', EMAIL.toUpperCase()], ok.deps)).toBe(0);
  });

  it('erro do banco: só código e mensagem limpos (sem hash nem e-mail); resposta fora do formato = erro', async () => {
    const falha = Object.assign(new Error(`falhou com ${HASH} de ${EMAIL.toLowerCase()}`), { code: '22023', detail: `(${EMAIL}, ${HASH})` });
    const c = cenario({ falha });
    expect(await executarSuperAdmin(CRIAR, c.deps)).toBe(1);
    expect(c.erro.join('\n')).toMatch(/código 22023/);
    semSegredo(c);
    const p = cenario({ falha: Object.assign(new Error('x'), { code: '42501' }) });
    expect(await executarSuperAdmin(CRIAR, p.deps)).toBe(1);
    expect(p.erro.join('\n')).toMatch(/conexão de administração/);
    const r = cenario({ resposta: { ok: true } });
    expect(await executarSuperAdmin(CRIAR, r.deps)).toBe(1);
    expect(r.fechou()).toBe(1);
  });

  it('comando desconhecido e e-mail inválido', async () => {
    expect(await executarSuperAdmin(['apagar', '--email', EMAIL], cenario().deps)).toBe(1);
    const c = cenario();
    expect(await executarSuperAdmin(['criar', '--email', 'sem-arroba', '--nome', NOME], c.deps)).toBe(1);
    expect(c.erro.join('\n')).toMatch(/E-mail inválido/);
    expect(c.erro.join('\n')).not.toContain('sem-arroba');
  });
});
