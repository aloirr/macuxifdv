/**
 * Acesso da requisição pelo perfil sem base (ADR 0073 §2.7 e §2.8, E3): `verificarAcao` pela concessão + cargo (sem o `perfis`
 * do manifesto), barreira da RN-PRO-01 pelo cargo promotor, superfície do BKO (RN-CORE-33), licença antes da permissão
 * (RN-CORE-02), marca `catalogo_aplicado` e leitura dupla. Regras: RN-PRO-01, RN-CORE-33, RN-CORE-35, RN-CORE-02.
 */
import { describe, expect, it } from 'vitest';
import type { UsuarioAcesso } from './acesso';
import {
  autorizarRotaPeloCargo,
  camposPeloCargo,
  diferencasEntreMotores,
  exigirPermissaoPeloCargo,
} from './acesso-por-cargo';
import { ErroHttpModulo } from './api';
import { defineModule } from './manifesto';
import { PERFIS, type ModuloId } from './nomes';
import {
  CATALOGO_PERMISSOES_VERSAO,
  modelosDePerfil,
  MODELOS_PERFIL,
  type PerfilDaRequisicaoV2,
  vetadaPeloCargo,
} from './perfis-por-cargo';
import {
  criarPermissoes,
  motorDePermissao,
  verificarAcao,
  verificarAcaoPeloCargo,
} from './permissoes';
import {
  matrizDeFabrica,
  perfilDeFabrica,
  resolverPerfil,
  type PerfilDaRequisicao,
} from './permissoes-perfil';

const core = defineModule({
  id: 'core',
  versao: '1.0.0',
  perfis: [...PERFIS],
  acoes: { 'meta.editar': { perfis: ['supervisor', 'gerente', 'analista', 'admin'] } },
});
const vendedor = defineModule({
  id: 'vendedor',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin', 'promotor'],
  acoes: {
    'pedido.ver': {
      perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin', 'promotor'],
    },
    'pedido.criar': { perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] },
    'pedido.aprovar': { perfis: ['supervisor', 'gerente', 'analista'] },
  },
});
const promotor = defineModule({
  id: 'promotor',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['promotor', 'vendedor'],
  acoes: { 'coleta.registrar': { perfis: ['promotor'] } },
});
const MANIFESTOS = [core, vendedor, promotor];
const PERMISSOES = criarPermissoes(MANIFESTOS);
const MODELOS = modelosDePerfil(MANIFESTOS);
const TODOS_MODULOS: ModuloId[] = ['core', 'vendedor', 'promotor'];

/** Usuário com o perfil novo (e, para comparar, o antigo do mesmo perfil padrão). */
function usuario(
  modelo: (typeof MODELOS_PERFIL)[number],
  extra: Partial<UsuarioAcesso> = {},
): UsuarioAcesso & { perfil_acesso: PerfilDaRequisicaoV2 } {
  const { cargo, perfil_acesso } = camposPeloCargo({ codigo: modelo, ...MODELOS[modelo] });
  const antigo: PerfilDaRequisicao = {
    codigo: modelo,
    base: modelo,
    permissoes: resolverPerfil(perfilDeFabrica(modelo), matrizDeFabrica(MANIFESTOS)).permissoes,
  };
  return {
    id: 'u1',
    tenant_id: 't1',
    perfil: modelo,
    modulos: TODOS_MODULOS,
    perfis: [antigo],
    cargo,
    perfil_acesso: perfil_acesso!,
    ...extra,
  };
}

