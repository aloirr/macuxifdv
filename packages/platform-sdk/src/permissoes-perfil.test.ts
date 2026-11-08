/**
 * Motor de permissões por perfil (ADR 0033; T-0111/T-0112): padrão de fábrica, sobreposições do tenant, multiperfil e os
 * limites travados do doc 03 §2 (RN-CORE-33, RN-PRO-01, RN-CORE-04, RN-CORE-01, último admin e autogestão).
 */
import { describe, expect, it } from 'vitest';
import { verificarAcesso } from './acesso';
import { defineModule } from './manifesto';
import { modulosEfetivos, uniaoDosModulosDosPerfis } from './modulos-efetivos';
import { PERFIS, type Perfil } from './nomes';
import { PERFIS_DO_APP } from './perfis';
import { criarPermissoes, verificarAcao } from './permissoes';
import {
  ALVO_TODOS,
  catalogoDePermissoes,
  chavesPermitidas,
  combinarPerfis,
  escopoDosPerfis,
  matrizDeFabrica,
  nivelPermitido,
  pode,
  podeEntrar,
  perfilDeFabrica,
  resolverPerfil,
  temPerfilDeBase,
  travaDaChave,
  validarAcessoDoTenant,
  validarPerfil,
  type EstadoAcessoTenant,
  type PerfilDeAcesso,
  type SobreposicaoPermissao,
  type UsuarioDoAcesso,
} from './permissoes-perfil';

const TODOS = [...PERFIS];
const core = defineModule({
  id: 'core',
  versao: '1.0.0',
  perfis: TODOS,
  acoes: {
    'meta.editar': { perfis: ['supervisor', 'gerente', 'analista', 'admin'] },
    'carteira.editar': { perfis: ['analista', 'admin'] },
    'motivo.editar': { perfis: ['analista', 'admin'] },
  },
});
const vendedor = defineModule({
  id: 'vendedor',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  acoes: {
    'pedido.ver': { perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin', 'promotor'] },
    'pedido.criar': { perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] },
    'pedido.cancelar': { perfis: ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] },
    'pedido.aprovar': { perfis: ['supervisor', 'gerente', 'analista'] },
  },
});
const promotor = defineModule({
  id: 'promotor',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['promotor', 'supervisor', 'gerente', 'analista', 'admin'],
  acoes: { 'coleta.registrar': { perfis: ['promotor'] }, 'mix_obrigatorio.gerenciar': { perfis: ['analista', 'admin'] } },
});
const MANIFESTOS = [core, vendedor, promotor];
const MATRIZ = matrizDeFabrica(MANIFESTOS);
const CATALOGO = catalogoDePermissoes(MANIFESTOS);

const fabrica = (base: Perfil) => resolverPerfil(perfilDeFabrica(base), MATRIZ);
const personalizado = (codigo: string, base: Perfil, sobreposicoes: SobreposicaoPermissao[] = [], ativo = true): PerfilDeAcesso => ({
  codigo,
  base,
  ativo,
  fabrica: false,
  sobreposicoes,
});
const alvo = (...bases: Perfil[]) => ({ proprio: false, perfis: bases.map((b) => ({ codigo: b, base: b })) });

