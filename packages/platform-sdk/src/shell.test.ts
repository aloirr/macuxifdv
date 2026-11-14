import { z } from 'zod';
import { describe, expect, it } from 'vitest';
import { defineModule } from './manifesto';
import { matrizDeFabrica, perfilDeFabrica, resolverPerfil } from './permissoes-perfil';
import { caminhoDoLinkInterno, criarShell, definirModuloShell, linkInternoNavegavel } from './shell';
import { definirEntidadeSync } from './sync';

const core = definirModuloShell({
  manifesto: defineModule({ id: 'core', versao: '1.0.0', perfis: ['vendedor', 'promotor', 'gerente', 'analista'], apps: { campo: { abas: ['Clientes'] }, web: { menus: ['Clientes'] } }, sync: ['cliente'], ofereceExtensoes: ['cliente.acoes'] }),
  paginas: [
    { id: 'clientes', caminho: 'clientes', titulo: 'Clientes', navegacao: 'Clientes', ordem: 20, componente: 'TelaClientes' },
    { id: 'cliente', caminho: 'cliente', titulo: 'Cliente', componente: 'TelaCliente' },
  ],
  entidadesSync: [definirEntidadeSync({ nome: 'cliente', modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema: z.object({}) })],
});

const vendedor = definirModuloShell({
  manifesto: defineModule({
    id: 'vendedor',
    versao: '1.0.0',
    depende: ['core'],
    perfis: ['vendedor', 'analista'],
    apps: { campo: { abas: ['Pedidos'] }, web: { menus: ['Pedidos', 'Alçadas'] } },
    acoes: { 'pedido.criar': { perfis: ['vendedor', 'analista'] }, 'alcada.editar': { perfis: ['analista'] } },
    usaExtensoes: ['cliente.acoes', 'produto.acoes'],
  }),
  extensoes: [
    { slot: 'cliente.acoes', id: 'novo-pedido', acao: 'pedido.criar', payload: { rotulo: 'Novo pedido', testID: 'pedido-novo' } },
    { slot: 'produto.acoes', id: 'adicionar', acao: 'pedido.criar', payload: { rotulo: 'Adicionar ao pedido' } },
  ],
  paginas: [
    { id: 'pedidos', caminho: 'pedidos', titulo: 'Pedidos', navegacao: 'Pedidos', ordem: 10, componente: 'TelaPedidos' },
    { id: 'novo-pedido', caminho: 'novo-pedido', titulo: 'Novo pedido', acao: 'pedido.criar', componente: 'TelaNovoPedido' },
    { id: 'alcadas', caminho: 'alcadas', titulo: 'Alçadas', navegacao: 'Alçadas', grupo: 'cadastros', acao: 'alcada.editar', apps: ['web'], componente: 'TelaAlcadas' },
  ],
});

