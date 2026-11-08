import { describe, expect, it } from 'vitest';
import {
  agruparMudancas,
  alternarMarcado,
  ALVO_TODOS_PERFIS,
  CADEADO,
  contagemDeMudancas,
  contagemNaoSalva,
  ORDEM_PERFIL_BASE,
  resumoDosAlvos,
  SECOES_DO_PERFIL,
  textoDaMudanca,
  textoDosAfetados,
  textoFaladoDaMudanca,
  textoOndeEntra,
  tituloDaSecao,
  type MudancaDePermissao,
} from './perfis';

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
    expect(tituloDaSecao('pedidos')).toBe('Pedidos');
    expect(ORDEM_PERFIL_BASE).toHaveLength(7);
  });

  it('agrupa o que mudou pela ordem das seções e ignora o que não mudou', () => {
    const m: MudancaDePermissao[] = [
      { secao: 'pedidos', rotulo: 'Cancelar pedido', antes: 'Equipe', depois: 'Próprio' },
      { secao: 'onde-entra', rotulo: 'BKO', antes: 'Sim', depois: 'Não' },
      { secao: 'pedidos', rotulo: 'Excluir rascunho', antes: 'Sim', depois: 'Sim' },
      { secao: 'pedidos', rotulo: 'Aprovar desconto e crédito', antes: 'Não', depois: 'Até a alçada' },
    ];
    const g = agruparMudancas(m);
    expect(g.map((x) => x.titulo)).toEqual(['Onde entra', 'Pedidos']);
    expect(g[1]?.itens.map((x) => x.rotulo)).toEqual(['Cancelar pedido', 'Aprovar desconto e crédito']);
  });

  it('texto visível com seta e texto falado sem seta', () => {
    const m: MudancaDePermissao = { secao: 'pedidos', rotulo: 'Cancelar pedido', antes: 'Equipe', depois: 'Próprio' };
    expect(textoDaMudanca(m)).toBe('Cancelar pedido: Equipe → Próprio');
    expect(textoFaladoDaMudanca(m)).toBe('Cancelar pedido, de Equipe para Próprio');
  });

  it('contagens no singular e no plural', () => {
    expect(contagemDeMudancas(0)).toBe('Nenhuma mudança');
    expect(contagemDeMudancas(1)).toBe('1 mudança');
    expect(contagemDeMudancas(3)).toBe('3 mudanças');
    expect(contagemNaoSalva(1)).toBe('1 mudança não salva');
    expect(contagemNaoSalva(2)).toBe('2 mudanças não salvas');
    expect(textoDosAfetados(0)).toBe('Nenhum usuário tem este perfil.');
    expect(textoDosAfetados(1)).toBe('Afeta 1 usuário.');
    expect(textoDosAfetados(12)).toBe('Afeta 12 usuários.');
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

  it('onde entra, em frase', () => {
    expect(textoOndeEntra([])).toBe('Não entra em nenhum app nem no BKO.');
    expect(textoOndeEntra(['campo'])).toBe('Entra em: Campo.');
    expect(textoOndeEntra(['bko', 'gestao'])).toBe('Entra em: Gestão e BKO.');
    expect(textoOndeEntra(['portal', 'bko', 'campo'])).toBe('Entra em: Campo, BKO e Portal.');
  });

  it('todo texto de cadeado cita a regra', () => {
    const textos = [
      CADEADO.escopoAcimaDaBase('vendedor'),
      CADEADO.autogestao,
      CADEADO.senhaDeAdmin,
      CADEADO.baseImutavel,
      CADEADO.padraoNaoDesativa,
      CADEADO.senhaSempreComRegra,
    ];
    for (const t of textos) expect(t).toMatch(/\(RN-[A-Z]+-\d+\)\.$/);
    expect(CADEADO.escopoAcimaDaBase('supervisor')).toBe('Acima do perfil base Supervisor (RN-CORE-04).');
  });
});
