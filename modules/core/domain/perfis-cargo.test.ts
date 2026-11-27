import { describe, expect, it } from 'vitest';
import { modelosDePerfil, type DefinicaoChave } from '@macuxi/platform-sdk';
import {
  aplicarCopiarDe,
  conferirTravaOtimista,
  ehAutogestao,
  montarModelos,
  mudancasDoHistorico,
  soValeNoBko,
  diffConcessoes,
  montarCatalogoPorArea,
  montarDetalheV2,
  moduloLicenciado,
  nomeJaUsado,
  ondeEntraPeloCargo,
  permissoesDoCorpo,
  valorDaConcessao,
  violacoesNovas,
} from './perfis-cargo';

const modelos = modelosDePerfil([]);
const cat: DefinicaoChave[] = [
  { chave: 'acesso.bko', area: 'acesso', modulo: 'core', descricao: 'BKO' },
  { chave: 'dados.escopo', area: 'dados', modulo: 'core', descricao: 'Escopo', nivel: 'escopo' },
  { chave: 'pesquisa.responder', area: 'pesquisa', modulo: 'pesquisa', descricao: 'Responder' },
] as DefinicaoChave[];

describe('catálogo por área (RN-CORE-02, RN-CORE-35)', () => {
  it('RN-CORE-35: agrupa por área na ordem do catálogo e rotula', () => {
    const r = montarCatalogoPorArea(cat, new Set(['core', 'pesquisa']), 3);
    expect(r.versao).toBe(3);
    expect(r.areas.map((a) => a.area)).toEqual(['acesso', 'dados', 'pesquisa']);
    expect(r.areas[0]!.rotulo).toBeTruthy();
    expect(r.areas[1]!.chaves[0]).toMatchObject({ nivel: 'escopo', alvos: false, disponivel: true, motivo: null });
  });
  it('RN-CORE-35: chave de módulo sem licença vem indisponível com o motivo; o Core é sempre licenciado', () => {
    const r = montarCatalogoPorArea(cat, new Set(), 1);
    expect(r.areas.find((a) => a.area === 'pesquisa')!.chaves[0]).toMatchObject({ disponivel: false, motivo: 'MODULO_SEM_LICENCA' });
    expect(r.areas[0]!.chaves[0]!.disponivel).toBe(true);
  });
});

describe('copiar de (RN-CORE-35)', () => {
  it('RN-CORE-35: copia as permissões de um modelo, sem vínculo com a origem', () => {
    const r = aplicarCopiarDe({ modelo: 'vendedor' }, 'vendedor', { modelos, perfis: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.permissoes).toEqual(modelos.vendedor.permissoes);
      expect(r.permissoes).not.toBe(modelos.vendedor.permissoes);
    }
  });
  it('RN-CORE-35: a origem não é mutada pela cópia (nem pelo teto do cargo)', () => {
    const perfis = [{ codigo: 'g', permissoes: { 'acesso.campo': {}, 'pedido.criar': {}, 'dados.escopo': { nivel: 'tenant' as const } } }];
    const antes = JSON.stringify(perfis);
    aplicarCopiarDe({ perfil: 'g' }, 'promotor', { modelos, perfis });
    expect(JSON.stringify(perfis)).toBe(antes);
  });
  it('RN-PRO-01: copiar perfil com pedido.criar para o cargo promotor não leva a escrita de pedido', () => {
    const perfis = [{ codigo: 'v', permissoes: { 'acesso.campo': {}, 'pedido.criar': {} } }];
    const r = aplicarCopiarDe({ perfil: 'v' }, 'promotor', { modelos, perfis });
    expect(r).toEqual({ ok: true, permissoes: { 'acesso.campo': {} } });
  });
  it('RN-CORE-33: copiar o modelo supervisor para o cargo vendedor não leva acesso.gestao nem acesso ao BKO', () => {
    const r = aplicarCopiarDe({ modelo: 'supervisor' }, 'vendedor', { modelos, perfis: [] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.permissoes['acesso.gestao']).toBeUndefined();
      expect(r.permissoes['acesso.bko']).toBeUndefined();
    }
  });
  it('RN-CORE-04: o escopo acima do teto do cargo desce ao teto', () => {
    const perfis = [{ codigo: 'g', permissoes: { 'acesso.campo': {}, 'dados.escopo': { nivel: 'tenant' as const } } }];
    const r = aplicarCopiarDe({ perfil: 'g' }, 'vendedor', { modelos, perfis });
    expect(r).toEqual({ ok: true, permissoes: { 'acesso.campo': {}, 'dados.escopo': { nivel: 'carteira' } } });
  });
  it('RN-CORE-35: copia de um perfil do tenant e recusa perfil inexistente', () => {
    const perfis = [{ codigo: 'a', cargo: 'vendedor' as const, ativo: true, permissoes: { 'acesso.campo': {} } }];
    expect(aplicarCopiarDe({ perfil: 'a' }, 'vendedor', { modelos, perfis })).toEqual({ ok: true, permissoes: { 'acesso.campo': {} } });
    expect(aplicarCopiarDe({ perfil: 'x' }, 'vendedor', { modelos, perfis })).toEqual({ ok: false, codigo: 'PERFIL_NAO_ENCONTRADO' });
  });
});

