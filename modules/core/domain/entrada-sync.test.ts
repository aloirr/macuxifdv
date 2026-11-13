import { describe, expect, it } from 'vitest';

import { etapaDaEntidade, etapasDaEntrada, paradaParaDiagnostico, progressoDaEntrada, type EntradaProgresso } from './entrada-sync';

const base = (o: Partial<EntradaProgresso> = {}): EntradaProgresso => ({
  perfil: 'vendedor',
  modulos: ['core', 'catalogo', 'vendedor'],
  carga: { entidade: null, modulo: null, concluidas: 0, total: 40 },
  progresso: 0,
  sincronizando: true,
  erro: null,
  sincronizado: false,
  ...o,
});

describe('RN-CORE-40: etapas nomeadas da entrada por perfil e módulos efetivos', () => {
  it('RN-CORE-40: Campo com Catálogo e Vendedor tem as 5 etapas, numeradas', () => {
    const l = etapasDaEntrada('vendedor', ['core', 'catalogo', 'vendedor']);
    expect(l.map((e) => e.nome)).toEqual(['Envio do que ficou no aparelho', 'Clientes e rota', 'Catálogo e preços', 'Pedidos e metas', 'Fotos e materiais']);
    expect(l.map((e) => e.numero)).toEqual([1, 2, 3, 4, 5]);
  });
  it('RN-CORE-40: sem o módulo Catálogo a etapa Catálogo e preços não aparece e a numeração fecha', () => {
    const l = etapasDaEntrada('vendedor', ['core', 'vendedor']);
    expect(l.map((e) => e.id)).toEqual(['envio', 'clientes_rota', 'pedidos_metas', 'fotos_materiais']);
    expect(l.at(-1)!.numero).toBe(4);
  });
  it('RN-CORE-40: Gestão tem equipe, aprovações, metas e alertas', () => {
    const l = etapasDaEntrada('gerente', ['core', 'vendedor', 'gestor']);
    expect(l.map((e) => e.id)).toEqual(['envio', 'equipe', 'aprovacoes', 'metas', 'alertas']);
  });
  it('RN-CORE-40: entidade de módulo inativo cai na etapa anterior que existe', () => {
    expect(etapaDaEntidade('vendedor', ['core', 'vendedor'], { entidade: 'tabela_preco', modulo: 'catalogo' })).toBe('clientes_rota');
  });
  it('RN-CORE-40: antes de qualquer entidade a etapa é o envio, com 0%', () => {
    const p = progressoDaEntrada(base());
    expect(p.atual).toMatchObject({ id: 'envio', numero: 1, situacao: 'atual' });
    expect(p.percentual).toBe(0);
    expect(p.total).toBe(5);
  });
  it('RN-CORE-40: no catálogo, as anteriores ficam feitas, a atual marcada e as seguintes pendentes; percentual do total', () => {
    const p = progressoDaEntrada(base({ carga: { entidade: 'tabela_preco', modulo: 'catalogo', concluidas: 20, total: 40 }, progresso: 0.5 }));
    expect(p.etapas.map((e) => e.situacao)).toEqual(['feita', 'feita', 'atual', 'pendente', 'pendente']);
    expect(p.percentual).toBe(50);
  });
  it('RN-CORE-40: com a carga pronta tudo é feito e o percentual é 100', () => {
    const p = progressoDaEntrada(base({ sincronizando: false, sincronizado: true, progresso: 1 }));
    expect(p.pronta).toBe(true);
    expect(p.percentual).toBe(100);
    expect(p.etapas.every((e) => e.situacao === 'feita')).toBe(true);
  });
  it('RN-CORE-40: em andamento o percentual não passa de 99', () => {
    expect(progressoDaEntrada(base({ progresso: 1 })).percentual).toBe(99);
  });
  it('RN-CORE-40: a etapa em que a carga parou vai ao Diagnóstico com número, total e nome', () => {
    const p = progressoDaEntrada(base({ carga: { entidade: 'pedido', modulo: 'vendedor', concluidas: 30, total: 40 }, progresso: 0.75, sincronizando: false, erro: 'Sem sinal' }));
    expect(p.atual.situacao).toBe('parou');
    expect(paradaParaDiagnostico(p)).toEqual({ numero: 4, total: 5, nome: 'Pedidos e metas' });
  });
  it('RN-CORE-40: carga que não parou não gera parada para o Diagnóstico', () => {
    expect(paradaParaDiagnostico(progressoDaEntrada(base()))).toBeNull();
  });
});