const SEM_ACESSO = { ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' };

describe('camposPeloCargo (ctx.usuario.cargo e perfil_acesso)', () => {
  it('o cargo é sempre o do perfil resolvido; sem perfil, nenhum campo (falha fechada)', () => {
    const c = camposPeloCargo({
      codigo: 'sup',
      cargo: 'supervisor',
      permissoes: { 'dados.escopo': { nivel: 'tenant' } },
    });
    expect(c.cargo).toBe('supervisor');
    expect(c.perfil_acesso).toEqual({
      codigo: 'sup',
      cargo: 'supervisor',
      permissoes: { 'dados.escopo': { nivel: 'equipe' } },
    });
    expect(camposPeloCargo(null)).toEqual({});
  });

  it('RN-PRO-01: concessão de escrita de pedido gravada num perfil de cargo promotor some na leitura', () => {
    const c = camposPeloCargo({
      codigo: 'prom',
      cargo: 'promotor',
      permissoes: { 'pedido.criar': {}, 'pedido.ver': {} },
    });
    expect(Object.keys(c.perfil_acesso!.permissoes)).toEqual(['pedido.ver']);
  });
});

describe('verificarAcaoPeloCargo (sem o perfis do manifesto)', () => {
  it('decide pela concessão: o vendedor sem a caixa não cria pedido, mesmo com o manifesto dizendo que pode', () => {
    const u = usuario('vendedor');
    expect(verificarAcaoPeloCargo(u, PERMISSOES, 'pedido.criar')).toEqual({ ok: true });
    const semCaixa = { ...u.perfil_acesso, permissoes: { ...u.perfil_acesso.permissoes } };
    delete (semCaixa.permissoes as Record<string, unknown>)['pedido.criar'];
    expect(
      verificarAcaoPeloCargo({ ...u, perfil_acesso: semCaixa }, PERMISSOES, 'pedido.criar'),
    ).toMatchObject(SEM_ACESSO);
  });

  it('decide pela concessão: o assistente com a caixa marcada aprova pedido, fora do perfis do manifesto', () => {
    const u = usuario('assistente');
    expect(verificarAcao(u, PERMISSOES, 'pedido.aprovar').ok).toBe(false);
    const comCaixa = {
      ...u.perfil_acesso,
      permissoes: { ...u.perfil_acesso.permissoes, 'pedido.aprovar': {} },
    };
    expect(verificarAcaoPeloCargo({ ...u, perfil_acesso: comCaixa }, PERMISSOES, 'pedido.aprovar')).toEqual({
      ok: true,
    });
  });

  it('RN-PRO-01: cargo promotor nunca escreve pedido, nem com a concessão montada à mão (sem resolver)', () => {
    const u = usuario('promotor');
    const aMao: PerfilDaRequisicaoV2 = {
      codigo: 'x',
      cargo: 'promotor',
      permissoes: { 'pedido.criar': {}, 'pedido.aprovar': {} },
    };
    expect(vetadaPeloCargo('pedido.criar', 'promotor')).toBe(true);
    expect(vetadaPeloCargo('pedido.ver', 'promotor')).toBe(false);
    expect(vetadaPeloCargo('pedido.criar', 'vendedor')).toBe(false);
    expect(verificarAcaoPeloCargo({ ...u, perfil_acesso: aMao }, PERMISSOES, 'pedido.criar')).toMatchObject(
      SEM_ACESSO,
    );
    expect(verificarAcaoPeloCargo({ ...u, perfil_acesso: aMao }, PERMISSOES, 'pedido.aprovar')).toMatchObject(
      SEM_ACESSO,
    );
    // leitura é a concessão do perfil
    expect(verificarAcaoPeloCargo(u, PERMISSOES, 'pedido.ver')).toEqual({ ok: true });
  });

  it('RN-CORE-02: licença do módulo dono antes da permissão; 401 sem usuário; ação desconhecida = 403; sem perfil = 403', () => {
    const u = usuario('vendedor', { modulos: ['core'] });
    expect(verificarAcaoPeloCargo(u, PERMISSOES, 'pedido.criar')).toMatchObject({
      status: 403,
      codigo: 'MODULO_INATIVO',
    });
    expect(verificarAcaoPeloCargo(null, PERMISSOES, 'pedido.criar')).toMatchObject({
      status: 401,
      codigo: 'NAO_AUTENTICADO',
    });
    expect(verificarAcaoPeloCargo(usuario('admin'), PERMISSOES, 'nada.fazer')).toMatchObject(SEM_ACESSO);
    const { perfil_acesso: _p, ...semPerfil } = usuario('vendedor');
    expect(verificarAcaoPeloCargo(semPerfil, PERMISSOES, 'pedido.ver')).toMatchObject(SEM_ACESSO);
  });

  it('as chaves da plataforma são do core (RN-CORE-35: perfil.gerir só com a concessão)', () => {
    expect(PERMISSOES.moduloDaAcao('perfil.gerir')).toBe('core');
    expect(PERMISSOES.moduloDaAcao('pedido.criar')).toBe('vendedor');
    expect(PERMISSOES.moduloDaAcao('nada.fazer')).toBeUndefined();
    expect(verificarAcaoPeloCargo(usuario('admin'), PERMISSOES, 'perfil.gerir')).toEqual({ ok: true });
    expect(verificarAcaoPeloCargo(usuario('analista'), PERMISSOES, 'perfil.gerir')).toMatchObject(SEM_ACESSO);
  });
});

describe('motorDePermissao (marca plataforma.catalogo_aplicado)', () => {
  it('só o tenant com o catálogo da versão do código (ou acima) lê pelo cargo', () => {
    expect(motorDePermissao(null)).toBe('base');
    expect(motorDePermissao(undefined)).toBe('base');
    expect(motorDePermissao(CATALOGO_PERMISSOES_VERSAO)).toBe('cargo');
    expect(motorDePermissao(CATALOGO_PERMISSOES_VERSAO + 1)).toBe('cargo');
    expect(motorDePermissao(1, 2)).toBe('base');
  });
});

describe('ContextoPermissao.perfilAcesso (shell)', () => {
  it('presente, decide a concessão com a licença e a RN-PRO-01 pelo cargo; ausente, o motor antigo como antes', () => {
    const u = usuario('promotor');
    const ctx = { perfil: u.perfil, modulosAtivos: TODOS_MODULOS, perfilAcesso: u.perfil_acesso };
    expect(PERMISSOES.pode('coleta.registrar', ctx)).toBe(true);
    expect(PERMISSOES.pode('pedido.ver', ctx)).toBe(true);
    const aMao = { codigo: 'x', cargo: 'promotor' as const, permissoes: { 'pedido.criar': {} } };
    expect(PERMISSOES.pode('pedido.criar', { ...ctx, perfilAcesso: aMao })).toBe(false);
    expect(PERMISSOES.pode('coleta.registrar', { ...ctx, modulosAtivos: ['core'] })).toBe(false);
    expect(PERMISSOES.pode('coleta.registrar', { perfil: 'promotor', modulosAtivos: TODOS_MODULOS })).toBe(
      true,
    );
  });
});

describe('autorizarRotaPeloCargo (rota sem RotaModulo.perfis)', () => {
  const rota = (
    r: Partial<{ metodo: 'GET' | 'POST'; caminho: string; acao: string; superficie: 'bko' }>,
  ) => ({
    metodo: 'GET' as const,
    caminho: 'x',
    ...r,
  });

  it('licença do módulo da rota primeiro (RN-CORE-02); rota sem ação = basta a licença e um perfil', () => {
    expect(autorizarRotaPeloCargo(null, PERMISSOES, 'vendedor', rota({}))).toMatchObject({ status: 401 });
    expect(
      autorizarRotaPeloCargo(usuario('vendedor', { modulos: ['core'] }), PERMISSOES, 'vendedor', rota({})),
    ).toMatchObject({ codigo: 'MODULO_INATIVO' });
    expect(autorizarRotaPeloCargo(usuario('vendedor'), PERMISSOES, 'vendedor', rota({}))).toEqual({
      ok: true,
    });
    const { perfil_acesso: _p, ...semPerfil } = usuario('vendedor');
    expect(autorizarRotaPeloCargo(semPerfil, PERMISSOES, 'vendedor', rota({}))).toMatchObject(SEM_ACESSO);
  });

  it('RN-CORE-33: rota do BKO só com acesso.bko, que o cargo vendedor, promotor ou supervisor nunca tem', () => {
    for (const m of ['vendedor', 'promotor', 'supervisor'] as const)
      expect(
        autorizarRotaPeloCargo(usuario(m), PERMISSOES, 'core', rota({ superficie: 'bko' })),
        m,
      ).toMatchObject({ codigo: 'PERFIL_SEM_BKO' });
    expect(autorizarRotaPeloCargo(usuario('admin'), PERMISSOES, 'core', rota({ superficie: 'bko' }))).toEqual(
      { ok: true },
    );
    // a caixa gravada num supervisor não vale (trava pelo cargo na leitura)
    const sup = camposPeloCargo({
      codigo: 's',
      cargo: 'supervisor',
      permissoes: { 'acesso.bko': {}, 'acesso.gestao': {} },
    });
    expect(
      autorizarRotaPeloCargo(
        { ...usuario('supervisor'), ...sup },
        PERMISSOES,
        'core',
        rota({ superficie: 'bko' }),
      ),
    ).toMatchObject({ codigo: 'PERFIL_SEM_BKO' });
  });

  it('RN-PRO-01: o cargo promotor é barrado em rota de pedido de escrita (mesmo sem ação) e lê com pedido.ver', () => {
    const p = usuario('promotor');
    expect(
      autorizarRotaPeloCargo(
        p,
        PERMISSOES,
        'vendedor',
        rota({ metodo: 'POST', caminho: 'pedidos/:id/itens' }),
      ),
    ).toMatchObject(SEM_ACESSO);
    expect(
      autorizarRotaPeloCargo(
        p,
        PERMISSOES,
        'vendedor',
        rota({ metodo: 'POST', caminho: 'pedidos', acao: 'pedido.criar' }),
      ),
    ).toMatchObject(SEM_ACESSO);
    expect(
      autorizarRotaPeloCargo(p, PERMISSOES, 'vendedor', rota({ caminho: 'pedidos', acao: 'pedido.ver' })),
    ).toEqual({ ok: true });
    // o vendedor passa na mesma rota de escrita
    expect(
      autorizarRotaPeloCargo(
        usuario('vendedor'),
        PERMISSOES,
        'vendedor',
        rota({ metodo: 'POST', caminho: 'pedidos', acao: 'pedido.criar' }),
      ),
    ).toEqual({ ok: true });
  });
});

describe('exigirPermissaoPeloCargo', () => {
  it('403 sem a concessão, sem perfil ou com a RN-PRO-01; passa com a concessão', () => {
    expect(() => exigirPermissaoPeloCargo(usuario('admin'), 'usuario.criar')).not.toThrow();
    expect(() => exigirPermissaoPeloCargo(usuario('vendedor'), 'usuario.criar')).toThrow(ErroHttpModulo);
    expect(() => exigirPermissaoPeloCargo({}, 'pedido.ver')).toThrow(ErroHttpModulo);
    const aMao = { codigo: 'x', cargo: 'promotor' as const, permissoes: { 'pedido.criar': {} } };
    expect(() => exigirPermissaoPeloCargo({ perfil_acesso: aMao }, 'pedido.criar')).toThrow(ErroHttpModulo);
  });

  it('RN-CORE-34: nunca no próprio; senha só para alvo sem perfil.gerir', () => {
    const a = usuario('admin');
    expect(() => exigirPermissaoPeloCargo(a, 'usuario.desativar', { proprio: true, perfil: null })).toThrow(
      ErroHttpModulo,
    );
    expect(() =>
      exigirPermissaoPeloCargo(a, 'senha.redefinir', {
        proprio: false,
        perfil: { codigo: 'admin', gerePerfis: true },
      }),
    ).toThrow(ErroHttpModulo);
    expect(() =>
      exigirPermissaoPeloCargo(a, 'senha.redefinir', {
        proprio: false,
        perfil: { codigo: 'vendedor', gerePerfis: false },
      }),
    ).not.toThrow();
  });
});

describe('diferencasEntreMotores (leitura dupla da E4)', () => {
  it('lista concessão, nível ou alvos que divergem; sem nada dos dois lados = vazio', () => {
    const antigo: PerfilDaRequisicao[] = [
      {
        codigo: 'a',
        base: 'admin',
        permissoes: {
          'x.ver': {},
          'dados.escopo': { nivel: 'tenant' },
          'senha.redefinir': { alvos: ['b', 'a'] },
        },
      },
    ];
    const novo: PerfilDaRequisicaoV2 = {
      codigo: 'a',
      cargo: 'administrativo',
      permissoes: {
        'y.ver': {},
        'dados.escopo': { nivel: 'equipe' },
        'senha.redefinir': { alvos: ['a', 'b'] },
      },
    };
    expect(diferencasEntreMotores(antigo, novo)).toEqual([
      { chave: 'dados.escopo', base: { nivel: 'tenant' }, cargo: { nivel: 'equipe' } },
      { chave: 'x.ver', base: {}, cargo: null },
      { chave: 'y.ver', base: null, cargo: {} },
    ]);
    expect(diferencasEntreMotores(undefined, null)).toEqual([]);
  });
});
