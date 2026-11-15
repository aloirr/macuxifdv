/**
 * Planos e licenças (ADR 0047; desenho docs/desenho/planos-e-licencas.md): RN-PLA-01 catálogo e adicionais, RN-PLA-02 tipo de
 * licença e contagem, RN-PLA-03 "por usuário" da Pesquisa e do Treinamento, RN-PLA-04 trava, RN-PLA-05 troca de plano,
 * RN-PLA-06 valor anual e teste. Os números dos planos aqui são de teste: os reais vêm do seed (dado, não código).
 */
import { describe, expect, it } from 'vitest';
import {
  conferirEscolhaDePlano,
  conferirNovoUsuario,
  conferirTrocaDePlano,
  contarLicencasEmUso,
  CriarEmpresaComPlanoSchema,
  EscolhaNaCriacaoSchema,
  FichaAssinaturaSchema,
  fimDoTeste,
  ITENS_CONTADOS,
  licencasContratadas,
  modulosDaAssinatura,
  PlanoSchema,
  rotaPortalAssinatura,
  tipoDeLicencaDoUsuario,
  TrocarPlanoSchema,
  usoPorItem,
  valorDaAssinatura,
  type ItemContado,
  type Plano,
  type SituacaoDeLicencas,
} from './planos';

const plano = (p: Partial<Plano> = {}): Plano =>
  PlanoSchema.parse({
    id: '9a000000-0000-4000-8000-000000000001',
    codigo: 'pme',
    nome: 'PME',
    ordem: 2,
    preco_mensal_centavos: 49_990,
    licencas: { vendedor: 5, gestor: 1, bko: 2, promotor: 0 },
    modulos: ['catalogo', 'vendedor', 'gestor'],
    adicionais: [
      { adicional: 'promotor', preco_unitario_centavos: 4_990 },
      { adicional: 'pesquisa', preco_unitario_centavos: 990 },
      { adicional: 'treinamento', preco_unitario_centavos: 1_490, incluidos: 2 },
    ],
    meses_gratis_anual: 2,
    dias_teste: 14,
    ativo: true,
    ...p,
  });

const zero = (): Record<ItemContado, number> => Object.fromEntries(ITENS_CONTADOS.map((i) => [i, 0])) as Record<ItemContado, number>;

describe('RN-PLA-02 tipo de licença pelo perfil de base', () => {
  it('mapa perfil → tipo: supervisor e gerente = gestor; analista, assistente e admin = BKO', () => {
    expect(tipoDeLicencaDoUsuario(['vendedor'])).toBe('vendedor');
    expect(tipoDeLicencaDoUsuario(['promotor'])).toBe('promotor');
    expect(tipoDeLicencaDoUsuario(['supervisor'])).toBe('gestor');
    expect(tipoDeLicencaDoUsuario(['gerente'])).toBe('gestor');
    for (const p of ['analista', 'assistente', 'admin'] as const) expect(tipoDeLicencaDoUsuario([p])).toBe('bko');
    expect(tipoDeLicencaDoUsuario([])).toBeNull();
  });

  it('multiperfil ocupa uma licença só, pela prioridade vendedor > gestor > promotor > bko', () => {
    expect(tipoDeLicencaDoUsuario(['admin', 'vendedor'])).toBe('vendedor');
    expect(tipoDeLicencaDoUsuario(['promotor', 'supervisor'])).toBe('gestor');
    expect(tipoDeLicencaDoUsuario(['admin', 'promotor'])).toBe('promotor');
    expect(tipoDeLicencaDoUsuario(['gerente', 'vendedor', 'promotor', 'admin'])).toBe('vendedor');
  });
});

describe('RN-PLA-02/03 contagem em uso', () => {
  it('inativo não conta; multiperfil conta uma vez; Pesquisa e Treinamento por usuário com o módulo efetivo', () => {
    const uso = contarLicencasEmUso([
      { ativo: true, bases: ['vendedor'], modulos: ['core', 'vendedor', 'pesquisa'] },
      { ativo: true, bases: ['admin', 'vendedor'], modulos: ['core', 'vendedor', 'treinamento'] },
      { ativo: true, bases: ['supervisor'], modulos: ['core', 'gestor', 'pesquisa', 'treinamento'] },
      { ativo: true, bases: ['analista'], modulos: ['core'] },
      { ativo: false, bases: ['vendedor'], modulos: ['core', 'vendedor', 'pesquisa'] },
      { ativo: true, bases: [], modulos: [] },
    ]);
    expect(uso).toEqual({ vendedor: 2, gestor: 1, bko: 1, promotor: 0, pesquisa: 2, treinamento: 2 });
  });
});

