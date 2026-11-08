/**
 * Comando `pnpm tenant:criar` (RN-CORE-31, desenho T-0083 §3 e §6) com banco FALSO: a função
 * `plataforma.provisionar_tenant` é do banco-dados (pedido R-20261105-060454) e o teste dela roda no CI com Postgres.
 * Aqui: senha nunca em argumento, saída sem segredo nem dado pessoal, `--simular`, trava fora do local e idempotência
 * repassada do banco.
 */
import { defineModule } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import {
  executarTenant,
  limparMensagem,
  mascararEmail,
  POLITICA_DO_CORE,
  VAR_SENHA_ADMIN,
  type BancoOnboarding,
  type DepsTenant,
  type EntradaProvisionar,
} from '../src/cli/tenant';
import { MODULOS_API } from '../src/modulos';

const SENHA = 'Segredo#123xyz';
const HASH = '$argon2id$v=19$m=19456,t=2,p=1$c2FsLWZhbHNv$dGFnLWZhbHNhLWRvLXRlc3Rl';
const EMAIL = 'Fulana.Admin@Distribuidora.com.br';
const NOME = 'Fulana de Tal';
const TENANT_ID = '6f1d2c3b-4a59-4e6f-8a7b-9c0d1e2f3a4b';

const todos = ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'] as const;
const manifestos = [
  defineModule({ id: 'core', versao: '1.0.0', perfis: [...todos] }),
  defineModule({ id: 'catalogo', versao: '1.0.0', depende: ['core'], perfis: [...todos] }),
  defineModule({ id: 'vendedor', versao: '1.0.0', depende: ['core', 'catalogo'], perfis: ['vendedor', 'admin'] }),
];

interface Cenario {
  deps: DepsTenant;
  saida: string[];
  erro: string[];
  chamadas: { entrada: EntradaProvisionar; simular: boolean }[];
  abriu: () => number;
  fechou: () => number;
}

function cenario(o: { env?: NodeJS.ProcessEnv; local?: boolean; resposta?: unknown; falha?: unknown; tty?: string[] | null; politica?: DepsTenant['politica'] } = {}): Cenario {
  const saida: string[] = [];
  const erro: string[] = [];
  const chamadas: Cenario['chamadas'] = [];
  let abriu = 0;
  let fechou = 0;
  const digitadas = o.tty === undefined ? null : o.tty;
  const banco: BancoOnboarding = {
    local: o.local ?? true,
    async provisionar(entrada, { simular }) {
      chamadas.push({ entrada, simular });
      if (o.falha) throw o.falha;
      return o.resposta ?? { tenant_id: TENANT_ID, resultado: 'criado', modulos_adicionados: ['core', 'catalogo'], admin: 'criado', avisos: [] };
    },
    async fechar() {
      fechou++;
    },
  };
  const deps: DepsTenant = {
    env: o.env ?? { [VAR_SENHA_ADMIN]: SENHA },
    manifestos,
    politica:
      o.politica === undefined
        ? {
            normalizarEmail: (e) => e.trim().toLowerCase(),
            validarSenhaInicial: (s, e) => (s.length < 8 ? 'A senha precisa ter pelo menos 8 caracteres.' : s.toLowerCase() === e ? 'A senha não pode ser igual ao e-mail.' : null),
          }
        : o.politica,
    hashSenha: (s) => (s === SENHA || s === 'OutraSenha456' ? HASH : `$argon2id$v=19$m=1,t=1,p=1$x$${s.length}`),
    lerSenhaOculta: digitadas ? async () => digitadas.shift() ?? '' : null,
    abrirBanco: async () => {
      abriu++;
      return banco;
    },
    saida: (l) => saida.push(l),
    erro: (l) => erro.push(l),
  };
  return { deps, saida, erro, chamadas, abriu: () => abriu, fechou: () => fechou };
}

const ARGS = ['criar', '--codigo', 'Distribuidora-X', '--nome', 'Distribuidora X', '--modulos', 'catalogo', '--admin-email', EMAIL, '--admin-nome', NOME];

