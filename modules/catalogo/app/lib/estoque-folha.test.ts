import { describe, expect, it } from 'vitest';
import type { ItemVitrine } from '../../contracts';
import { dadosDaFolha, mostraEstoquePorFilial, opcoesDoFiltroFilial } from './estoque-folha';

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
  it('spec §3: o botão da folha só aparece com mais de uma filial no estoque', () => {
    expect(mostraEstoquePorFilial(null)).toBe(false);
    expect(mostraEstoquePorFilial(disp([{ id: 'v', nome: 'Boa Vista', q: 3 }]))).toBe(false);
    expect(mostraEstoquePorFilial(disp([{ id: 'v', nome: 'Boa Vista', q: 3 }, { id: 'm', nome: 'Manaus', q: 0 }]))).toBe(true);
  });

  it('spec §2.1: linha "Atualizado às hh:mm" no fuso do tenant; a filial de cadastro primeiro, "sua filial", as outras em ordem alfabética', () => {
    const d = dadosDaFolha({
      availability: disp([{ id: 'v', nome: 'Boa Vista', q: 0 }, { id: 'b', nome: 'Belém', q: -2 }, { id: 'm', nome: 'Manaus', q: 12 }]),
      cargaEm: '2026-11-15T10:12:00Z',
      filialCadastro: 'v',
      agora: AGORA,
      fuso: 'America/Manaus',
    });
    expect(d.apoio).toBe('Atualizado às 06:12');
    expect(d.linhas.map((l) => [l.nome, l.valor, l.propria])).toEqual([['Boa Vista', '0', true], ['Belém', '−2', false], ['Manaus', '12', false]]);
    expect(d.leitura.map((l) => l.texto)).toEqual(['Boa Vista, sua filial, estoque 0', 'Belém, estoque menos 2', 'Manaus, estoque 12']);
  });

  it('decisão 3 do R-20261115-100000: a folha lista só as filiais de venda, sem linha "Total"', () => {
    const d = dadosDaFolha({ availability: disp([{ id: 'w', nome: 'W', q: 2 }, { id: 'v', nome: 'V', q: 1 }]), cargaEm: AGORA, filialCadastro: 'w', agora: AGORA, fuso: 'America/Manaus' });
    expect(d.linhas.map((l) => l.nome)).toEqual(['W', 'V']);
    expect(d.leitura.some((l) => /total/i.test(l.texto))).toBe(false);
  });

  it('RN-CAT-07: estoque desatualizado mostra só a hora da carga, sem repetir a idade na linha', () => {
    const velho = dadosDaFolha({ availability: disp([{ id: 'v', nome: 'V', q: 1 }], { stale: true }), cargaEm: '2026-11-15T10:12:00Z', filialCadastro: null, agora: AGORA, fuso: 'America/Manaus' });
    expect(velho.apoio).toBe('Atualizado às 06:12');
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
