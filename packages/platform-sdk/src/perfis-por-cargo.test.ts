/**
 * Perfis sem perfil base (ADR 0073, E1): modelos dos 7 perfis padrão, travas pelo cargo e pela gestão do acesso, validação da
 * escrita e o nome de compatibilidade. Regras: RN-PRO-01, RN-CORE-33, RN-CORE-04, RN-CORE-35, RN-CORE-34, RN-CORE-02, RN-CORE-54.
 */
import { describe, expect, it } from 'vitest';
import { CARGOS, type Cargo } from './cargos';
import { defineModule } from './manifesto';
import { PERFIS } from './nomes';
import {
  CATALOGO_PERMISSOES_VERSAO,
  linhasDosModelos,
  MODELOS_PERFIL,
  modelosDePerfil,
  perfilDeCompatibilidade,
  PerfilDaRequisicaoV2Schema,
  podePeloCargo,
  resolverPerfilPeloCargo,
  temGestaoDoAcesso,
  tetoDeEscopoDoCargo,
  travaDaChavePeloCargo,
  validarAcessoPeloCargo,
  validarPerfilPeloCargo,
  type EstadoAcessoPorCargo,
  type PerfilPorCargo,
  type PerfisDoTenantPorCargo,
} from './perfis-por-cargo';
import { catalogoDePermissoes, NIVEIS_ESCOPO, type NivelEscopo } from './permissoes-perfil';