describe('trava otimista (RN-CORE-35)', () => {
  it('RN-CORE-35: igual passa; diferente vira 409 PERFIL_ALTERADO', () => {
    expect(conferirTravaOtimista('2026-11-25T10:00:00.000Z', '2026-11-25T10:00:00Z')).toEqual({ ok: true });
    expect(conferirTravaOtimista('2026-11-25T10:00:01.000Z', '2026-11-25T10:00:00.000Z')).toEqual({ ok: false, status: 409, codigo: 'PERFIL_ALTERADO' });
  });
});

// ---------------------------------------------------------------- E4b: montagem do detalhe, diferença e violações novas
const catV2 = [
  { chave: 'acesso.bko', area: 'acesso', modulo: 'core', descricao: 'BKO' },
  { chave: 'acesso.campo', area: 'acesso', modulo: 'core', descricao: 'Campo' },
  { chave: 'perfil.gerir', area: 'acesso', modulo: 'core', descricao: 'Perfis' },
  { chave: 'dados.escopo', area: 'dados', modulo: 'core', descricao: 'Escopo', nivel: 'escopo' },
  { chave: 'senha.redefinir', area: 'usuarios', modulo: 'core', descricao: 'Senha', alvos: true },
  { chave: 'pedido.criar', area: 'pedidos', modulo: 'vendedor', descricao: 'Criar pedido' },
  { chave: 'pesquisa.responder', area: 'pesquisa', modulo: 'pesquisa', descricao: 'Responder' },
] as DefinicaoChave[];

describe('detalhe do perfil pelo cargo (RN-CORE-33, RN-PRO-01, RN-CORE-04, RN-CORE-02)', () => {
  const base = { codigo: 'promo', nome: 'Promo', descricao: null, cargo: 'promotor' as const, ativo: true, usuarios: 2, atualizado_em: '2026-11-25T10:00:00.000Z' };

  it('RN-PRO-01: no cargo promotor, toda chave de escrita de pedido sai com o cadeado; a leitura segue livre', () => {
    const d = montarDetalheV2({ ...base, permissoes: { 'acesso.campo': {} }, catalogo: catV2, licencas: new Set(['core', 'vendedor']), perfisAtivos: [] });
    const pedido = d.permissoes.find((p) => p.chave === 'pedido.criar')!;
    expect(pedido.concedida).toBe(false);
    expect(pedido.trava).toMatchObject({ regra: 'RN-PRO-01' });
    expect(d.permissoes.find((p) => p.chave === 'acesso.campo')!.trava).toBeNull();
  });

  it('RN-CORE-33: vendedor tem acesso.bko travado; o portal e a gestão do acesso contam para o cadeado', () => {
    const d = montarDetalheV2({ ...base, cargo: 'vendedor', permissoes: { 'acesso.campo': {} }, catalogo: catV2, licencas: new Set(['core']), perfisAtivos: [] });
    expect(d.permissoes.find((p) => p.chave === 'acesso.bko')!.trava).toMatchObject({ regra: 'RN-CORE-33' });
    expect(d.perfil.onde_entra).toEqual(['campo']);
  });

  it('RN-CORE-04: o teto do escopo vem do cargo', () => {
    expect(montarDetalheV2({ ...base, cargo: 'supervisor', permissoes: {}, catalogo: catV2, licencas: new Set(), perfisAtivos: [] }).teto_escopo).toBe('equipe');
    expect(montarDetalheV2({ ...base, cargo: 'administrativo', permissoes: {}, catalogo: catV2, licencas: new Set(), perfisAtivos: [] }).teto_escopo).toBe('tenant');
  });

  it('RN-CORE-02: chave de módulo sem licença sai indisponível e guarda o valor concedido', () => {
    const d = montarDetalheV2({ ...base, cargo: 'vendedor', permissoes: { 'acesso.campo': {}, 'pesquisa.responder': {} }, catalogo: catV2, licencas: new Set(['core']), perfisAtivos: [] });
    expect(d.permissoes.find((p) => p.chave === 'pesquisa.responder')).toMatchObject({ concedida: true, disponivel: false });
    expect(d.modulos).toEqual([]);
  });

  it('RN-CORE-34: os alvos possíveis da senha não incluem quem tem perfil.gerir', () => {
    const d = montarDetalheV2({
      ...base,
      cargo: 'administrativo',
      permissoes: {},
      catalogo: catV2,
      licencas: new Set(),
      perfisAtivos: [
        { codigo: 'admin', nome: 'Admin', cargo: 'administrativo', permissoes: { 'perfil.gerir': {}, 'acesso.bko': {} } },
        { codigo: 'vend', nome: 'Vend', cargo: 'vendedor', permissoes: { 'acesso.campo': {} } },
      ],
    });
    expect(d.alvos_possiveis.map((a) => a.codigo)).toEqual(['vend']);
  });

  it('RN-CORE-35: onde_entra não conta o acesso que o cargo trava', () => {
    expect(ondeEntraPeloCargo('vendedor', { 'acesso.campo': {}, 'acesso.bko': {} })).toEqual(['campo']);
    expect(ondeEntraPeloCargo('gerente', { 'acesso.gestao': {}, 'acesso.bko': {} })).toEqual(['gestao', 'bko']);
  });
});