describe('padrão de fábrica (doc 03 §2; ADR 0033)', () => {
  it('as ações dos manifestos entram pelo `perfis` de cada uma, e as chaves da plataforma pela fábrica do SDK', () => {
    expect(MATRIZ.vendedor['pedido.criar']).toEqual({});
    expect(MATRIZ.promotor['pedido.ver']).toEqual({});
    expect(MATRIZ.promotor['pedido.criar']).toBeUndefined();
    expect(MATRIZ.admin['perfil.gerir']).toEqual({});
    expect(MATRIZ.admin['senha.redefinir']).toEqual({ alvos: [ALVO_TODOS] });
    expect(MATRIZ.gerente['dados.escopo']).toEqual({ nivel: 'equipes_abaixo' });
  });

  it('P2: só o admin cria, edita e desativa usuários, redefine senha e gere perfis', () => {
    for (const chave of ['usuario.criar', 'usuario.editar', 'usuario.desativar', 'senha.redefinir', 'perfil.gerir']) {
      expect(PERFIS.filter((p) => pode([fabrica(p)], chave))).toEqual(['admin']);
    }
  });

  it('onde entra: os apps de cada perfil; o BKO sem o supervisor (RN-CORE-33); o portal só o admin', () => {
    const quem = (lugar: 'campo' | 'gestao' | 'bko' | 'portal') => PERFIS.filter((p) => podeEntrar([fabrica(p)], lugar));
    expect(quem('campo')).toEqual([...PERFIS_DO_APP.campo]);
    expect(quem('gestao')).toEqual([...PERFIS_DO_APP.gestao]);
    expect(quem('bko')).toEqual(PERFIS_DO_APP.web.filter((p) => p !== 'supervisor').sort((a, b) => PERFIS.indexOf(a) - PERFIS.indexOf(b)));
    expect(quem('portal')).toEqual(['admin']);
  });

  it('RN-CORE-04: escopo de dados de fábrica por perfil', () => {
    expect(PERFIS.map((p) => escopoDosPerfis([fabrica(p)]))).toEqual(['carteira', 'carteira', 'equipe', 'equipes_abaixo', 'tenant', 'tenant', 'tenant']);
    expect(escopoDosPerfis([])).toBe('carteira');
    expect(escopoDosPerfis(undefined)).toBe('carteira');
  });

  it('manifesto que declara chave da plataforma é recusado', () => {
    const intruso = defineModule({ id: 'gestor', versao: '1.0.0', depende: ['core'], perfis: ['admin'], acoes: { 'perfil.gerir': { perfis: ['admin'] } } });
    expect(() => matrizDeFabrica([core, intruso])).toThrow(/chave da plataforma/);
    expect(() => criarPermissoes([core, intruso])).toThrow(/chave da plataforma/);
  });

  it('catálogo agrupa por área: plataforma primeiro, ações dos módulos na área do módulo (Core pela entidade)', () => {
    const area = (chave: string) => CATALOGO.find((d) => d.chave === chave)?.area;
    expect(area('acesso.bko')).toBe('acesso');
    expect(area('senha.redefinir')).toBe('usuarios');
    expect(area('pedido.criar')).toBe('pedidos');
    expect(area('coleta.registrar')).toBe('trade');
    expect(area('meta.editar')).toBe('metas');
    expect(area('carteira.editar')).toBe('clientes');
    expect(area('motivo.editar')).toBe('administracao');
    expect(CATALOGO[0]?.area).toBe('acesso');
  });
});

