/**
 * T-0055 (RF-GES-05, RN-VEN-35; conferência R-20261105-214757): o shell Gestão monta o novo pedido do Vendedor e o item
 * do slot `pedido.criar_em_nome` só para supervisor e gerente; o promotor nunca vê criar pedido (regra 7, RN-PRO-01).
 * As telas reais importam React Native (não rodam no Node): as declarações abaixo espelham `modules/vendedor/app/index.ts`
 * (página `novo-pedido` com `acao: 'pedido.criar'`, perfis do manifesto, apps campo e gestão; item `novo-pedido-em-nome`
 * só na gestão) e `modules/gestor/app/index.ts` (Equipe e a ficha `equipe-membro`), sobre o `criarShell` e os manifestos
 * REAIS. A pilha usa o histórico real do shell (lib/historico-telas.ts).
 */
import { criarShell, definirModuloShell, modulosEfetivos, type ModuloId, type ModuloShell, type PaginaShell, type Perfil } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';

import { abrirTela, entradaDaRota, HISTORICO_VAZIO, telaAnterior, type HistoricoShell, type ParamsDaRota } from './historico-telas';
import { MANIFESTOS_INSTALADOS } from './instalados';

type Pg = PaginaShell<string>;
const PERFIS_VENDEDOR = MANIFESTOS_INSTALADOS.find((m) => m.id === 'vendedor')!.perfis;

const PAGINAS: Partial<Record<ModuloId, Pg[]>> = {
  vendedor: [
    { id: 'pedidos', caminho: 'pedidos', titulo: 'Pedidos', navegacao: 'Pedidos', perfis: PERFIS_VENDEDOR, apps: ['campo', 'gestao'], componente: 'pedidos' },
    { id: 'novo-pedido', caminho: 'novo-pedido', titulo: 'Novo pedido', acao: 'pedido.criar', perfis: PERFIS_VENDEDOR, apps: ['campo', 'gestao'], componente: 'novo-pedido' },
  ],
  gestor: [
    { id: 'equipe', caminho: 'equipe', titulo: 'Equipe', navegacao: 'Equipe', apps: ['gestao'], acao: 'painel_equipe.ver', componente: 'equipe' },
    { id: 'membro', caminho: 'equipe-membro', titulo: 'Ficha', apps: ['gestao'], acao: 'painel_equipe.ver', componente: 'membro' },
  ],
};

const MODULOS: ModuloShell<string>[] = MANIFESTOS_INSTALADOS.map((m) =>
  definirModuloShell<string>({
    manifesto: m,
    paginas: PAGINAS[m.id] ?? [],
    extensoes:
      m.id === 'vendedor'
        ? [{ slot: 'pedido.criar_em_nome', id: 'novo-pedido-em-nome', acao: 'pedido.criar_em_nome', apps: ['gestao'], payload: { rotulo: 'Fazer pedido em nome' } }]
        : [],
  }),
);

const TODOS: ModuloId[] = ['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento'];

function visao(variante: 'campo' | 'gestao', perfil: Perfil) {
  const doPerfil = MANIFESTOS_INSTALADOS.filter((m) => m.perfis.includes(perfil)).map((m) => m.id);
  const ativos = modulosEfetivos({ manifestos: MANIFESTOS_INSTALADOS, ativosNoTenant: TODOS, doPerfil });
  return criarShell(variante, MODULOS).montar({ perfil, modulosAtivos: ativos });
}

describe('T-0055 — pedido em nome do vendedor no shell Gestão', () => {
  it('supervisor e gerente: a Gestão monta /m/novo-pedido e o item "Fazer pedido em nome" da ficha', () => {
    for (const perfil of ['supervisor', 'gerente'] as const) {
      const v = visao('gestao', perfil);
      expect(v.pagina('novo-pedido')?.modulo).toBe('vendedor');
      expect(v.extensoes('pedido.criar_em_nome').map((i) => i.id)).toEqual(['novo-pedido-em-nome']);
    }
  });

  it('regra 7 (RN-PRO-01): o promotor não abre o novo pedido nem vê o item, no Campo e na Gestão', () => {
    for (const variante of ['campo', 'gestao'] as const) {
      const v = visao(variante, 'promotor');
      expect(v.pagina('novo-pedido')).toBeNull();
      expect(v.extensoes('pedido.criar_em_nome')).toEqual([]);
      expect(v.pode('pedido.criar')).toBe(false);
    }
  });

  it('o item do slot é só da Gestão; o vendedor no Campo segue com o novo pedido dele', () => {
    expect(visao('campo', 'supervisor').extensoes('pedido.criar_em_nome')).toEqual([]);
    expect(visao('campo', 'vendedor').pagina('novo-pedido')).not.toBeNull();
    expect(visao('campo', 'vendedor').extensoes('pedido.criar_em_nome')).toEqual([]);
  });

  it('pilha: Equipe › ficha › novo pedido (seletor) › editor; o voltar desce na ordem e chega à ficha', () => {
    const p = (caminho: string, extra: Record<string, string> = {}): ParamsDaRota => ({ caminho: caminho.split('/'), ...extra });
    const abrir = (h: HistoricoShell, params: ParamsDaRota, modo: 'navegar' | 'fora' = 'navegar') => abrirTela(h, entradaDaRota(params), modo, 'inicio').historico;
    const equipe = p('equipe');
    const ficha = p('equipe-membro', { id: 'v1' });
    const seletor = p('novo-pedido', { vendedorId: 'v1', autorId: 's1' });
    // o seletor de cliente usa router.setParams({ customerId }): os outros parâmetros ficam (o vendedorId não se perde)
    const editor = p('novo-pedido', { vendedorId: 'v1', autorId: 's1', customerId: 'c1' });
    let h = abrir(HISTORICO_VAZIO, equipe, 'fora');
    h = abrir(h, ficha);
    h = abrir(h, seletor);
    h = abrir(h, editor);
    // tudo na pilha da aba Equipe (a aba acesa continua Equipe, sem pular para Pedidos)
    expect(h.aba).toBe('/m/equipe');
    expect(h.pilhas['/m/equipe']!.map((e) => e.chave)).toEqual([entradaDaRota(equipe).chave, entradaDaRota(ficha).chave, entradaDaRota(seletor).chave, entradaDaRota(editor).chave]);
    expect(entradaDaRota(editor).href).toContain('vendedorId=v1');
    // voltar: editor → seletor (com o vendedorId) → ficha do vendedor
    const antesDoEditor = telaAnterior(h, entradaDaRota(editor).chave)!;
    expect(antesDoEditor.chave).toBe(entradaDaRota(seletor).chave);
    h = abrir(h, antesDoEditor.params);
    expect(telaAnterior(h, antesDoEditor.chave)!.chave).toBe(entradaDaRota(ficha).chave);
  });
});
