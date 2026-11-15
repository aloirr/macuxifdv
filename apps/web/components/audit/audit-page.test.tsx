/**
 * Auditoria na revisão do BKO (docs/design/telas/bko-revisao.md §P1, §P2, §P4, §P6 e §P7), com `react-dom/server`:
 * contagem só no título ("· 300+" no limite da API), sem subtítulo nem contagem repetida, "Atualizar" no "⋯" da página,
 * tabela sem rolagem lateral, vazio uma vez (com e sem filtro) e "Limpar filtros" só com filtro ligado. Dados fictícios.
 */
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const sim = vi.hoisted(() => ({ entidade: '', linhas: [] as unknown[] }));
vi.mock('next/navigation', () => ({
  useSearchParams: () => new URLSearchParams(sim.entidade ? { entity: sim.entidade } : {}),
  useRouter: () => ({ replace: () => undefined }),
  usePathname: () => '/auditoria',
}));
vi.mock('@/lib/session', () => ({ useSessao: () => ({ user: { fuso: 'America/Manaus' } }) }));
vi.mock('@/lib/queries', () => ({
  useMe: () => ({ data: undefined }),
  useAuditoria: () => ({ data: sim.linhas, isError: false, isPending: false, isFetching: false, refetch: async () => undefined }),
}));

const { AuditPage, LIMITE_AUDITORIA } = await import('./audit-page');

const linha = (i: number) => ({
  id: `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`,
  modulo: 'core',
  acao: 'cliente.editar',
  entidade: 'cliente',
  entidade_id: null,
  usuario_id: null,
  usuario_nome: 'Ana Teste',
  antes: null,
  depois: null,
  ocorrido_em: '2026-11-15T12:00:00Z',
});
const html = () => renderToStaticMarkup(<AuditPage />);

beforeEach(() => {
  sim.entidade = '';
  sim.linhas = [];
});

describe('Auditoria (revisão do BKO)', () => {
  it('com registros: a contagem fica só no título, a tabela é a do kit e o Atualizar vai no "⋯"', () => {
    sim.linhas = [linha(1), linha(2)];
    const m = html();
    expect(m).toContain('Auditoria · 2</h1>');
    expect(m).not.toContain('registros mais recentes');
    expect(m).not.toContain('Quem alterou o quê');
    expect(m).toContain('data-testid="auditoria.tabela"');
    expect(m).toContain('table-fixed');
    expect(m).toContain('data-testid="auditoria.mais-acoes"');
    expect(m).not.toContain('auditoria.limpar-filtros');
  });
  it('no limite da API: "300+"', () => {
    sim.linhas = Array.from({ length: LIMITE_AUDITORIA }, (_, i) => linha(i));
    expect(html()).toContain('Auditoria · 300+</h1>');
  });
  it('sem registro: o vazio uma vez, sem quadro nem tabela, e o título sem número', () => {
    const m = html();
    expect(m).toContain('Auditoria</h1>');
    expect(m).toContain('Nenhum registro ainda.');
    expect(m).not.toContain('<table');
    expect(m).not.toContain('Trilha de auditoria');
  });
  it('com filtro e sem resultado: a frase do filtro e o "Limpar filtros" só na barra', () => {
    sim.entidade = 'cliente';
    const m = html();
    expect(m).toContain('Nenhum registro com esses filtros.');
    expect(m.match(/Limpar filtros/g)).toHaveLength(1);
  });
});
