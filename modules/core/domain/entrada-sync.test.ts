import { describe, expect, it } from 'vitest';

import { chaveDeOrdemDaCarga, etapaDaEntidade, etapasDaEntrada, paradaParaDiagnostico, progressoDaEntrada, type EntradaProgresso, type ItemDaCarga } from './entrada-sync';

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

describe('RN-CORE-48: etapas nomeadas da entrada por perfil e módulos efetivos', () => {
  it('RN-CORE-48: Campo com Catálogo e Vendedor tem as 5 etapas, numeradas', () => {
    const l = etapasDaEntrada('vendedor', ['core', 'catalogo', 'vendedor']);
    expect(l.map((e) => e.nome)).toEqual(['Envio do que ficou no aparelho', 'Clientes e rota', 'Catálogo e preços', 'Pedidos e metas', 'Fotos e materiais']);
    expect(l.map((e) => e.numero)).toEqual([1, 2, 3, 4, 5]);
  });
  it('RN-CORE-48: sem o módulo Catálogo a etapa Catálogo e preços não aparece e a numeração fecha', () => {
    const l = etapasDaEntrada('vendedor', ['core', 'vendedor']);
    expect(l.map((e) => e.id)).toEqual(['envio', 'clientes_rota', 'pedidos_metas', 'fotos_materiais']);
    expect(l.at(-1)!.numero).toBe(4);
  });
  it('RN-CORE-48: Gestão tem equipe, aprovações, metas e alertas', () => {
    const l = etapasDaEntrada('gerente', ['core', 'vendedor', 'gestor']);
    expect(l.map((e) => e.id)).toEqual(['envio', 'equipe', 'aprovacoes', 'metas', 'alertas']);
  });
  it('RN-CORE-48: entidade de módulo inativo cai na etapa anterior que existe', () => {
    expect(etapaDaEntidade('vendedor', ['core', 'vendedor'], { entidade: 'tabela_preco', modulo: 'catalogo' })).toBe('clientes_rota');
  });
  it('RN-CORE-48: o resumo de visitas do cliente (RN-CORE-50) carrega em Clientes e rota no Campo e em Equipe na Gestão', () => {
    const carga = { entidade: 'cliente_visita_resumo', modulo: 'core' };
    expect(etapaDaEntidade('vendedor', ['core', 'vendedor'], carga)).toBe('clientes_rota');
    expect(etapaDaEntidade('promotor', ['core', 'promotor'], carga)).toBe('clientes_rota');
    expect(etapaDaEntidade('supervisor', ['core', 'vendedor', 'gestor'], carga)).toBe('equipe');
  });
  it('RN-CORE-48: antes de qualquer entidade a etapa é o envio, com 0%', () => {
    const p = progressoDaEntrada(base());
    expect(p.atual).toMatchObject({ id: 'envio', numero: 1, situacao: 'atual' });
    expect(p.percentual).toBe(0);
    expect(p.total).toBe(5);
  });
  it('RN-CORE-48: no catálogo, as anteriores ficam feitas, a atual marcada e as seguintes pendentes; percentual do total', () => {
    const p = progressoDaEntrada(base({ carga: { entidade: 'tabela_preco', modulo: 'catalogo', concluidas: 20, total: 40 }, progresso: 0.5 }));
    expect(p.etapas.map((e) => e.situacao)).toEqual(['feita', 'feita', 'atual', 'pendente', 'pendente']);
    expect(p.percentual).toBe(50);
  });
  it('RN-CORE-48: com a carga pronta tudo é feito e o percentual é 100', () => {
    const p = progressoDaEntrada(base({ sincronizando: false, sincronizado: true, progresso: 1 }));
    expect(p.pronta).toBe(true);
    expect(p.percentual).toBe(100);
    expect(p.etapas.every((e) => e.situacao === 'feita')).toBe(true);
  });
  it('RN-CORE-48: em andamento o percentual não passa de 99', () => {
    expect(progressoDaEntrada(base({ progresso: 1 })).percentual).toBe(99);
  });
  it('RN-CORE-48: a etapa em que a carga parou vai ao Diagnóstico com número, total e nome', () => {
    const p = progressoDaEntrada(base({ carga: { entidade: 'pedido', modulo: 'vendedor', concluidas: 30, total: 40 }, progresso: 0.75, sincronizando: false, erro: 'Sem sinal' }));
    expect(p.atual.situacao).toBe('parou');
    expect(paradaParaDiagnostico(p)).toEqual({ numero: 4, total: 5, nome: 'Pedidos e metas' });
  });
  it('RN-CORE-48: carga que não parou não gera parada para o Diagnóstico', () => {
    expect(paradaParaDiagnostico(progressoDaEntrada(base()))).toBeNull();
  });
});

