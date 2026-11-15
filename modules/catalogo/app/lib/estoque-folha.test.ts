import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import type { ItemVitrine } from '../../contracts';
import { dadosDaFolha, opcoesDoFiltroFilial } from './estoque-folha';

type Disp = NonNullable<ItemVitrine['availability']>;
const disp = (por: { id: string; nome: string; q: number | null }[], o: Partial<Disp> = {}): Disp => ({
  product_id: 'p',
  band: 'disponivel',
  quantity: por.reduce((n, b) => n + (b.q ?? 0), 0),
  by_branch: por.map((b) => ({ branch_id: b.id, branch_name: b.nome, band: (b.q ?? 0) > 0 ? 'disponivel' : 'sem_estoque', quantity: b.q })),
  updated_at: '2026-11-15T11:28:00Z',
  stale: false,
  ...o,
});
const AGORA = '2026-11-15T16:00:00Z';

describe('folha "Estoque por filial" (catalogo-campo-v2 §2.1)', () => {
  it('spec §2.1: título, linha "código · Atualizado às hh:mm" no fuso do tenant e as filiais de venda do usuário primeiro', () => {
    const d = dadosDaFolha({
      codigo: 'PAF.1434',
      availability: disp([{ id: 'm', nome: 'Manaus', q: 12 }, { id: 'b', nome: 'Belém', q: -2 }, { id: 'v', nome: 'Boa Vista', q: 0 }]),
      proprias: ['v'],
      agora: AGORA,
      fuso: 'America/Manaus',
    });
    expect(d.titulo).toBe('Estoque por filial');
    expect(d.apoio).toBe('PAF.1434 · Atualizado às 07:28');
    expect(d.linhas.map((l) => [l.nome, l.valor, l.propria])).toEqual([['Boa Vista', '0', false], ['Belém', '−2', false], ['Manaus', '12', false]]);
    expect(d.leitura.map((l) => l.texto)).toEqual(['Boa Vista, estoque 0', 'Belém, estoque menos 2', 'Manaus, estoque 12']);
  });

  it('RN-CORE-39 / spec §2.1: a folha lista só filiais de venda, então nenhuma linha leva a marca "sua filial"', () => {
    const d = dadosDaFolha({ codigo: 'X', availability: disp([{ id: 'v', nome: 'Boa Vista', q: 3 }]), proprias: ['v'], agora: AGORA, fuso: 'America/Manaus' });
    expect(d.linhas[0]).toMatchObject({ propria: false });
    expect(d.leitura[0]!.texto).toBe('Boa Vista, estoque 3');
  });

  it('RN-CAT-07: na virada do dia (23:59, 00:00, 00:03, 00:06 em Manaus) a linha troca para "em dd/mm" só quando a carga foi no dia anterior', () => {
    const casos: Array<[string, string]> = [
      ['2026-11-04T03:59:00Z', 'Atualizado às 23:54'],
      ['2026-11-04T04:00:00Z', 'Atualizado em 03/11 às 23:55'],
      ['2026-11-04T04:03:00Z', 'Atualizado em 03/11 às 23:58'],
      ['2026-11-04T04:06:00Z', 'Atualizado às 00:01'],
    ];
    for (const [agora, esperado] of casos) {
      const r = criarRelogio({ agora });
      const d = dadosDaFolha({ codigo: 'C', availability: disp([{ id: 'v', nome: 'V', q: 1 }], { updated_at: r.relativo({ minutos: -5 }).toISOString() }), proprias: [], agora: r.iso(), fuso: 'America/Manaus' });
      expect(d.apoio, agora).toBe(`C · ${esperado}`);
    }
  });

  it('RN-CAT-07: sem hora da carga a linha diz "Sem hora de atualização"; estoque desatualizado avisa', () => {
    const sem = dadosDaFolha({ codigo: 'C', availability: disp([{ id: 'v', nome: 'V', q: 1 }], { updated_at: null }), proprias: [], agora: AGORA, fuso: 'America/Manaus' });
    expect(sem.apoio).toBe('C · Sem hora de atualização');
    const velho = dadosDaFolha({ codigo: 'C', availability: disp([{ id: 'v', nome: 'V', q: 1 }], { stale: true }), proprias: [], agora: AGORA, fuso: 'America/Manaus' });
    expect(velho.apoio).toBe('C · Estoque desatualizado · Atualizado às 07:28');
  });

  it('spec §2.1: tenant que esconde a quantidade mostra "Em estoque" ou "Sem estoque" por filial', () => {
    const a = disp([{ id: 'v', nome: 'V', q: null }, { id: 'w', nome: 'W', q: null }], { quantity: null });
    a.by_branch[1] = { ...a.by_branch[1]!, band: 'sem_estoque' };
    a.by_branch[0] = { ...a.by_branch[0]!, band: 'disponivel' };
    const d = dadosDaFolha({ codigo: 'C', availability: a, proprias: [], agora: AGORA, fuso: 'America/Manaus' });
    expect(d.linhas.map((l) => [l.nome, l.valor, l.tom])).toEqual([['V', 'Em estoque', 'sucesso'], ['W', 'Sem estoque', 'erro']]);
  });
});

describe('filtro de filial da folha "Filtrar" (catalogo-campo-v2 §4)', () => {
  const filiais = [{ id: 'v', nome: 'Boa Vista' }, { id: 'b', nome: 'Belém' }, { id: 'm', nome: 'Manaus' }];

  it('RN-CORE-39 / spec §4: todo perfil — "Suas filiais (N)" e cada filial de venda, sem as outras; com uma só o grupo não aparece', () => {
    expect(opcoesDoFiltroFilial({ proprias: ['v', 'm'], filiais })).toEqual([
      { valor: 'todas', rotulo: 'Suas filiais (2)', apoio: null },
      { valor: 'v', rotulo: 'Boa Vista', apoio: null },
      { valor: 'm', rotulo: 'Manaus', apoio: null },
    ]);
    expect(opcoesDoFiltroFilial({ proprias: ['v'], filiais })).toEqual([]);
  });
});