describe('registro de telas dos módulos no shell', () => {
  it('monta a navegação só dos módulos efetivos, na ordem, com testID estável', () => {
    const shell = criarShell('campo', [core, vendedor]);
    const v = shell.montar({ perfil: 'vendedor', modulosAtivos: ['core', 'vendedor'] });
    expect(v.navegacao.map((n) => [n.rotulo, n.testID])).toEqual([
      ['Pedidos', 'nav-vendedor-pedidos'],
      ['Clientes', 'nav-core-clientes'],
    ]);
    // a transição de grupos da ADR 0050 é só do menu do BKO: no app, core/clientes continua em 'operacao'
    expect(v.navegacao.find((n) => n.id === 'clientes')?.grupoMenu).toBe('operacao');
    expect(shell.montar({ perfil: 'vendedor', modulosAtivos: ['core'] }).navegacao.map((n) => n.id)).toEqual(['clientes']);
    expect(shell.registroSync.entidadesAtivas(['core']).map((e) => e.nome)).toEqual(['cliente']);
  });

  it('RN-PRO-01 no shell: promotor com o Vendedor ativo não vê a tela de novo pedido', () => {
    const shell = criarShell('campo', [core, vendedor]);
    const promotor = shell.montar({ perfil: 'promotor', modulosAtivos: ['core', 'vendedor'] });
    expect(promotor.pagina('novo-pedido')).toBeNull();
    expect(promotor.pode('pedido.criar')).toBe(false);
    expect(shell.montar({ perfil: 'vendedor', modulosAtivos: ['core', 'vendedor'] }).pagina('/novo-pedido')?.modulo).toBe('vendedor');
  });

  it('RN-CORE-35 no shell: com os perfis resolvidos, vendedor + promotor pode criar pedido (o motor decide)', () => {
    const shell = criarShell('campo', [core, vendedor]);
    const matriz = matrizDeFabrica([core.manifesto, vendedor.manifesto]);
    const perfis = [resolverPerfil(perfilDeFabrica('vendedor'), matriz), resolverPerfil(perfilDeFabrica('promotor'), matriz)];
    expect(shell.montar({ perfil: 'promotor', modulosAtivos: ['core', 'vendedor'], perfis }).pode('pedido.criar')).toBe(true);
    expect(shell.montar({ perfil: 'promotor', modulosAtivos: ['core', 'vendedor'], perfis: [perfis[1]!] }).pode('pedido.criar')).toBe(false);
  });

  it('extensões de UI: botão de pedido do Vendedor na ficha do cliente (core) some para o promotor e sem o módulo', () => {
    const shell = criarShell('campo', [core, vendedor]);
    const rotulos = (perfil: 'vendedor' | 'promotor', ativos: ('core' | 'vendedor')[]) =>
      shell.montar({ perfil, modulosAtivos: ativos }).extensoes<{ rotulo: string }>('cliente.acoes').map((i) => i.payload.rotulo);
    expect(rotulos('vendedor', ['core', 'vendedor'])).toEqual(['Novo pedido']);
    expect(rotulos('promotor', ['core', 'vendedor'])).toEqual([]);
    expect(rotulos('vendedor', ['core'])).toEqual([]);
    // produto.acoes é do catálogo, que não está instalado: o item some sem erro (RN-CORE-03)
    expect(shell.montar({ perfil: 'vendedor', modulosAtivos: ['core', 'vendedor'] }).extensoes('produto.acoes')).toEqual([]);
  });

  it('página só da variante/app declarada', () => {
    expect(criarShell('campo', [core, vendedor]).montar({ perfil: 'analista', modulosAtivos: ['core', 'vendedor'] }).pagina('alcadas')).toBeNull();
  });

  it('falha cedo: rótulo fora do manifesto, caminho repetido e ação desconhecida', () => {
    const ruim = definirModuloShell({
      manifesto: defineModule({ id: 'gestor', versao: '1.0.0', depende: ['core'], perfis: ['gerente'], apps: { web: { menus: ['Equipe'] } } }),
      paginas: [
        { id: 'painel', caminho: 'clientes', titulo: 'Painel', navegacao: 'Painel', acao: 'equipe.ver', componente: 'X' },
      ],
    });
    expect(() => criarShell('web', [core, vendedor, ruim])).toThrow(
      /caminho clientes usado por core e por gestor.*"Painel" não está em apps\.web\.menus.*ação equipe\.ver não declarada/,
    );
    expect(() => definirModuloShell({ manifesto: core.manifesto, paginas: [{ id: 'a', caminho: '/a', titulo: 'A', componente: 1 }] })).toThrow(/sem barra/);
  });
});

describe('link interno do app (RD-0032: fonte única para o Início do shell e a central do Core)', () => {
  it('caminhoDoLinkInterno: só /m/<caminho>, sem query nem âncora', () => {
    expect(caminhoDoLinkInterno('/m/cliente?id=1#x')).toBe('cliente');
    expect(caminhoDoLinkInterno('/m/rota')).toBe('rota');
    expect(caminhoDoLinkInterno('/m/pedidos/novo')).toBe('pedidos/novo');
    expect(caminhoDoLinkInterno('/x/rota')).toBeNull();
    expect(caminhoDoLinkInterno('/m/')).toBeNull();
    expect(caminhoDoLinkInterno('/m/Rota')).toBeNull();
    expect(caminhoDoLinkInterno('https://x.com/m/rota')).toBeNull();
    expect(caminhoDoLinkInterno('')).toBeNull();
    expect(caminhoDoLinkInterno(null)).toBeNull();
    expect(caminhoDoLinkInterno(undefined)).toBeNull();
  });

  it('linkInternoNavegavel: devolve o link inteiro; null fora do padrão ou com tela inexistente na visão', () => {
    expect(linkInternoNavegavel('/m/pedido?id=1')).toBe('/m/pedido?id=1');
    expect(linkInternoNavegavel('https://x.com')).toBeNull();
    expect(linkInternoNavegavel(null)).toBeNull();
    const telas = new Set(['rota', 'clientes', 'notificacoes']);
    const existe = (c: string) => telas.has(c);
    // recado gravado com /m/core-rota (T-0140): a tela não existe, não navega
    expect(linkInternoNavegavel('/m/core-rota', existe)).toBeNull();
    expect(linkInternoNavegavel('/m/rota', existe)).toBe('/m/rota');
    expect(linkInternoNavegavel('/m/rota?data=2026-11-08', existe)).toBe('/m/rota?data=2026-11-08');
    // mais de um segmento não é tela do visao.pagina
    expect(linkInternoNavegavel('/m/rota/hoje', existe)).toBeNull();
  });
});