describe('RN-PLA-01 licenças contratadas e módulos', () => {
  it('plano + adicional; Pesquisa sem incluídos = só o adicional; Treinamento = incluídos + adicional', () => {
    const c = licencasContratadas(plano(), [
      { adicional: 'promotor', quantidade: 3 },
      { adicional: 'treinamento', quantidade: 5 },
    ]);
    expect(c).toEqual({ vendedor: 5, gestor: 1, bko: 2, promotor: 3, pesquisa: 0, treinamento: 7 });
  });

  it('null = sem limite (também com adicional); módulo do plano sem adicional no catálogo = sem limite', () => {
    const p = plano({ licencas: { vendedor: null, gestor: null, bko: null, promotor: null }, modulos: ['vendedor', 'pesquisa'], adicionais: [] });
    expect(licencasContratadas(p, [{ adicional: 'promotor', quantidade: 2 }])).toEqual({
      vendedor: null,
      gestor: null,
      bko: null,
      promotor: null,
      pesquisa: null,
      treinamento: 0,
    });
  });

  it('modulosDaAssinatura: core e integracao sempre, os do plano e os adicionais, na ordem de MODULOS', () => {
    expect(modulosDaAssinatura(plano({ modulos: [] }), [])).toEqual(['core', 'integracao']);
    expect(modulosDaAssinatura(plano(), [{ adicional: 'pesquisa', quantidade: 1 }])).toEqual(['core', 'catalogo', 'vendedor', 'gestor', 'pesquisa', 'integracao']);
  });

  it('conferirEscolhaDePlano: plano inativo e adicional que o plano não vende', () => {
    const p = plano({ ativo: false, adicionais: [] });
    expect(conferirEscolhaDePlano(p, [{ adicional: 'promotor', quantidade: 1 }]).map((x) => x.codigo)).toEqual(['PLANO_INATIVO', 'ADICIONAL_FORA_DO_PLANO']);
    expect(conferirEscolhaDePlano(plano(), [{ adicional: 'promotor', quantidade: 1 }])).toEqual([]);
  });
});

describe('RN-PLA-05 troca de plano', () => {
  it('abaixo do uso = PLANO_ABAIXO_DO_USO por item, com a mensagem', () => {
    const uso = { ...zero(), vendedor: 14, gestor: 2, pesquisa: 1 };
    const r = conferirTrocaDePlano(plano(), [], uso);
    expect(r.map((x) => [x.codigo, x.item])).toEqual([
      ['PLANO_ABAIXO_DO_USO', 'vendedor'],
      ['PLANO_ABAIXO_DO_USO', 'gestor'],
      ['PLANO_ABAIXO_DO_USO', 'pesquisa'],
    ]);
    // rótulo no plural (ROTULO_ITEM), quanto está em uso e quantos inativar
    expect(r.map((x) => x.mensagem)).toEqual([
      'Vendedores: 14 em uso. Inative 9 antes de trocar.',
      'Gestores: 2 em uso. Inative 1 antes de trocar.',
      'Pesquisa: 1 em uso. Inative 1 antes de trocar.',
    ]);
  });

  it('o adicional cobre o uso; uso igual ao limite passa; sem limite passa', () => {
    expect(conferirTrocaDePlano(plano(), [{ adicional: 'pesquisa', quantidade: 1 }], { ...zero(), vendedor: 5, pesquisa: 1 })).toEqual([]);
    const ilimitado = plano({ licencas: { vendedor: null, gestor: 1, bko: 2, promotor: 0 } });
    expect(conferirTrocaDePlano(ilimitado, [], { ...zero(), vendedor: 500 })).toEqual([]);
  });

  it('adicional fora do plano e plano inativo também recusam', () => {
    const r = conferirTrocaDePlano(plano({ ativo: false, adicionais: [] }), [{ adicional: 'treinamento', quantidade: 1 }], zero());
    expect(r.map((x) => x.codigo)).toEqual(['PLANO_INATIVO', 'ADICIONAL_FORA_DO_PLANO']);
  });
});