describe('corpo e diferença (RN-CORE-35)', () => {
  it('RN-CORE-35: o conjunto enviado vira o mapa de concessões; repetição da chave vale a última', () => {
    expect(permissoesDoCorpo([{ chave: 'a.b' }, { chave: 'dados.escopo', nivel: 'equipe' }, { chave: 'a.b', nivel: null }])).toEqual({ 'a.b': {}, 'dados.escopo': { nivel: 'equipe' } });
  });
  it('RN-CORE-35: a diferença lista o que entrou, saiu e mudou; igual não tem diferença', () => {
    const antes = { 'a.b': {}, 'c.d': { nivel: 'carteira' as const }, 'e.f': {} };
    const depois = { 'a.b': {}, 'c.d': { nivel: 'equipe' as const }, 'g.h': {} };
    expect(diffConcessoes(antes, depois)).toEqual({ entrou: ['g.h'], saiu: ['e.f'], mudou: ['c.d'] });
    expect(diffConcessoes(antes, antes)).toEqual({ entrou: [], saiu: [], mudou: [] });
  });
  it('RN-CORE-35: a violação que já existia no estado gravado não segura a escrita de outro perfil; a do perfil escrito sempre segura', () => {
    const v = (codigo: string, perfil: string) => ({ codigo, regra: 'RN-CORE-35', mensagem: 'm', perfil }) as never;
    const antes = [v('PERFIL_SEM_ACESSO_ALGUM', 'velho')];
    const depois = [v('PERFIL_SEM_ACESSO_ALGUM', 'velho'), v('PERFIL_SEM_ACESSO_ALGUM', 'novo'), v('ESCOPO_ACIMA_DO_CARGO', 'velho')];
    expect(violacoesNovas(antes, depois, 'novo').map((x) => `${x.codigo}:${x.perfil}`)).toEqual(['PERFIL_SEM_ACESSO_ALGUM:novo', 'ESCOPO_ACIMA_DO_CARGO:velho']);
    expect(violacoesNovas(antes, depois, 'velho')).toHaveLength(3);
  });
});

describe('RN-CORE-35: nome repetido e valores da concessão', () => {
  const perfis = [
    { id: 'a', nome: 'Vendedor Externo', ativo: true },
    { id: 'b', nome: 'Antigo', ativo: false },
  ];
  it('RN-CORE-35: nome repetido entre os ativos (sem caixa), ignorando o próprio perfil', () => {
    expect(nomeJaUsado(perfis, '  vendedor externo ')).toBe(true);
    expect(nomeJaUsado(perfis, 'Vendedor Externo', 'a')).toBe(false);
    expect(nomeJaUsado(perfis, 'antigo')).toBe(false);
  });
  it('RN-CORE-35: valorDaConcessao só leva nível e alvos que existem', () => {
    expect(valorDaConcessao(null, null)).toEqual({});
    expect(valorDaConcessao('equipe', ['x'])).toEqual({ nivel: 'equipe', alvos: ['x'] });
  });
  it('RN-CORE-02: moduloLicenciado — o core é sempre licenciado', () => {
    expect(moduloLicenciado('core', new Set())).toBe(true);
    expect(moduloLicenciado('vendedor', new Set())).toBe(false);
    expect(moduloLicenciado('vendedor', new Set(['vendedor'] as never))).toBe(true);
  });
});