describe('perfil resolvido: sobreposições do tenant e limites travados do perfil', () => {
  it('o tenant tira e dá chaves; o resto segue a fábrica da base (perfil personalizado herda)', () => {
    const coord = resolverPerfil(
      personalizado('coordenador', 'supervisor', [
        { chave: 'pedido.aprovar', concedida: false },
        { chave: 'carteira.editar', concedida: true },
      ]),
      MATRIZ,
    );
    expect(pode([coord], 'pedido.aprovar')).toBe(false);
    expect(pode([coord], 'carteira.editar')).toBe(true);
    expect(pode([coord], 'pedido.criar')).toBe(true);
    expect(podeEntrar([coord], 'gestao')).toBe(true);
    expect(coord.base).toBe('supervisor');
  });

  it('RN-CORE-33: perfil derivado de vendedor, promotor ou supervisor nunca entra no BKO nem no portal, mesmo concedido', () => {
    for (const base of ['vendedor', 'promotor', 'supervisor'] as const) {
      const p = resolverPerfil(personalizado('x_' + base, base, [{ chave: 'acesso.bko', concedida: true }, { chave: 'acesso.portal', concedida: true }]), MATRIZ);
      expect(podeEntrar([p], 'bko')).toBe(false);
      expect(podeEntrar([p], 'portal')).toBe(false);
    }
    const analista = resolverPerfil(personalizado('analista_portal', 'analista', [{ chave: 'acesso.portal', concedida: true }]), MATRIZ);
    expect(podeEntrar([analista], 'portal')).toBe(false);
  });

  it('RN-PRO-01: perfil de base promotor nunca escreve pedido, mesmo concedido; a leitura segue editável', () => {
    const p = resolverPerfil(personalizado('promotor_mais', 'promotor', [{ chave: 'pedido.criar', concedida: true }, { chave: 'pedido.ver', concedida: false }]), MATRIZ);
    expect(pode([p], 'pedido.criar')).toBe(false);
    expect(pode([p], 'pedido.ver')).toBe(false);
    expect(pode([fabrica('promotor')], 'pedido.ver')).toBe(true);
  });

  it('RN-CORE-04: o escopo herda o da base e só reduz (acima vira o da base; nível inválido vira carteira)', () => {
    const acima = resolverPerfil(personalizado('sup_tenant', 'supervisor', [{ chave: 'dados.escopo', concedida: true, nivel: 'tenant' }]), MATRIZ);
    expect(escopoDosPerfis([acima])).toBe('equipe');
    const menor = resolverPerfil(personalizado('ger_equipe', 'gerente', [{ chave: 'dados.escopo', concedida: true, nivel: 'equipe' }]), MATRIZ);
    expect(escopoDosPerfis([menor])).toBe('equipe');
    const invalido = resolverPerfil(personalizado('adm_x', 'admin', [{ chave: 'dados.escopo', concedida: true, nivel: 'acima_alcada' }]), MATRIZ);
    expect(escopoDosPerfis([invalido])).toBe('carteira');
  });

  it('travaDaChave: o cadeado da página com a regra', () => {
    expect(travaDaChave('vendedor', 'acesso.bko')).toEqual({ regra: 'RN-CORE-33', mensagem: 'Vendedor nunca entra no BKO (RN-CORE-33).' });
    expect(travaDaChave('gerente', 'acesso.portal')?.regra).toBe('RN-CORE-33');
    expect(travaDaChave('promotor', 'pedido.cancelar')?.regra).toBe('RN-PRO-01');
    expect(travaDaChave('promotor', 'pedido.ver')).toBeNull();
    expect(travaDaChave('gerente', 'acesso.bko')).toBeNull();
    expect(travaDaChave('admin', 'acesso.portal')).toBeNull();
  });
});

describe('multiperfil (RN-CORE-01; T-0112): união, com os limites travados pela regra mais restritiva', () => {
  it('vendedor + promotor: soma as ações, mas RN-PRO-01 vale porque um dos perfis é promotor', () => {
    const vp = [fabrica('vendedor'), fabrica('promotor')];
    expect(pode(vp, 'coleta.registrar')).toBe(true);
    expect(pode(vp, 'pedido.ver')).toBe(true);
    expect(pode(vp, 'pedido.criar')).toBe(false);
    expect(temPerfilDeBase(vp, 'promotor')).toBe(true);
  });

  it('RN-CORE-33: analista + vendedor não entra no BKO; admin + analista não entra no portal', () => {
    expect(podeEntrar([fabrica('analista'), fabrica('vendedor')], 'bko')).toBe(false);
    expect(podeEntrar([fabrica('analista'), fabrica('vendedor')], 'campo')).toBe(true);
    expect(podeEntrar([fabrica('admin'), fabrica('analista')], 'portal')).toBe(false);
    expect(podeEntrar([fabrica('admin'), fabrica('analista')], 'bko')).toBe(true);
  });

  it('nível: vale o mais alto entre os perfis; alvos: somados', () => {
    expect(escopoDosPerfis([fabrica('vendedor'), fabrica('supervisor')])).toBe('equipe');
    expect(nivelPermitido([fabrica('vendedor'), fabrica('gerente')], 'dados.escopo')).toBe('equipes_abaixo');
    expect(nivelPermitido([fabrica('vendedor')], 'pedido.criar')).toBeNull();
    const a = resolverPerfil(personalizado('rh', 'analista', [{ chave: 'senha.redefinir', concedida: true, alvos: ['vendedor'] }]), MATRIZ);
    const b = resolverPerfil(personalizado('rh2', 'analista', [{ chave: 'senha.redefinir', concedida: true, alvos: ['promotor'] }]), MATRIZ);
    expect(combinarPerfis([a, b])['senha.redefinir']).toEqual({ alvos: ['promotor', 'vendedor'] });
    expect(combinarPerfis([a, fabrica('admin')])['senha.redefinir']).toEqual({ alvos: [ALVO_TODOS] });
  });

  it('sem perfil, nada (falha fechada)', () => {
    expect(pode([], 'pedido.ver')).toBe(false);
    expect(pode(undefined, 'pedido.ver')).toBe(false);
    expect(chavesPermitidas(null)).toEqual([]);
  });

  it('módulos: união dos módulos dos perfis ∩ tenant − exceções (a exceção só remove)', () => {
    const doPerfil = uniaoDosModulosDosPerfis([
      ['core', 'vendedor'],
      ['core', 'promotor'],
    ]);
    expect(doPerfil).toEqual(['core', 'vendedor', 'promotor']);
    const ef = modulosEfetivos({ manifestos: MANIFESTOS, ativosNoTenant: ['core', 'vendedor', 'promotor'], doPerfil, removidosDoUsuario: ['vendedor'] });
    expect(ef).toEqual(['core', 'promotor']);
  });
});