describe('RN-PLA-04 trava do cadastro de usuários', () => {
  const situacao = (s: Partial<SituacaoDeLicencas> = {}): SituacaoDeLicencas => ({
    contratadas: licencasContratadas(plano(), []),
    emUso: zero(),
    testeAte: '2026-11-27',
    paga: false,
    ...s,
  });
  const vendedor = { bases: ['vendedor'] as const, modulos: ['core', 'vendedor'] as const };

  it('empresa sem assinatura (legado) pode sempre', () => {
    expect(conferirNovoUsuario(situacao({ contratadas: null, emUso: { ...zero(), vendedor: 999 } }), vendedor, '2027-01-01')).toEqual({ pode: true });
  });

  it('teste vencido sem pagamento = TESTE_VENCIDO; no último dia do teste ainda pode; pago não vence', () => {
    expect(conferirNovoUsuario(situacao(), vendedor, '2026-11-28')).toMatchObject({ pode: false, codigo: 'TESTE_VENCIDO' });
    expect(conferirNovoUsuario(situacao(), vendedor, '2026-11-27')).toEqual({ pode: true });
    expect(conferirNovoUsuario(situacao({ paga: true }), vendedor, '2026-12-28')).toEqual({ pode: true });
  });

  it('a última vaga pode; esgotado = LICENCAS_ESGOTADAS com o item', () => {
    expect(conferirNovoUsuario(situacao({ emUso: { ...zero(), vendedor: 4 } }), vendedor, '2026-11-20')).toEqual({ pode: true });
    expect(conferirNovoUsuario(situacao({ emUso: { ...zero(), vendedor: 5 } }), vendedor, '2026-11-20')).toEqual({
      pode: false,
      codigo: 'LICENCAS_ESGOTADAS',
      item: 'vendedor',
      mensagem: 'As 5 licenças de vendedor do plano estão em uso. Inative um usuário ou troque de plano.',
    });
  });

  it('liberar Pesquisa a quem já tem licença: conta só a Pesquisa', () => {
    const r = conferirNovoUsuario(situacao({ emUso: { ...zero(), vendedor: 5 } }), { bases: [], modulos: ['pesquisa'] }, '2026-11-20');
    expect(r).toMatchObject({ pode: false, codigo: 'LICENCAS_ESGOTADAS', item: 'pesquisa' });
    const comAdicional = situacao({ contratadas: licencasContratadas(plano(), [{ adicional: 'pesquisa', quantidade: 1 }]) });
    expect(conferirNovoUsuario(comAdicional, { bases: [], modulos: ['pesquisa'] }, '2026-11-20')).toEqual({ pode: true });
  });

  it('ilimitado (null) nunca trava', () => {
    const s = situacao({ contratadas: { ...licencasContratadas(plano(), []), gestor: null }, emUso: { ...zero(), gestor: 10_000 } });
    expect(conferirNovoUsuario(s, { bases: ['gerente'], modulos: ['gestor'] }, '2026-11-20')).toEqual({ pode: true });
  });
});

describe('RN-PLA-06 valor e teste', () => {
  it('mensal = plano + adicionais; anual com 2 meses grátis = 10× o mensal, em centavos inteiros', () => {
    const ad = [
      { adicional: 'promotor' as const, quantidade: 3 },
      { adicional: 'pesquisa' as const, quantidade: 2 },
    ];
    const mensal = 49_990 + 3 * 4_990 + 2 * 990;
    expect(valorDaAssinatura(plano(), ad, 'mensal')).toEqual({ mensal_centavos: mensal, por_ciclo_centavos: mensal, ciclo: 'mensal' });
    const anual = valorDaAssinatura(plano(), ad, 'anual');
    expect(anual).toEqual({ mensal_centavos: mensal, por_ciclo_centavos: 10 * mensal, ciclo: 'anual' });
    expect(Number.isInteger(anual.por_ciclo_centavos)).toBe(true);
  });

  it('fimDoTeste: 14 dias a partir de 2026-11-14 = 2026-11-27 (inclusive); vira mês e ano; 0 dias = sem teste', () => {
    expect(fimDoTeste('2026-11-14', 14)).toBe('2026-11-27');
    expect(fimDoTeste('2026-12-25', 14)).toBe('2027-01-07');
    expect(fimDoTeste('2026-11-14', 1)).toBe('2026-11-14');
    expect(fimDoTeste('2026-11-14', 0)).toBeNull();
  });
});

