import { describe, expect, it } from 'vitest';
import { alternarMarcado, ALVO_TODOS_PERFIS, CADEADO, contagemNaoSalva, ORDEM_PERFIL_BASE, resumoDosAlvos, SECOES_DO_PERFIL } from './perfis';
import * as perfis from './perfis';

/** Código interno que nunca aparece para o cliente (R-20261124-094002). */
const CODIGO_INTERNO = /\b(RN|RF|RD)-|\bT-\d{4}\b|\bADR\b/;

describe('perfis de acesso: textos e arrumação (T-0111)', () => {
  it('as 12 seções aprovadas, na ordem, e o bloco final', () => {
    expect(SECOES_DO_PERFIL.map((s) => s.titulo)).toEqual([
      'Identificação',
      'Onde entra',
      'Escopo de dados',
      'Módulos',
      'Usuários e senhas',
      'Clientes',
      'Pedidos',
      'Catálogo',
      'Trade (Promotor)',
      'Pesquisa e Treinamento',
      'Metas e remuneração',
      'Integração (BKO)',
      'Outras permissões',
    ]);
    expect(ORDEM_PERFIL_BASE).toHaveLength(7);
  });

  it('contagem das mudanças não salvas no singular e no plural', () => {
    expect(contagemNaoSalva(0)).toBe('Nenhuma mudança');
    expect(contagemNaoSalva(1)).toBe('1 mudança não salva');
    expect(contagemNaoSalva(2)).toBe('2 mudanças não salvas');
  });

  it('resumo dos perfis-alvo da senha', () => {
    const r = { vendedor: 'Vendedor', supervisor: 'Supervisor', vendedor_jr: 'Vendedor júnior' };
    expect(resumoDosAlvos([], r)).toBe('Nenhum perfil');
    expect(resumoDosAlvos(null, r)).toBe('Nenhum perfil');
    expect(resumoDosAlvos([ALVO_TODOS_PERFIS], r)).toBe('Todos, menos admin');
    expect(resumoDosAlvos(['vendedor', 'vendedor_jr', 'sumiu'], r)).toBe('Vendedor, Vendedor júnior, sumiu');
  });

  it('alternarMarcado mantém a ordem da tela; "todos" substitui a lista', () => {
    const ordem = ['vendedor', 'promotor', 'supervisor'];
    expect(alternarMarcado(['supervisor'], 'vendedor', ordem)).toEqual(['vendedor', 'supervisor']);
    expect(alternarMarcado(['vendedor', 'supervisor'], 'vendedor', ordem)).toEqual(['supervisor']);
    expect(alternarMarcado(['vendedor'], ALVO_TODOS_PERFIS, ordem)).toEqual([ALVO_TODOS_PERFIS]);
    expect(alternarMarcado([ALVO_TODOS_PERFIS], ALVO_TODOS_PERFIS, ordem)).toEqual([]);
  });

  it('nenhum texto visível traz código interno (R-20261124-094002)', () => {
    const textos = [
      CADEADO.escopoAcimaDaBase('vendedor'),
      CADEADO.autogestao,
      CADEADO.senhaDeAdmin,
      CADEADO.baseImutavel,
      CADEADO.padraoNaoDesativa,
      CADEADO.senhaSempreComRegra,
    ];
    const visiveis = [
      ...textos,
      CADEADO.coreSempreLigado,
      ...SECOES_DO_PERFIL.map((s) => s.titulo),
      ...Object.values(perfis).filter((v: unknown): v is string => typeof v === 'string'),
      ...Object.values(perfis.TEXTO_INTERRUPTOR),
    ];
    for (const t of visiveis) expect(t).not.toMatch(CODIGO_INTERNO);
    for (const t of textos) expect(t).toMatch(/[a-zà-ú]\.$/);
    expect(CADEADO.escopoAcimaDaBase('supervisor')).toBe('Acima do perfil base Supervisor.');
    expect(CADEADO.baseImutavel).toBe('O perfil base não muda depois de criado.');
  });
});