describe('RN-CORE-48: etapas em sequência, sem voltar', () => {
  // ordem de hoje do motor: entidades do registro e, depois, as etapas extras (misturadas entre as etapas da tela)
  const cargaCampo: ItemDaCarga[] = [
    { entidade: 'meta', modulo: 'core' },
    { entidade: 'cliente', modulo: 'core' },
    { entidade: 'produto', modulo: 'core' },
    { entidade: 'rota', modulo: 'core' },
    { entidade: 'cliente_foto', modulo: 'core' },
    { entidade: 'tabela_preco', modulo: 'catalogo' },
    { entidade: 'pedido', modulo: 'vendedor' },
    { entidade: 'core-inicio', modulo: 'core' },
    { entidade: 'tarefa_promotor', modulo: 'promotor' },
  ];
  const cargaGestao: ItemDaCarga[] = [
    { entidade: 'meta', modulo: 'core' },
    { entidade: 'notificacao', modulo: 'core' },
    { entidade: 'cliente', modulo: 'core' },
    { entidade: 'pedido', modulo: 'vendedor' },
    { entidade: 'painel_vendedor_dia', modulo: 'gestor' },
    { entidade: 'core-inicio', modulo: 'core' },
  ];
  const ordenar = (perfil: string, modulos: string[], itens: ItemDaCarga[]) => {
    const chave = chaveDeOrdemDaCarga(perfil, modulos);
    return [...itens].sort((a, b) => chave(a) - chave(b));
  };
  /** Números mostrados ao longo da carga, como o shell faz: guarda o progresso anterior e passa de volta. */
  const numerosMostrados = (perfil: string, modulos: string[], itens: ItemDaCarga[]) => {
    let anterior: ReturnType<typeof progressoDaEntrada> | null = null;
    const vistos: number[] = [];
    for (const it of [null, ...itens]) {
      const carga = { entidade: it?.entidade ?? null, modulo: it?.modulo ?? null, concluidas: 0, total: itens.length + 1 };
      anterior = progressoDaEntrada(base({ perfil, modulos, carga, anterior }));
      vistos.push(anterior.atual.numero);
    }
    return { vistos, ultimo: anterior! };
  };
  const semRepetir = (l: number[]) => l.filter((n, i) => n !== l[i - 1]);

  it('RN-CORE-48: Campo, na ordem nova a carga mostra 1, 2, 3, 4 e 5', () => {
    const modulos = ['core', 'catalogo', 'vendedor', 'promotor'];
    const ordenada = ordenar('vendedor', modulos, cargaCampo);
    expect(ordenada.map((i) => i.entidade)).toEqual(['cliente', 'rota', 'produto', 'tabela_preco', 'meta', 'pedido', 'core-inicio', 'cliente_foto', 'tarefa_promotor']);
    expect(semRepetir(numerosMostrados('vendedor', modulos, ordenada).vistos)).toEqual([1, 2, 3, 4, 5]);
  });
  it('RN-CORE-48: dentro da etapa vale a ordem de hoje (ordenação estável pela chave)', () => {
    const chave = chaveDeOrdemDaCarga('vendedor', ['core', 'catalogo', 'vendedor']);
    expect(chave({ entidade: 'meta', modulo: 'core' })).toBe(chave({ entidade: 'pedido', modulo: 'vendedor' }));
    expect(chave({ entidade: 'cliente', modulo: 'core' })).toBeLessThan(chave({ entidade: 'produto', modulo: 'core' }));
  });
  it('RN-CORE-48: sem o Catálogo a chave segue a numeração do perfil (1 a 4)', () => {
    const modulos = ['core', 'vendedor', 'promotor'];
    const ordenada = ordenar('vendedor', modulos, cargaCampo.filter((i) => i.modulo !== 'catalogo'));
    expect(semRepetir(numerosMostrados('vendedor', modulos, ordenada).vistos)).toEqual([1, 2, 3, 4]);
  });
  it('RN-CORE-48: entidade fora de ordem não faz o número voltar e as anteriores ficam feitas', () => {
    const modulos = ['core', 'catalogo', 'vendedor', 'promotor'];
    // ordem de hoje (sem a chave): 4, 2, 3, 2, 5, 3, 4, 4, 5 — a tela não pode voltar
    const { vistos, ultimo } = numerosMostrados('vendedor', modulos, cargaCampo);
    expect(vistos.every((n, i) => i === 0 || n >= vistos[i - 1]!)).toBe(true);
    expect(semRepetir(vistos)).toEqual([1, 4, 5]);
    expect(ultimo.etapas.slice(0, 4).every((e) => e.situacao === 'feita')).toBe(true);
    expect(ultimo.atual.situacao).toBe('atual');
  });
  it('RN-CORE-48: com a anterior, o percentual segue o motor', () => {
    const anterior = progressoDaEntrada(base({ carga: { entidade: 'pedido', modulo: 'vendedor', concluidas: 6, total: 10 }, progresso: 0.6 }));
    const p = progressoDaEntrada(base({ carga: { entidade: 'cliente', modulo: 'core', concluidas: 7, total: 10 }, progresso: 0.7, anterior }));
    expect(p.atual.id).toBe('pedidos_metas');
    expect(p.percentual).toBe(70);
  });
  it('RN-CORE-48: parou depois de avançar, a parada é a maior etapa já mostrada', () => {
    const anterior = progressoDaEntrada(base({ carga: { entidade: 'pedido', modulo: 'vendedor', concluidas: 6, total: 10 }, progresso: 0.6 }));
    const p = progressoDaEntrada(base({ carga: { entidade: 'cliente', modulo: 'core', concluidas: 6, total: 10 }, progresso: 0.6, sincronizando: false, erro: 'Sem sinal', anterior }));
    expect(paradaParaDiagnostico(p)).toEqual({ numero: 4, total: 5, nome: 'Pedidos e metas' });
  });
  it('RN-CORE-48: anterior de outra lista de etapas (outro perfil) é ignorada', () => {
    const anterior = progressoDaEntrada(base({ perfil: 'gerente', modulos: ['core', 'vendedor', 'gestor'], carga: { entidade: 'notificacao', modulo: 'core', concluidas: 1, total: 4 } }));
    const p = progressoDaEntrada(base({ carga: { entidade: 'cliente', modulo: 'core', concluidas: 1, total: 4 }, anterior }));
    expect(p.atual.id).toBe('clientes_rota');
  });
  it('RN-CORE-48: Gestão, na ordem nova mostra 1, 2, 3, 4 e 5', () => {
    const modulos = ['core', 'vendedor', 'gestor'];
    const ordenada = ordenar('gerente', modulos, cargaGestao);
    expect(ordenada.map((i) => i.entidade)).toEqual(['cliente', 'painel_vendedor_dia', 'pedido', 'meta', 'core-inicio', 'notificacao']);
    expect(semRepetir(numerosMostrados('gerente', modulos, ordenada).vistos)).toEqual([1, 2, 3, 4, 5]);
  });
  it('RN-CORE-48: Gestão, entidade fora de ordem não faz o número voltar', () => {
    const { vistos } = numerosMostrados('supervisor', ['core', 'vendedor', 'gestor'], cargaGestao);
    expect(vistos.every((n, i) => i === 0 || n >= vistos[i - 1]!)).toBe(true);
    expect(semRepetir(vistos)).toEqual([1, 4, 5]);
  });
});