describe('contratos (Zod)', () => {
  it('plano: código normalizado, incluídos padrão 0, meses grátis até 11', () => {
    const p = plano({ codigo: ' PME ' as string });
    expect(p.codigo).toBe('pme');
    expect(p.adicionais[0]?.incluidos).toBe(0);
    expect(PlanoSchema.safeParse({ ...p, meses_gratis_anual: 12 }).success).toBe(false);
    expect(PlanoSchema.safeParse({ ...p, preco_mensal_centavos: 10.5 }).success).toBe(false);
  });

  it('escolha na criação: ciclo mensal e teste por padrão; exige pedido_id; adicional repetido e campo extra recusam', () => {
    const pedido_id = '9b000000-0000-4000-8000-000000000001';
    expect(EscolhaNaCriacaoSchema.parse({ plano: 'light', pedido_id })).toEqual({ plano: 'light', ciclo: 'mensal', adicionais: [], com_teste: true, pedido_id });
    expect(EscolhaNaCriacaoSchema.safeParse({ plano: 'light' }).success).toBe(false);
    const rep = [
      { adicional: 'pesquisa', quantidade: 1 },
      { adicional: 'pesquisa', quantidade: 2 },
    ];
    expect(EscolhaNaCriacaoSchema.safeParse({ plano: 'light', pedido_id, adicionais: rep }).success).toBe(false);
    expect(EscolhaNaCriacaoSchema.safeParse({ plano: 'light', pedido_id, preco: 1 }).success).toBe(false);
    expect(TrocarPlanoSchema.safeParse({ plano: 'pme', ciclo: 'anual', pedido_id }).success).toBe(true);
    expect(TrocarPlanoSchema.safeParse({ plano: 'pme', ciclo: 'semestral', pedido_id }).success).toBe(false);
  });

  it('criar empresa com plano: os campos da empresa sem `modulos`, mais a assinatura', () => {
    const base = {
      codigo: 'distrib-teste',
      razao_social: 'Distribuidora Teste',
      cnpj: '11222333000181',
      assinatura: { plano: 'pme', pedido_id: '9b000000-0000-4000-8000-000000000001' },
    };
    const r = CriarEmpresaComPlanoSchema.safeParse(base);
    expect(r.success).toBe(true);
    expect(r.success && 'modulos' in r.data).toBe(false);
    expect(CriarEmpresaComPlanoSchema.safeParse({ ...base, assinatura: undefined }).success).toBe(false);
  });

  it('ficha: os 6 itens contados; usoPorItem preenche o ausente com sem limite e 0', () => {
    const licencas = ITENS_CONTADOS.map((item) => ({ item, contratadas: 1, em_uso: 0 }));
    const ficha = {
      tenant_id: '0a000000-0000-4000-8000-000000000001',
      plano: plano(),
      ciclo: 'anual',
      adicionais: [],
      teste_ate: null,
      paga: true,
      licencas,
      valor: valorDaAssinatura(plano(), [], 'anual'),
      desde: '2026-11-14T12:00:00Z',
      atualizada_em: '2026-11-14T12:00:00.000+00:00',
    };
    expect(FichaAssinaturaSchema.safeParse(ficha).success).toBe(true);
    expect(FichaAssinaturaSchema.safeParse({ ...ficha, licencas: licencas.slice(1) }).success).toBe(false);
    const u = usoPorItem([{ item: 'gestor', contratadas: 2, em_uso: 1 }]);
    expect(u.contratadas).toEqual({ vendedor: null, gestor: 2, bko: null, promotor: null, pesquisa: null, treinamento: null });
    expect(u.emUso).toEqual({ ...zero(), gestor: 1 });
    expect(rotaPortalAssinatura('abc')).toBe('/v1/plataforma/empresas/abc/assinatura');
  });
});
