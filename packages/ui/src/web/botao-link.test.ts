import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { BotaoLink, classeBotaoLink, type NivelBotaoLink, type PropsBotaoLink } from './botao-link';

// T-0104: sem react-dom; o componente é chamado como função e a árvore de elementos é inspecionada.
type No = { type: unknown; props: Record<string, unknown> & { children?: unknown; className?: string } };

const LARANJA_PURO_EM_TEXTO = /\btext-accent\b(?!-)/;
const NIVEIS: NivelBotaoLink[] = ['principal', 'secundario', 'perigo'];

const montar = (props: Omit<PropsBotaoLink, 'children'> & { children?: PropsBotaoLink['children'] }) =>
  BotaoLink({ children: 'Novo pedido', ...props }) as unknown as No;

describe('classeBotaoLink', () => {
  it('mesma cara do Button web por nível; secundário é o padrão', () => {
    expect(classeBotaoLink('principal')).toContain('bg-ink text-white');
    expect(classeBotaoLink('secundario')).toContain('border border-field bg-surface text-ink');
    expect(classeBotaoLink('perigo')).toContain('bg-danger text-white');
    expect(classeBotaoLink()).toBe(classeBotaoLink('secundario', 'md'));
  });

  it('alvo de 44 px nos dois tamanhos, sem sublinhado, com foco visível', () => {
    for (const nivel of NIVEIS) {
      for (const tamanho of ['md', 'sm'] as const) {
        const c = classeBotaoLink(nivel, tamanho);
        expect(c).toContain('inline-flex');
        expect(c).toContain('min-h-[44px]');
        expect(c).toContain('no-underline');
        expect(c).toContain('font-semibold');
        expect(c).toContain('focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent');
      }
    }
    expect(classeBotaoLink('principal', 'md')).toContain('rounded-xl px-4 text-[14px]');
    expect(classeBotaoLink('principal', 'sm')).toContain('rounded-[10px] px-3 text-[13px]');
  });

  it('desligado: cara de desabilitado, sem hover', () => {
    expect(classeBotaoLink('principal', 'md', true)).toContain('bg-disabled');
    expect(classeBotaoLink('perigo', 'md', true)).toContain('bg-disabled');
    expect(classeBotaoLink('perigo', 'md', true)).not.toContain('bg-danger');
    expect(classeBotaoLink('secundario', 'md', true)).toContain('text-disabled');
    for (const nivel of NIVEIS) {
      expect(classeBotaoLink(nivel, 'md', true)).toContain('cursor-not-allowed');
      expect(classeBotaoLink(nivel, 'md', true)).not.toContain('hover:');
    }
  });

  it('nenhum texto em laranja puro (text-accent sem -ink)', () => {
    for (const nivel of NIVEIS) {
      for (const desligado of [false, true]) expect(classeBotaoLink(nivel, 'md', desligado)).not.toMatch(LARANJA_PURO_EM_TEXTO);
    }
  });
});

describe('BotaoLink: árvore', () => {
  it('<a> com href, classes do nível, testid e atributos extras da tela', () => {
    const a = montar({ nivel: 'principal', href: '/pedidos/novo', testid: 'pedidos.novo', title: 'Criar', className: 'w-full' });
    expect(a.type).toBe('a');
    expect(a.props.href).toBe('/pedidos/novo');
    expect(a.props['data-testid']).toBe('pedidos.novo');
    expect(a.props.title).toBe('Criar');
    expect(a.props.className).toContain(classeBotaoLink('principal'));
    expect(a.props.className).toContain('w-full');
    expect(a.props.target).toBeUndefined();
    expect(a.props.rel).toBeUndefined();
    expect(a.props.children).toEqual(['Novo pedido', undefined]);
  });

  it('padrão é secundário', () => {
    expect(montar({ href: '/x' }).props.className).toContain('border-field');
  });

  it('externo: nova aba com rel seguro e aviso só para leitor de tela', () => {
    const a = montar({ href: 'https://exemplo.com.br', externo: true, children: 'Manual' });
    expect(a.props.target).toBe('_blank');
    expect(a.props.rel).toBe('noopener noreferrer');
    const [texto, aviso] = a.props.children as [string, No];
    expect(texto).toBe('Manual');
    expect(aviso.type).toBe('span');
    expect(aviso.props.className).toBe('sr-only');
    expect(aviso.props.children).toBe(' (abre em nova aba)');
  });

  it('externo: target/rel da tela não enfraquecem o rel seguro', () => {
    const a = montar({ href: 'https://exemplo.com.br', externo: true, rel: 'opener', target: '_self' });
    expect(a.props.target).toBe('_blank');
    expect(a.props.rel).toBe('noopener noreferrer');
  });

  it('desligado: sem href, aria-disabled, papel de link, sem clique nem alvo, fora do Tab', () => {
    const onClick = vi.fn();
    const a = montar({ nivel: 'principal', href: '/pedidos/novo', desligado: true, onClick, target: '_blank', tabIndex: 0, externo: true });
    expect(a.type).toBe('a');
    expect('href' in a.props).toBe(false);
    expect(a.props['aria-disabled']).toBe('true');
    expect(a.props.role).toBe('link');
    expect(a.props.onClick).toBeUndefined();
    expect(a.props.target).toBeUndefined();
    expect(a.props.tabIndex).toBeUndefined();
    expect(a.props.className).toContain('bg-disabled');
    expect(a.props.className).toContain('cursor-not-allowed');
    expect(a.props.children).toBe('Novo pedido');
  });

  it('aceita filhos com ícone', () => {
    const a = montar({ href: '/x', children: [createElement('svg', { key: 'i' }), 'Baixar'] });
    const [filhos] = a.props.children as [Array<No | string>];
    expect((filhos[0] as No).type).toBe('svg');
    expect(filhos[1]).toBe('Baixar');
  });
});