/** Nada de senha, hash, e-mail ou nome do admin em claro (nem o e-mail normalizado). */
function semDadoSensivel(c: Cenario) {
  const tudo = [...c.saida, ...c.erro].join('\n');
  for (const s of [SENHA, HASH, '$argon2id', EMAIL, EMAIL.toLowerCase(), NOME, 'fulana.admin']) expect(tudo).not.toContain(s);
}

describe('pnpm tenant:criar (RN-CORE-31)', () => {
  it('RN-CORE-31: cria pelo plano dos manifestos; ao banco vão o hash e o e-mail normalizado; saída = uma linha JSON mascarada', async () => {
    const c = cenario();
    expect(await executarTenant(ARGS, c.deps)).toBe(0);
    expect(c.chamadas).toHaveLength(1);
    const { entrada, simular } = c.chamadas[0]!;
    expect(simular).toBe(false);
    expect(entrada).toEqual({
      codigo: 'distribuidora-x',
      nome: 'Distribuidora X',
      documento: null,
      fuso: 'America/Sao_Paulo',
      plano: 'piloto',
      modulos: [
        { modulo: 'core', licencas: null, perfis: [...todos] },
        { modulo: 'catalogo', licencas: null, perfis: [...todos] },
      ],
      admin: { email: EMAIL.toLowerCase(), nome: NOME, senha_hash: HASH },
      redefinir_senha: false,
    });
    expect(JSON.stringify(entrada)).not.toContain(SENHA);
    expect(c.saida).toHaveLength(1);
    expect(JSON.parse(c.saida[0]!)).toEqual({
      tenant_id: TENANT_ID,
      codigo: 'distribuidora-x',
      resultado: 'criado',
      modulos_adicionados: ['core', 'catalogo'],
      admin: 'criado',
      admin_email: 'f***@distribuidora.com.br',
      avisos: [],
    });
    expect(c.erro).toEqual([]);
    semDadoSensivel(c);
    expect(c.fechou()).toBe(1);
  });

  it('senha nunca em argumento: --senha, --admin-senha=..., --SENHA são recusados sem repetir o valor e sem abrir o banco', async () => {
    for (const extra of [['--senha', SENHA], [`--admin-senha=${SENHA}`], ['--SENHA', SENHA], [`--senha-admin=${SENHA}`]]) {
      const c = cenario();
      expect(await executarTenant([...ARGS, ...extra], c.deps)).toBe(1);
      expect(c.erro.join('\n')).toMatch(/Senha nunca vai em argumento/);
      expect(c.abriu()).toBe(0);
      semDadoSensivel(c);
    }
  });

  it('valor solto ou opção desconhecida: erro genérico que não ecoa o que foi digitado', async () => {
    for (const extra of [[SENHA], [`--x=${SENHA}`]]) {
      const c = cenario();
      expect(await executarTenant([...ARGS, ...extra], c.deps)).toBe(1);
      semDadoSensivel(c);
      expect(c.erro.join('\n')).not.toContain('Segredo');
    }
  });

  it('senha pela variável: lida uma vez e removida do ambiente; sem variável e sem terminal = recusa', async () => {
    const env: NodeJS.ProcessEnv = { [VAR_SENHA_ADMIN]: SENHA };
    const c = cenario({ env });
    expect(await executarTenant(ARGS, c.deps)).toBe(0);
    expect(env[VAR_SENHA_ADMIN]).toBeUndefined();

    const sem = cenario({ env: {} });
    expect(await executarTenant(ARGS, sem.deps)).toBe(1);
    expect(sem.erro.join('\n')).toContain(VAR_SENHA_ADMIN);
    expect(sem.abriu()).toBe(0);
  });

  it('senha digitada com eco desligado: pede duas vezes; diferentes = recusa', async () => {
    const c = cenario({ env: {}, tty: ['OutraSenha456', 'OutraSenha456'] });
    expect(await executarTenant(ARGS, c.deps)).toBe(0);
    expect(c.chamadas[0]!.entrada.admin.senha_hash).toBe(HASH);

    const d = cenario({ env: {}, tty: ['OutraSenha456', 'OutraSenha457'] });
    expect(await executarTenant(ARGS, d.deps)).toBe(1);
    expect(d.erro.join('\n')).toMatch(/não conferem/);
    expect(d.erro.join('\n')).not.toContain('OutraSenha');
  });

  it('política do Core: senha fraca recusada sem abrir o banco', async () => {
    const c = cenario({ env: { [VAR_SENHA_ADMIN]: 'curta1' } });
    expect(await executarTenant(ARGS, c.deps)).toBe(1);
    expect(c.erro.join('\n')).toMatch(/pelo menos 8/);
    expect(c.erro.join('\n')).not.toContain('curta1');
    expect(c.abriu()).toBe(0);
  });

  it('RN-CORE-31 item 5: o comando usa a política real do Core (import estático de @macuxi/core/api)', async () => {
    expect(POLITICA_DO_CORE.normalizarEmail('  Fulana.Admin@X.com.BR ')).toBe('fulana.admin@x.com.br');
    expect(POLITICA_DO_CORE.validarSenhaInicial('curta1', 'a@x.com')).toMatch(/pelo menos 8/);
    expect(POLITICA_DO_CORE.validarSenhaInicial('semnumeros', 'a@x.com')).toMatch(/Faltam um número e um caractere especial/);
    expect(POLITICA_DO_CORE.validarSenhaInicial(SENHA, EMAIL)).toBeNull();

    const c = cenario({ politica: POLITICA_DO_CORE });
    expect(await executarTenant(ARGS, c.deps)).toBe(0);
    expect(c.chamadas[0]!.entrada.admin.email).toBe(EMAIL.toLowerCase());
    expect(c.chamadas[0]!.entrada.admin.senha_hash).toBe(HASH);
  });

  it('RN-CORE-31 item 2: dependência faltando recusa antes de pedir a senha e de abrir o banco', async () => {
    const env: NodeJS.ProcessEnv = { [VAR_SENHA_ADMIN]: SENHA };
    const c = cenario({ env });
    const args = ARGS.map((a) => (a === 'catalogo' ? 'vendedor' : a));
    expect(await executarTenant(args, c.deps)).toBe(1);
    expect(c.erro.join('\n')).toMatch(/vendedor depende de catalogo/);
    expect(c.abriu()).toBe(0);
    expect(env[VAR_SENHA_ADMIN]).toBe(SENHA);
  });

  it('--licencas e --redefinir-senha chegam ao banco; licença mal escrita é recusada', async () => {
    const c = cenario();
    expect(await executarTenant([...ARGS.map((a) => (a === 'catalogo' ? 'catalogo,vendedor' : a)), '--licencas', 'vendedor=20', '--redefinir-senha'], c.deps)).toBe(0);
    const e = c.chamadas[0]!.entrada;
    expect(e.modulos.map((m) => [m.modulo, m.licencas])).toEqual([['core', null], ['catalogo', null], ['vendedor', 20]]);
    expect(e.redefinir_senha).toBe(true);

    const d = cenario();
    expect(await executarTenant([...ARGS, '--licencas', 'catalogo:3'], d.deps)).toBe(1);
    expect(d.abriu()).toBe(0);
  });

  it('--simular: a mesma chamada em transação desfeita, marcada na saída', async () => {
    const c = cenario();
    expect(await executarTenant([...ARGS, '--simular'], c.deps)).toBe(0);
    expect(c.chamadas[0]!.simular).toBe(true);
    expect(JSON.parse(c.saida[0]!)).toMatchObject({ simulado: true });
  });

  it('fora do Postgres local exige --confirmar <codigo> igual ao do tenant', async () => {
    const sem = cenario({ local: false });
    expect(await executarTenant(ARGS, sem.deps)).toBe(1);
    expect(sem.chamadas).toHaveLength(0);
    expect(sem.erro.join('\n')).toContain('--confirmar distribuidora-x');
    expect(sem.fechou()).toBe(1);

    const errado = cenario({ local: false });
    expect(await executarTenant([...ARGS, '--confirmar', 'outro'], errado.deps)).toBe(1);
    expect(errado.chamadas).toHaveLength(0);

    const certo = cenario({ local: false });
    expect(await executarTenant([...ARGS, '--confirmar', 'Distribuidora-X'], certo.deps)).toBe(0);
    expect(certo.chamadas).toHaveLength(1);
  });

  it('idempotência (pela função do banco): segunda rodada repassa sem_mudanca / existente sem dado pessoal', async () => {
    const c = cenario({ resposta: { tenant_id: TENANT_ID, resultado: 'sem_mudanca', modulos_adicionados: [], admin: 'existente', avisos: [`tenant já existe; admin ${EMAIL.toLowerCase()} mantido`] } });
    expect(await executarTenant(ARGS, c.deps)).toBe(0);
    expect(JSON.parse(c.saida[0]!)).toMatchObject({ resultado: 'sem_mudanca', admin: 'existente', modulos_adicionados: [] });
    semDadoSensivel(c);
  });

  it('erro do banco: só código e mensagem, sem o detail (linha com hash e e-mail); função ausente e permissão com mensagem própria', async () => {
    const falha = Object.assign(new Error(`new row violates check constraint "usuario_email_formato" ${EMAIL.toLowerCase()} ${HASH}`), {
      code: '23514',
      detail: `Failing row contains (${EMAIL}, ${HASH}).`,
    });
    const c = cenario({ falha });
    expect(await executarTenant(ARGS, c.deps)).toBe(1);
    expect(c.erro.join('\n')).toMatch(/23514/);
    semDadoSensivel(c);
    expect(c.fechou()).toBe(1);

    const ausente = cenario({ falha: Object.assign(new Error('function plataforma.provisionar_tenant(jsonb) does not exist'), { code: '42883' }) });
    expect(await executarTenant(ARGS, ausente.deps)).toBe(1);
    expect(ausente.erro.join('\n')).toMatch(/aplique as migrações/);

    const negado = cenario({ falha: Object.assign(new Error('permission denied for function provisionar_tenant'), { code: '42501' }) });
    expect(await executarTenant(ARGS, negado.deps)).toBe(1);
    expect(negado.erro.join('\n')).toMatch(/conexão de administração/);
  });

  it('resposta do banco fora do formato combinado é erro, sem imprimir a resposta', async () => {
    const c = cenario({ resposta: { tenant_id: 'x', email: EMAIL } });
    expect(await executarTenant(ARGS, c.deps)).toBe(1);
    expect(c.saida).toEqual([]);
    semDadoSensivel(c);
  });

  it('comando desconhecido e argumentos obrigatórios faltando', async () => {
    const c = cenario();
    expect(await executarTenant(['apagar', '--codigo', 'x'], c.deps)).toBe(1);
    expect(await executarTenant(['criar', '--codigo', 'x'], c.deps)).toBe(1);
    expect(c.abriu()).toBe(0);
  });

  it('apoio: mascararEmail e limparMensagem', () => {
    expect(mascararEmail('ana@x.com.br')).toBe('a***@x.com.br');
    expect(mascararEmail('sem-arroba')).toBe('***');
    expect(limparMensagem(`erro ${HASH} de ana@x.com`, ['ana@x.com'])).toBe('erro [hash] de [omitido]');
    expect(limparMensagem(`linha (${HASH}, x)`, [])).toBe('linha ([hash], x)');
    // nome curto do admin ("A") não come o artigo da mensagem do Core
    expect(limparMensagem('A senha precisa ter pelo menos 8 caracteres.', ['A', 'Li'])).toBe('A senha precisa ter pelo menos 8 caracteres.');
    expect(limparMensagem('de Ana para ana@x.com', ['Ana', 'ana@x.com'])).toBe('de [omitido] para [omitido]');
  });

  it('os manifestos reais da API montam um plano válido para todos os módulos', async () => {
    const c = cenario();
    c.deps.manifestos = MODULOS_API.map((m) => m.manifesto);
    const todosModulos = MODULOS_API.map((m) => m.manifesto.id).join(',');
    expect(await executarTenant(ARGS.map((a) => (a === 'catalogo' ? todosModulos : a)), c.deps)).toBe(0);
    const e = c.chamadas[0]!.entrada;
    expect(e.modulos[0]!.modulo).toBe('core');
    expect(e.modulos.find((m) => m.modulo === 'vendedor')!.perfis).not.toContain('promotor');
  });
});