describe('ADR 0073 E6: modelos, só BKO, autogestão e histórico', () => {
  it('RN-CORE-35: os 7 modelos vêm na ordem, com cargo, onde entra e sem as chaves fixas do aparelho', () => {
    const r = montarModelos(modelosDePerfil([]), new Set(['notificacao.ler']));
    expect(r.itens.map((m) => m.modelo)).toEqual(['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin']);
    expect(r.itens.find((m) => m.modelo === 'admin')!.onde_entra).toContain('bko');
    expect(r.itens.find((m) => m.modelo === 'vendedor')!.onde_entra).not.toContain('bko');
    expect(r.itens.flatMap((m) => m.permissoes.map((p) => p.chave))).not.toContain('notificacao.ler');
  });
  it('RN-PRO-01: o modelo promotor não traz escrita de pedido', () => {
    const p = montarModelos(modelosDePerfil([]), new Set()).itens.find((m) => m.modelo === 'promotor')!.permissoes.map((x) => x.chave);
    expect(p).not.toContain('pedido.criar');
    expect(p).not.toContain('pedido.editar');
  });
  it('ADR 0073 §2.5.10: a chave de tela do BKO é marcada; a do app, não', () => {
    expect(soValeNoBko('perfil.gerir')).toBe(true);
    expect(soValeNoBko('parametro.inicio')).toBe(true);
    expect(soValeNoBko('pedido.criar')).toBe(false);
    expect(soValeNoBko('acesso.bko')).toBe(false);
    const r = montarCatalogoPorArea([...cat, { chave: 'perfil.gerir', area: 'usuarios', modulo: 'core', descricao: 'Perfis' } as DefinicaoChave], new Set(['core']), 3);
    expect(r.areas.flatMap((a) => a.chaves).find((c) => c.chave === 'perfil.gerir')!.so_bko).toBe(true);
    expect(r.areas.flatMap((a) => a.chaves).find((c) => c.chave === 'dados.escopo')!.so_bko).toBe(false);
  });
  it('RN-CORE-35: autogestão = o perfil de quem está logado e que tem a gestão do acesso', () => {
    const gestao = { 'acesso.bko': {}, 'perfil.gerir': {}, 'usuario.criar': {}, 'usuario.editar': {}, 'usuario.desativar': {} };
    expect(ehAutogestao('admin', gestao, 'admin')).toBe(true);
    expect(ehAutogestao('gestor_x', gestao, 'admin')).toBe(false);
    expect(ehAutogestao('admin', gestao, null)).toBe(false);
    expect(ehAutogestao('admin', { 'acesso.bko': {} }, 'admin')).toBe(false);
  });
  it('RN-AUD-01: a diferença do histórico sai de antes.permissoes e depois.permissoes (entrou, saiu, mudou)', () => {
    const m = mudancasDoHistorico(
      { permissoes: { 'pedido.criar': {}, 'dados.escopo': { nivel: 'carteira' } } },
      { permissoes: { 'pedido.ver': {}, 'dados.escopo': { nivel: 'equipe' } } },
    );
    expect(m).toEqual([
      { chave: 'dados.escopo', de: { nivel: 'carteira', alvos: null }, para: { nivel: 'equipe', alvos: null } },
      { chave: 'pedido.criar', de: { nivel: null, alvos: null }, para: null },
      { chave: 'pedido.ver', de: null, para: { nivel: null, alvos: null } },
    ]);
  });
  it('RN-AUD-01: o histórico de criação (lista de chaves) e o sem permissões não quebram', () => {
    expect(mudancasDoHistorico(null, { permissoes: ['a.b', 'c.d'] }).map((x) => x.chave)).toEqual(['a.b', 'c.d']);
    expect(mudancasDoHistorico({ nome: 'x' }, { nome: 'y' })).toEqual([]);
  });
});