describe('senha.redefinir com alvo (P7; doc 03 §2)', () => {
  const admin = [fabrica('admin')];

  it('o admin redefine a de todos os perfis, menos admin e a própria', () => {
    for (const b of ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente'] as const) expect(pode(admin, 'senha.redefinir', alvo(b))).toBe(true);
    expect(pode(admin, 'senha.redefinir', alvo('admin'))).toBe(false);
    expect(pode(admin, 'senha.redefinir', { proprio: true, perfis: [{ codigo: 'vendedor', base: 'vendedor' }] })).toBe(false);
  });

  it('alvo com vários perfis: todos precisam estar na lista e nenhum de base admin; alvo sem perfil = não', () => {
    expect(pode(admin, 'senha.redefinir', alvo('vendedor', 'admin'))).toBe(false);
    const rh = [resolverPerfil(personalizado('rh', 'analista', [{ chave: 'senha.redefinir', concedida: true, alvos: ['vendedor'] }]), MATRIZ)];
    expect(pode(rh, 'senha.redefinir', alvo('vendedor'))).toBe(true);
    expect(pode(rh, 'senha.redefinir', alvo('vendedor', 'promotor'))).toBe(false);
    expect(pode(rh, 'senha.redefinir', alvo())).toBe(false);
    expect(pode(rh, 'senha.redefinir')).toBe(true);
  });

  it('usuario.desativar nunca no próprio; usuario.editar sim', () => {
    expect(pode(admin, 'usuario.desativar', { proprio: true, perfis: [{ codigo: 'admin', base: 'admin' }] })).toBe(false);
    expect(pode(admin, 'usuario.editar', { proprio: true, perfis: [{ codigo: 'admin', base: 'admin' }] })).toBe(true);
  });
});

describe('criarPermissoes e verificarAcao com os perfis da requisição (ADR 0033 sobre a ADR 0004)', () => {
  const perms = criarPermissoes(MANIFESTOS);
  const ativos = ['core', 'vendedor', 'promotor'] as const;

  it('com os perfis de fábrica, decide igual ao manifesto em todas as ações e perfis', () => {
    const acoes = MANIFESTOS.flatMap((m) => Object.keys(m.acoes));
    for (const perfil of PERFIS) {
      for (const acao of acoes) {
        expect([perfil, acao, perms.pode(acao, { perfil, perfis: [fabrica(perfil)], modulosAtivos: ativos })]).toEqual([perfil, acao, perms.pode(acao, { perfil, modulosAtivos: ativos })]);
      }
    }
  });

  it('o que o tenant mudou vale; a licença do módulo dono continua valendo', () => {
    const sem = resolverPerfil({ ...perfilDeFabrica('vendedor'), sobreposicoes: [{ chave: 'pedido.criar', concedida: false }] }, MATRIZ);
    expect(perms.pode('pedido.criar', { perfil: 'vendedor', perfis: [sem], modulosAtivos: ativos })).toBe(false);
    expect(perms.pode('pedido.criar', { perfil: 'vendedor', perfis: [fabrica('vendedor')], modulosAtivos: ['core'] })).toBe(false);
    expect(perms.conhece('usuario.criar')).toBe(true);
    expect(perms.acoesPermitidas({ perfil: 'admin', perfis: [fabrica('admin')], modulosAtivos: ativos })).not.toContain('usuario.criar');
  });

  it('verificarAcao: 403 MODULO_INATIVO antes do perfil; 403 PERFIL_SEM_ACESSO pelo motor; chave da plataforma na rota', () => {
    const u = (perfil: Perfil, perfis: ReturnType<typeof fabrica>[], modulos: readonly ('core' | 'vendedor' | 'promotor')[] = ativos) => ({ id: 'u', tenant_id: 't', perfil, modulos, perfis });
    expect(verificarAcao(u('vendedor', [fabrica('vendedor')], ['core']), perms, 'pedido.criar')).toMatchObject({ codigo: 'MODULO_INATIVO' });
    expect(verificarAcao(u('promotor', [fabrica('promotor')]), perms, 'pedido.criar')).toMatchObject({ codigo: 'PERFIL_SEM_ACESSO' });
    expect(verificarAcao(u('admin', [fabrica('admin')]), perms, 'usuario.criar')).toEqual({ ok: true });
    expect(verificarAcao(u('analista', [fabrica('analista')]), perms, 'usuario.criar')).toMatchObject({ codigo: 'PERFIL_SEM_ACESSO' });
    expect(verificarAcao(null, perms, 'usuario.criar')).toMatchObject({ status: 401 });
  });

  it('verificarAcesso (rota sem ação): basta um dos perfis base estar na lista', () => {
    const u = { id: 'u', tenant_id: 't', perfil: 'vendedor' as const, modulos: ativos, perfis: [fabrica('vendedor'), fabrica('promotor')] };
    expect(verificarAcesso(u, { modulo: 'promotor', perfis: ['promotor'] })).toEqual({ ok: true });
  });
});

describe('validação dos limites travados na escrita (domain do Core e API)', () => {
  const fabricaDoTenant = (): PerfilDeAcesso[] => PERFIS.map(perfilDeFabrica);
  const usuarios = (...xs: [string, string[], boolean?][]): UsuarioDoAcesso[] => xs.map(([id, perfis, ativo]) => ({ id, perfis, ativo: ativo ?? true }));
  const estado = (perfis: PerfilDeAcesso[], us: UsuarioDoAcesso[]): EstadoAcessoTenant => ({ perfis, usuarios: us });
  const codigos = (antes: EstadoAcessoTenant | undefined, depois: EstadoAcessoTenant, atorId?: string) =>
    validarAcessoDoTenant({ ...(antes ? { antes } : {}), depois, ...(atorId ? { atorId } : {}), matriz: MATRIZ, catalogo: CATALOGO }).map((x) => x.codigo);
  const base = estado(fabricaDoTenant(), usuarios(['a1', ['admin']], ['v1', ['vendedor', 'promotor']]));

  it('tenant de fábrica com um admin ativo: nada a recusar', () => {
    expect(codigos(undefined, base)).toEqual([]);
  });

  it('RN-CORE-01: usuário sem perfil ou com perfil inexistente/desativado', () => {
    expect(codigos(undefined, estado(fabricaDoTenant(), usuarios(['a1', ['admin']], ['v1', []])))).toEqual(['USUARIO_SEM_PERFIL']);
    const comInativo = [...fabricaDoTenant(), personalizado('coordenador', 'supervisor', [], false)];
    expect(codigos(undefined, estado(comInativo, usuarios(['a1', ['admin']], ['c1', ['coordenador']])))).toEqual(['PERFIL_INDISPONIVEL']);
    expect(codigos(undefined, estado(fabricaDoTenant(), usuarios(['a1', ['admin']], ['c1', ['fantasma']])))).toEqual(['PERFIL_INDISPONIVEL']);
  });

  it('último admin: o tenant sempre tem um admin ativo com a gestão de usuários e perfis', () => {
    expect(codigos(undefined, estado(fabricaDoTenant(), usuarios(['a1', ['admin'], false])))).toEqual(['ULTIMO_ADMIN']);
    const semGestao = fabricaDoTenant().map((p) => (p.codigo === 'admin' ? { ...p, sobreposicoes: [{ chave: 'perfil.gerir', concedida: false }] } : p));
    expect(codigos(undefined, estado(semGestao, usuarios(['a1', ['admin']])))).toEqual(['ULTIMO_ADMIN']);
    // admin que também é vendedor não entra no BKO (RN-CORE-33): não conta como o admin da empresa
    expect(codigos(undefined, estado(fabricaDoTenant(), usuarios(['a1', ['admin', 'vendedor']])))).toEqual(['ULTIMO_ADMIN']);
  });

  it('autogestão: o admin não tira de si a gestão, mesmo com outro admin na empresa', () => {
    const antes = estado(fabricaDoTenant(), usuarios(['a1', ['admin']], ['a2', ['admin']]));
    expect(codigos(antes, estado(fabricaDoTenant(), usuarios(['a1', ['analista']], ['a2', ['admin']])), 'a1')).toEqual(['AUTOGESTAO']);
    expect(codigos(antes, estado(fabricaDoTenant(), usuarios(['a1', ['admin']], ['a2', ['analista']])), 'a1')).toEqual([]);
    expect(codigos(antes, estado(fabricaDoTenant(), usuarios(['a1', ['admin'], false], ['a2', ['admin']])), 'a1')).toEqual(['AUTOGESTAO']);
    // sem ator (migração, provisionamento) não há autogestão
    expect(codigos(antes, estado(fabricaDoTenant(), usuarios(['a1', ['analista']], ['a2', ['admin']])))).toEqual([]);
  });

  it('perfis de fábrica não são apagados nem desativados; a base não muda; código único', () => {
    const semVendedor = fabricaDoTenant().filter((p) => p.codigo !== 'vendedor');
    expect(codigos(undefined, estado(semVendedor, usuarios(['a1', ['admin']])))).toEqual(['PERFIL_FABRICA_AUSENTE']);
    const antes = estado([...fabricaDoTenant(), personalizado('coordenador', 'supervisor')], usuarios(['a1', ['admin']]));
    const trocouBase = estado([...fabricaDoTenant(), personalizado('coordenador', 'gerente')], usuarios(['a1', ['admin']]));
    expect(codigos(antes, trocouBase, 'a1')).toEqual(['BASE_ALTERADA']);
    const repetido = estado([...fabricaDoTenant(), personalizado('coordenador', 'supervisor'), personalizado('coordenador', 'supervisor')], usuarios(['a1', ['admin']]));
    expect(codigos(undefined, repetido)).toEqual(['CODIGO_REPETIDO']);
  });

  it('validarPerfil: trava, escopo acima da base, valor fora do formato, chave desconhecida e alvo admin', () => {
    const bases = new Map<string, Perfil>([...PERFIS.map((p) => [p, p] as const), ['admin_regional', 'admin' as const]]);
    const erros = validarPerfil(
      personalizado('coordenador', 'supervisor', [
        { chave: 'acesso.bko', concedida: true },
        { chave: 'dados.escopo', concedida: true, nivel: 'tenant' },
        { chave: 'pedido.criar', concedida: true, nivel: 'equipe' },
        { chave: 'pedido.inventada', concedida: true },
        { chave: 'senha.redefinir', concedida: true, alvos: ['vendedor', 'admin_regional', 'fantasma'] },
        { chave: 'acesso.campo', concedida: false },
      ]),
      bases,
      CATALOGO,
    );
    expect(erros.map((e) => [e.codigo, e.regra, e.chave])).toEqual([
      ['TRAVA_DO_PERFIL', 'RN-CORE-33', 'acesso.bko'],
      ['ESCOPO_ACIMA_DA_BASE', 'RN-CORE-04', 'dados.escopo'],
      ['VALOR_INVALIDO', 'RN-CORE-35', 'pedido.criar'],
      ['CHAVE_DESCONHECIDA', 'RN-CORE-35', 'pedido.inventada'],
      ['SENHA_ALVO_INVALIDO', 'RN-CORE-35', 'senha.redefinir'],
      ['SENHA_ALVO_INVALIDO', 'RN-CORE-35', 'senha.redefinir'],
    ]);
    expect(validarPerfil(personalizado('p2', 'promotor', [{ chave: 'pedido.cancelar', concedida: true }]), bases, CATALOGO)[0]).toMatchObject({ regra: 'RN-PRO-01' });
    expect(validarPerfil({ ...perfilDeFabrica('vendedor'), codigo: 'outro' }, bases)[0]?.codigo).toBe('CODIGO_INVALIDO');
  });
});
