import { describe, expect, it } from 'vitest';
import { criarRegistroExtensoes } from './extensoes';

interface AbaCliente {
  titulo: string;
}

function registro() {
  const r = criarRegistroExtensoes<{ 'cliente.abas': AbaCliente; 'pedido.criar_em_nome': { rota: string } }>();
  r.declararSlot('cliente.abas', 'core');
  r.declararSlot('pedido.criar_em_nome', 'vendedor');
  r.registrar('cliente.abas', { modulo: 'vendedor', id: 'pedidos', ordem: 20, payload: { titulo: 'Pedidos' } });
  r.registrar('cliente.abas', { modulo: 'promotor', id: 'trade', ordem: 10, perfis: ['promotor', 'supervisor'], payload: { titulo: 'Trade' } });
  r.registrar('cliente.abas', { modulo: 'pesquisa', id: 'pesquisas', payload: { titulo: 'Pesquisas' } });
  r.registrar('pedido.criar_em_nome', { modulo: 'gestor', id: 'em-nome', payload: { rota: '/pedido/novo' } });
  return r;
}

describe('pontos de extensão', () => {
  it('lista só itens de módulos ativos, na ordem', () => {
    const itens = registro().listar('cliente.abas', { modulosAtivos: ['core', 'vendedor', 'promotor'] });
    expect(itens.map((i) => i.payload.titulo)).toEqual(['Trade', 'Pedidos']);
  });

  it('filtra por perfil quando o item restringe', () => {
    const itens = registro().listar('cliente.abas', { modulosAtivos: ['core', 'vendedor', 'promotor', 'pesquisa'], perfil: 'vendedor' });
    expect(itens.map((i) => i.id)).toEqual(['pedidos', 'pesquisas']);
  });

  it('RN-CORE-03: dono do slot inativo → extensão some sem erro', () => {
    expect(registro().listar('pedido.criar_em_nome', { modulosAtivos: ['core', 'gestor'] })).toEqual([]);
    expect(registro().listar('pedido.criar_em_nome', { modulosAtivos: ['core', 'gestor', 'vendedor'] })).toHaveLength(1);
  });

  it('slot precisa ser declarado pelo dono, uma vez; item não repete', () => {
    const r = registro();
    expect(() => r.registrar('menu.itens' as 'cliente.abas', { modulo: 'vendedor', id: 'x', payload: { titulo: 'x' } })).toThrow('não declarado');
    expect(() => r.declararSlot('cliente.abas', 'vendedor')).toThrow('já pertence a core');
    expect(() => r.registrar('cliente.abas', { modulo: 'vendedor', id: 'pedidos', payload: { titulo: 'de novo' } })).toThrow('já registrado');
    expect(() => r.declararSlot('abas' as 'cliente.abas', 'core')).toThrow('inválido');
    expect(r.donoDoSlot('cliente.abas')).toBe('core');
  });
});
