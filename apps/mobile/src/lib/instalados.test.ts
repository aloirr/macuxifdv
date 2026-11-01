/**
 * T-0004 critérios 2 e 3 no shell mobile, sem React Native: os 8 módulos instalados pelo manifesto, os módulos
 * possíveis de cada variante e a extensão de exemplo que só aparece com o módulo ativo (RN-CORE-03).
 */
import { criarShell, defineModule, definirModuloShell, modulosEfetivos, type ModuloId, type ModuloShell } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { MANIFESTOS_INSTALADOS, modulosDaVariante } from './instalados';

/** Card de exemplo que o Treinamento registra no slot `inicio.cards` (oferecido pelo Core; o shell renderiza no Início). */
const CARD_EXEMPLO = { slot: 'inicio.cards', id: 'desafio-semana', payload: { rotulo: 'Desafio da semana', testID: 'card-treinamento-desafio' } };

const modulos = (comExemplo: boolean): ModuloShell<unknown>[] =>
  MANIFESTOS_INSTALADOS.map((m) => (comExemplo && m.id === 'treinamento' ? { manifesto: m, extensoes: [CARD_EXEMPLO] } : { manifesto: m }));

const efetivos = (ativosNoTenant: ModuloId[]) => modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS, ativosNoTenant, doPerfil: ativosNoTenant });

describe('shell mobile com os 8 módulos (T-0004)', () => {
  it('instala os 8 e o conjunto é válido nas duas variantes', () => {
    expect(MANIFESTOS_INSTALADOS.map((m) => m.id)).toEqual(['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao']);
    expect(() => criarShell('campo', modulos(true))).not.toThrow();
    expect(() => criarShell('gestao', modulos(true))).not.toThrow();
  });

  it('módulos possíveis por variante: Campo (vendedor/promotor) e Gestão (supervisor/gerente); Integração só no BKO', () => {
    expect(modulosDaVariante('campo')).toEqual(['core', 'catalogo', 'vendedor', 'promotor', 'pesquisa', 'treinamento']);
    // o Vendedor entra no Gestão quando o manifesto declarar apps.gestao (T-0029 §7, modulo-vendedor)
    expect(modulosDaVariante('gestao').filter((m) => m !== 'vendedor')).toEqual(['core', 'catalogo', 'promotor', 'gestor', 'pesquisa', 'treinamento']);
    expect(modulosDaVariante('gestao')).not.toContain('integracao');
  });
});

describe('T-0029 §7: a variante Gestão monta o Vendedor só pelo manifesto (apps.gestao), sem código no shell', () => {
  const real = MANIFESTOS_INSTALADOS.find((m) => m.id === 'vendedor')!;
  // estado-alvo do manifesto do Vendedor na fatia (o real ganha isto na onda 2)
  const vendedor = defineModule({
    ...real,
    perfis: [...new Set([...real.perfis, 'supervisor', 'gerente'] as const)],
    apps: { ...real.apps, gestao: { abas: ['Pedidos'] } },
  });
  const telas = definirModuloShell<string>({
    manifesto: vendedor,
    paginas: [
      { id: 'pedidos', caminho: 'pedidos', titulo: 'Pedidos', navegacao: 'Pedidos', apps: ['campo', 'gestao'], componente: 'Pedidos' },
      { id: 'pedido', caminho: 'pedido', titulo: 'Pedido', apps: ['campo', 'gestao'], componente: 'Pedido' },
      { id: 'novo-pedido', caminho: 'novo-pedido', titulo: 'Novo pedido', acao: 'pedido.criar', apps: ['campo'], componente: 'NovoPedido' },
    ],
    extensoes: [{ slot: 'cliente.acoes', id: 'novo-pedido', acao: 'pedido.criar', apps: ['campo'], payload: { rotulo: 'Novo pedido' } }],
  });
  const comVendedor = MANIFESTOS_INSTALADOS.map((m): ModuloShell<string> => (m.id === 'vendedor' ? telas : { manifesto: m }));
  const ativos = modulosEfetivos({ manifestos: comVendedor.map((m) => m.manifesto), ativosNoTenant: ['catalogo', 'vendedor', 'gestor'], doPerfil: ['catalogo', 'vendedor', 'gestor'] });

  it('supervisor no Gestão: aba Pedidos e detalhe; sem Novo pedido nem a ação "Novo pedido" do cliente', () => {
    const v = criarShell('gestao', comVendedor).montar({ perfil: 'supervisor', modulosAtivos: ativos });
    expect(v.navegacao.filter((n) => n.modulo === 'vendedor').map((n) => n.rotulo)).toEqual(['Pedidos']);
    expect(v.pagina('pedido')?.modulo).toBe('vendedor');
    expect(v.pagina('novo-pedido')).toBeNull();
    expect(v.extensoes('cliente.acoes').filter((i) => i.modulo === 'vendedor')).toEqual([]);
  });

  it('vendedor no Campo continua com Novo pedido e a ação do cliente', () => {
    const v = criarShell('campo', comVendedor).montar({ perfil: 'vendedor', modulosAtivos: ativos });
    expect(v.pagina('novo-pedido')?.modulo).toBe('vendedor');
    expect(v.extensoes('cliente.acoes').map((i) => i.id)).toContain('novo-pedido');
  });

  it('RN-CORE-03: Vendedor desligado para o supervisor → a aba some no Gestão', () => {
    const v = criarShell('gestao', comVendedor).montar({ perfil: 'supervisor', modulosAtivos: ativos.filter((m) => m !== 'vendedor') });
    expect(v.navegacao.some((n) => n.modulo === 'vendedor')).toBe(false);
  });
});

describe('extensão de exemplo (critério 2): aparece só com o módulo ativo', () => {
  const shell = criarShell('campo', modulos(true));

  it('Treinamento efetivo → o card aparece no slot inicio.cards', () => {
    const visao = shell.montar({ perfil: 'vendedor', modulosAtivos: efetivos(['vendedor', 'treinamento']) });
    expect(visao.extensoes('inicio.cards').map((i) => `${i.modulo}/${i.id}`)).toEqual(['treinamento/desafio-semana']);
  });

  it('RN-CORE-03: Treinamento desativado → o card some, sem erro', () => {
    const visao = shell.montar({ perfil: 'vendedor', modulosAtivos: efetivos(['vendedor']) });
    expect(visao.extensoes('inicio.cards')).toEqual([]);
  });

  it('o mesmo vale na variante Gestão', () => {
    const gestao = criarShell('gestao', modulos(true));
    expect(gestao.montar({ perfil: 'supervisor', modulosAtivos: efetivos(['treinamento']) }).extensoes('inicio.cards')).toHaveLength(1);
    expect(gestao.montar({ perfil: 'supervisor', modulosAtivos: efetivos([]) }).extensoes('inicio.cards')).toHaveLength(0);
  });
});