const TODOS = [...PERFIS];
const core = defineModule({
  id: 'core',
  versao: '1.0.0',
  perfis: TODOS,
  acoes: {
    'meta.editar': { perfis: ['supervisor', 'gerente', 'analista', 'admin'] },
    'carteira.editar': { perfis: ['analista', 'admin'] },
  },
});
const vendedor = defineModule({
  id: 'vendedor',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
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
const CATALOGO = catalogoDePermissoes(MANIFESTOS);
const MODELOS = modelosDePerfil(MANIFESTOS);

const GESTAO = {
  'acesso.bko': {},
  'perfil.gerir': {},
  'usuario.criar': {},
  'usuario.editar': {},
  'usuario.desativar': {},
};
const perfil = (
  codigo: string,
  cargo: Cargo,
  permissoes: PerfilPorCargo['permissoes'],
  ativo = true,
): PerfilPorCargo => ({ codigo, cargo, ativo, permissoes });
const semAlvos: PerfisDoTenantPorCargo = new Map();

describe('catálogo e modelos (ADR 0073 §2.2 e §2.3)', () => {
  it('os 7 modelos têm o cargo de cada perfil padrão', () => {
    expect(Object.keys(MODELOS)).toEqual([...MODELOS_PERFIL]);
    expect(Object.fromEntries(MODELOS_PERFIL.map((m) => [m, MODELOS[m].cargo]))).toEqual({
      vendedor: 'vendedor',
      promotor: 'promotor',
      supervisor: 'supervisor',
      gerente: 'gerente',
      analista: 'administrativo',
      assistente: 'administrativo',
      admin: 'administrativo',
    });
    expect(MODELOS.admin.permissoes['senha.redefinir']).toEqual({ alvos: ['*'] });
    expect(MODELOS.gerente.permissoes['dados.escopo']).toEqual({ nivel: 'equipes_abaixo' });
  });

  it('linhas dos modelos: uma por (modelo, chave), na ordem dos modelos e da chave, com nível e alvos nulos quando não há', () => {
    const linhas = linhasDosModelos(MODELOS);
    expect(linhas.length).toBe(
      MODELOS_PERFIL.reduce((n, m) => n + Object.keys(MODELOS[m].permissoes).length, 0),
    );
    expect(linhas[0]).toMatchObject({
      versao: CATALOGO_PERMISSOES_VERSAO,
      modelo: 'vendedor',
      cargo: 'vendedor',
    });
    expect(linhas.find((l) => l.modelo === 'admin' && l.chave === 'senha.redefinir')).toMatchObject({
      nivel: null,
      alvos: ['*'],
    });
    expect(linhas.find((l) => l.modelo === 'vendedor' && l.chave === 'acesso.campo')).toMatchObject({
      nivel: null,
      alvos: null,
    });
    const vend = linhas.filter((l) => l.modelo === 'vendedor').map((l) => l.chave);
    expect(vend).toEqual([...vend].sort());
  });
});

describe('travas pelo cargo (ADR 0073 §2.5)', () => {
  it('RN-PRO-01: cargo promotor nunca tem escrita de pedido; leitura de pedido é livre; vendedor com trade é permitido', () => {
    for (const c of [
      'pedido.criar',
      'pedido.editar',
      'pedido.cancelar',
      'pedido.excluir',
      'pedido.aprovar',
      'pedido.criar_em_nome',
      'pedido_item.editar',
    ]) {
      expect(travaDaChavePeloCargo('promotor', c, { gestaoDoAcesso: false })?.regra).toBe('RN-PRO-01');
    }
    expect(travaDaChavePeloCargo('promotor', 'pedido.ver', { gestaoDoAcesso: false })).toBeNull();
    expect(travaDaChavePeloCargo('vendedor', 'coleta.registrar', { gestaoDoAcesso: false })).toBeNull();
  });

  it('RN-CORE-33: matriz cargo x lugar; portal só administrativo com a gestão do acesso', () => {
    const livres: Record<Cargo, string[]> = {
      vendedor: ['acesso.campo'],
      promotor: ['acesso.campo'],
      supervisor: ['acesso.gestao'],
      gerente: ['acesso.gestao', 'acesso.bko'],
      administrativo: ['acesso.bko'],
    };
    for (const gestaoDoAcesso of [false, true])
      for (const c of CARGOS)
        for (const k of ['acesso.campo', 'acesso.gestao', 'acesso.bko', 'acesso.portal']) {
          const esperado =
            livres[c].includes(k) || (k === 'acesso.portal' && c === 'administrativo' && gestaoDoAcesso);
          const trava = travaDaChavePeloCargo(c, k, { gestaoDoAcesso });
          expect(trava === null, `${c} ${k} gestão=${gestaoDoAcesso}`).toBe(esperado);
          if (trava) expect(trava.regra).toBe('RN-CORE-33');
        }
  });

  it('a mensagem da trava não traz código interno de regra', () => {
    for (const c of CARGOS)
      for (const k of ['acesso.bko', 'acesso.portal', 'acesso.campo', 'acesso.gestao', 'pedido.criar']) {
        expect(travaDaChavePeloCargo(c, k, { gestaoDoAcesso: false })?.mensagem ?? '').not.toMatch(/RN-/);
      }
  });

  it('RN-CORE-04: teto do escopo pelo cargo', () => {
    expect(Object.fromEntries(CARGOS.map((c) => [c, tetoDeEscopoDoCargo(c)]))).toEqual({
      vendedor: 'carteira',
      promotor: 'carteira',
      supervisor: 'equipe',
      gerente: 'equipes_abaixo',
      administrativo: 'tenant',
    });
  });

  it('leitura com falha fechada: tira o travado, corta o escopo no teto e trata nível inválido como carteira', () => {
    const r = resolverPerfilPeloCargo(
      perfil('pp', 'promotor', {
        'acesso.campo': {},
        'acesso.bko': {},
        'pedido.criar': {},
        'pedido.ver': {},
        'dados.escopo': { nivel: 'tenant' },
      }),
    );
    expect(r).toEqual({
      codigo: 'pp',
      cargo: 'promotor',
      permissoes: { 'acesso.campo': {}, 'pedido.ver': {}, 'dados.escopo': { nivel: 'carteira' } },
    });
    const s = resolverPerfilPeloCargo(
      perfil('ss', 'supervisor', { 'acesso.gestao': {}, 'dados.escopo': { nivel: 'acima_alcada' } }),
    );
    expect(s.permissoes['dados.escopo']).toEqual({ nivel: 'carteira' });
    const adm = resolverPerfilPeloCargo(perfil('aa', 'administrativo', { ...GESTAO, 'acesso.portal': {} }));
    expect(adm.permissoes['acesso.portal']).toEqual({});
    expect(PerfilDaRequisicaoV2Schema.parse(adm)).toEqual(adm);
  });
});

describe('gestão do acesso e senha (RN-CORE-35, RN-CORE-34)', () => {
  it('RN-CORE-33: portal com a gestão incompleta (falta usuario.desativar) some na leitura e é recusado na escrita', () => {
    const { 'usuario.desativar': _fora, ...incompleta } = GESTAO;
    const p = perfil('bb', 'administrativo', { ...incompleta, 'acesso.portal': {} });
    expect(resolverPerfilPeloCargo(p).permissoes['acesso.portal']).toBeUndefined();
    expect(validarPerfilPeloCargo(p, semAlvos).map((x) => [x.codigo, x.regra, x.chave])).toEqual([
      ['TRAVA_DO_PERFIL', 'RN-CORE-33', 'acesso.portal'],
    ]);
  });

  it('gestão do acesso completa = acesso.bko + perfil.gerir + usuario.criar/editar/desativar', () => {
    expect(temGestaoDoAcesso(GESTAO)).toBe(true);
    for (const k of Object.keys(GESTAO)) {
      const sem = { ...GESTAO } as Record<string, object>;
      delete sem[k];
      expect(temGestaoDoAcesso(sem), k).toBe(false);
    }
  });

  it('RN-CORE-34: senha.redefinir nunca sobre o próprio nem sobre quem tem perfil.gerir; * cobre os demais', () => {
    const p = resolverPerfilPeloCargo(
      perfil('aa', 'administrativo', { ...GESTAO, 'senha.redefinir': { alvos: ['*'] } }),
    );
    expect(
      podePeloCargo(p, 'senha.redefinir', {
        proprio: false,
        perfil: { codigo: 'vendedor', gerePerfis: false },
      }),
    ).toBe(true);
    expect(
      podePeloCargo(p, 'senha.redefinir', { proprio: false, perfil: { codigo: 'admin2', gerePerfis: true } }),
    ).toBe(false);
    expect(
      podePeloCargo(p, 'senha.redefinir', {
        proprio: true,
        perfil: { codigo: 'vendedor', gerePerfis: false },
      }),
    ).toBe(false);
    expect(
      podePeloCargo(p, 'usuario.desativar', { proprio: true, perfil: { codigo: 'a', gerePerfis: true } }),
    ).toBe(false);
    const lista = resolverPerfilPeloCargo(
      perfil('bb', 'administrativo', { 'acesso.bko': {}, 'senha.redefinir': { alvos: ['vendedor'] } }),
    );
    expect(
      podePeloCargo(lista, 'senha.redefinir', {
        proprio: false,
        perfil: { codigo: 'vendedor', gerePerfis: false },
      }),
    ).toBe(true);
    expect(
      podePeloCargo(lista, 'senha.redefinir', {
        proprio: false,
        perfil: { codigo: 'promotor', gerePerfis: false },
      }),
    ).toBe(false);
    expect(podePeloCargo(p, 'senha.redefinir', { proprio: false, perfil: null })).toBe(false);
    expect(podePeloCargo(null, 'acesso.bko')).toBe(false);
  });

  it('RN-CORE-34: alvo de senha inexistente ou com a gestão de perfis é recusado na escrita', () => {
    const alvos: PerfisDoTenantPorCargo = new Map([
      ['vendedor', { cargo: 'vendedor', gerePerfis: false }],
      ['admin', { cargo: 'administrativo', gerePerfis: true }],
    ]);
    const v = validarPerfilPeloCargo(
      perfil('bb', 'administrativo', {
        'acesso.bko': {},
        'senha.redefinir': { alvos: ['vendedor', 'admin', 'fantasma'] },
      }),
      alvos,
    );
    expect(v.map((x) => [x.codigo, x.regra])).toEqual([
      ['SENHA_ALVO_INVALIDO', 'RN-CORE-34'],
      ['SENHA_ALVO_INVALIDO', 'RN-CORE-35'],
    ]);
  });
});

describe('validarPerfilPeloCargo (escrita)', () => {
  it('RN-PRO-01 e RN-CORE-33 recusam a caixa travada com a regra', () => {
    const v = validarPerfilPeloCargo(
      perfil('pp', 'promotor', { 'acesso.campo': {}, 'acesso.bko': {}, 'pedido.criar': {} }),
      semAlvos,
      { catalogo: CATALOGO },
    );
    expect(v.map((x) => [x.codigo, x.regra, x.chave])).toEqual([
      ['TRAVA_DO_PERFIL', 'RN-CORE-33', 'acesso.bko'],
      ['TRAVA_DO_PERFIL', 'RN-PRO-01', 'pedido.criar'],
    ]);
  });

  it('RN-CORE-04: escopo acima do teto do cargo é recusado; nível ausente ou de outra família é inválido', () => {
    const lugar: Record<Cargo, string> = {
      vendedor: 'acesso.campo',
      promotor: 'acesso.campo',
      supervisor: 'acesso.gestao',
      gerente: 'acesso.gestao',
      administrativo: 'acesso.bko',
    };
    for (const c of CARGOS) {
      const teto = tetoDeEscopoDoCargo(c);
      const escopo = (nivel: NivelEscopo) =>
        validarPerfilPeloCargo(perfil('cc', c, { [lugar[c]]: {}, 'dados.escopo': { nivel } }), semAlvos);
      expect(escopo(teto), `${c} no teto`).toEqual([]);
      const acima = NIVEIS_ESCOPO[NIVEIS_ESCOPO.indexOf(teto) + 1];
      if (acima)
        expect(
          escopo(acima).map((x) => [x.codigo, x.regra]),
          `${c} acima`,
        ).toEqual([['ESCOPO_ACIMA_DO_CARGO', 'RN-CORE-04']]);
    }
    expect(
      validarPerfilPeloCargo(
        perfil('ss', 'supervisor', { 'acesso.gestao': {}, 'dados.escopo': { nivel: 'proprio' } }),
        semAlvos,
      ),
    ).toEqual([]);
    expect(
      validarPerfilPeloCargo(
        perfil('ss', 'supervisor', { 'acesso.gestao': {}, 'dados.escopo': {} }),
        semAlvos,
      )[0]?.codigo,
    ).toBe('VALOR_INVALIDO');
    expect(
      validarPerfilPeloCargo(
        perfil('ss', 'supervisor', { 'acesso.gestao': {}, 'dados.escopo': { nivel: 'ate_alcada' } }),
        semAlvos,
      )[0]?.codigo,
    ).toBe('VALOR_INVALIDO');
    expect(
      validarPerfilPeloCargo(
        perfil('ss', 'supervisor', { 'acesso.gestao': { nivel: 'equipe' } }),
        semAlvos,
      )[0]?.codigo,
    ).toBe('VALOR_INVALIDO');
  });

  it('RN-CORE-35: perfil ativo precisa de ao menos um lugar de acesso; o desativado não', () => {
    expect(
      validarPerfilPeloCargo(perfil('xx', 'vendedor', { 'pedido.ver': {} }), semAlvos, {
        catalogo: CATALOGO,
      }).map((x) => x.codigo),
    ).toEqual(['PERFIL_SEM_ACESSO_ALGUM']);
    expect(
      validarPerfilPeloCargo(perfil('xx', 'vendedor', { 'pedido.ver': {} }, false), semAlvos, {
        catalogo: CATALOGO,
      }),
    ).toEqual([]);
  });

  it('chave fora do catálogo e código inválido são recusados', () => {
    const v = validarPerfilPeloCargo(
      perfil('X!', 'vendedor', { 'acesso.campo': {}, 'nada.disso': {} }),
      semAlvos,
      { catalogo: CATALOGO },
    );
    expect(v.map((x) => x.codigo)).toEqual(['CODIGO_INVALIDO', 'CHAVE_DESCONHECIDA']);
  });

  it('RN-CORE-02: ligar chave de módulo sem licença é recusado; a que já estava ligada fica; o Core é sempre licenciado', () => {
    const p = perfil('vv', 'vendedor', { 'acesso.campo': {}, 'pedido.ver': {}, 'meta.editar': {} });
    const licencas = new Set(['core'] as const);
    expect(
      validarPerfilPeloCargo(p, semAlvos, { catalogo: CATALOGO, licencas }).map((x) => [
        x.codigo,
        x.regra,
        x.chave,
      ]),
    ).toEqual([['PERMISSAO_SEM_LICENCA', 'RN-CORE-02', 'pedido.ver']]);
    expect(
      validarPerfilPeloCargo(p, semAlvos, { catalogo: CATALOGO, licencas, antes: { 'pedido.ver': {} } }),
    ).toEqual([]);
  });
});

describe('validarAcessoPeloCargo (tenant inteiro, RN-CORE-35 e RN-CORE-54)', () => {
  const admin = perfil('admin', 'administrativo', { ...GESTAO, 'dados.escopo': { nivel: 'tenant' } });
  const vend = perfil('vendedor', 'vendedor', { 'acesso.campo': {}, 'dados.escopo': { nivel: 'carteira' } });
  const base: EstadoAcessoPorCargo = {
    perfis: [admin, vend],
    usuarios: [
      { id: 'u1', ativo: true, perfil: 'admin' },
      { id: 'u2', ativo: true, perfil: 'vendedor' },
    ],
  };

  it('estado válido passa', () => {
    expect(validarAcessoPeloCargo({ antes: base, depois: base, atorId: 'u1' })).toEqual([]);
  });

  it('sempre um admin ativo: a gestão do acesso completa em pelo menos um usuário ativo', () => {
    const semGerir = perfil('admin', 'administrativo', {
      'acesso.bko': {},
      'usuario.criar': {},
      'usuario.editar': {},
      'usuario.desativar': {},
    });
    const v = validarAcessoPeloCargo({ antes: base, depois: { ...base, perfis: [semGerir, vend] } });
    expect(v.map((x) => x.codigo)).toEqual(['ULTIMO_ADMIN']);
    const inativo = validarAcessoPeloCargo({
      depois: { ...base, usuarios: [{ id: 'u1', ativo: false, perfil: 'admin' }, base.usuarios[1]!] },
    });
    expect(inativo.map((x) => x.codigo)).toEqual(['ULTIMO_ADMIN']);
    const so = (cargo: Cargo) =>
      validarAcessoPeloCargo({
        depois: {
          perfis: [perfil('g', cargo, { ...GESTAO, 'acesso.gestao': {} })],
          usuarios: [{ id: 'g1', ativo: true, perfil: 'g' }],
        },
      }).map((x) => x.codigo);
    expect(so('gerente')).not.toContain('ULTIMO_ADMIN');
    expect(so('supervisor')).toContain('ULTIMO_ADMIN');
  });

  it('autogestão: quem tem a gestão não a tira de si, nem pelo perfil nem trocando de perfil', () => {
    const outro = perfil('admin2', 'administrativo', { ...GESTAO });
    const antes: EstadoAcessoPorCargo = {
      perfis: [admin, outro, vend],
      usuarios: [...base.usuarios, { id: 'u3', ativo: true, perfil: 'admin2' }],
    };
    const trocou = {
      ...antes,
      usuarios: [
        { id: 'u1', ativo: true, perfil: 'vendedor' },
        base.usuarios[1]!,
        { id: 'u3', ativo: true, perfil: 'admin2' },
      ],
    };
    expect(validarAcessoPeloCargo({ antes, depois: trocou, atorId: 'u1' }).map((x) => x.codigo)).toEqual([
      'AUTOGESTAO',
    ]);
    expect(validarAcessoPeloCargo({ antes, depois: trocou, atorId: 'u3' })).toEqual([]);
  });

  it('perfil com usuários não é apagado, desativado nem muda de cargo; sem usuários pode', () => {
    const apagou = validarAcessoPeloCargo({ antes: base, depois: { ...base, perfis: [admin] } });
    expect(apagou.map((x) => [x.codigo, x.perfil])).toEqual([['PERFIL_EM_USO', 'vendedor']]);
    const desativou = validarAcessoPeloCargo({
      antes: base,
      depois: { ...base, perfis: [admin, { ...vend, ativo: false }] },
    });
    expect(desativou.map((x) => x.codigo)).toEqual(['PERFIL_EM_USO']);
    const cargo = validarAcessoPeloCargo({
      antes: base,
      depois: { ...base, perfis: [admin, { ...vend, cargo: 'promotor' }] },
    });
    expect(cargo.map((x) => x.codigo)).toEqual(['CARGO_EM_USO']);
    const livre = perfil('livre', 'vendedor', { 'acesso.campo': {} });
    const antes = { ...base, perfis: [...base.perfis, livre] };
    expect(
      validarAcessoPeloCargo({
        antes,
        depois: { ...base, perfis: [...base.perfis, { ...livre, cargo: 'promotor' as const }] },
      }),
    ).toEqual([]);
    expect(validarAcessoPeloCargo({ antes, depois: base })).toEqual([]);
  });

  it('RN-CORE-54: todo usuário com um perfil vivo e ativo; códigos únicos', () => {
    const v = validarAcessoPeloCargo({
      depois: {
        perfis: [admin, admin],
        usuarios: [
          base.usuarios[0]!,
          { id: 'u9', ativo: true, perfil: null },
          { id: 'u8', ativo: false, perfil: 'sumiu' },
        ],
      },
    });
    expect(v.map((x) => [x.codigo, x.regra])).toEqual([
      ['CODIGO_REPETIDO', 'RN-CORE-35'],
      ['USUARIO_SEM_PERFIL', 'RN-CORE-54'],
      ['PERFIL_INDISPONIVEL', 'RN-CORE-54'],
    ]);
  });
});

describe('perfilDeCompatibilidade (ADR 0073 §2.8)', () => {
  it('cargo de campo e de gestão = o mesmo nome; administrativo pela gestão e pelas chaves de analista', () => {
    for (const c of ['vendedor', 'promotor', 'supervisor', 'gerente'] as const)
      expect(perfilDeCompatibilidade(c, {})).toBe(c);
    expect(perfilDeCompatibilidade('administrativo', GESTAO)).toBe('admin');
    expect(perfilDeCompatibilidade('administrativo', { 'acesso.bko': {}, 'carteira.editar': {} })).toBe(
      'analista',
    );
    expect(perfilDeCompatibilidade('administrativo', { 'acesso.bko': {}, 'pedido.aprovar': {} })).toBe(
      'analista',
    );
    expect(perfilDeCompatibilidade('administrativo', { 'acesso.bko': {} })).toBe('assistente');
  });
});
