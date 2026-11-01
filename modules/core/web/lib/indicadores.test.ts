import { describe, expect, it } from 'vitest';
import type { IndicadoresLista } from '../../contracts';
import { painelDoUsuario } from '../../domain';
import { painelLocal } from '../../app/lib/metas-local';
import { textoDaLinha } from '../../app/lib/metas-formato';
import { celulasDoUsuario, centavosDoTexto, csvDeIndicadores } from './indicadores';

const U = '00000000-0000-4000-8000-000000000001';
const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const base = { updated_at: '2026-10-07T10:00:00.000000Z', deleted_at: null, external_id: null };
const paradas = [
  { ...base, id: id(11), rota_id: id(9), usuario_id: U, data: '2026-10-05', cliente_id: id(21), sequencia: 1, janela_inicio: null, janela_fim: null },
  { ...base, id: id(12), rota_id: id(9), usuario_id: U, data: '2026-10-05', cliente_id: id(22), sequencia: 2, janela_inicio: null, janela_fim: null },
];
const visitas = [
  { ...base, id: id(31), usuario_id: U, cliente_id: id(21), rota_parada_id: id(11), data_local: '2026-10-05', checkin_em: '2026-10-05T14:00:00.000000Z', checkout_em: null, extra: false },
];
const diarios = [{ ...base, id: id(41), usuario_id: U, data: '2026-10-02', pedidos: 1, vendido_cents: 400_00, cancelado_cents: 0 }];
const metas = [{ ...base, id: id(51), usuario_id: U, periodo: '2026-10', indicador: 'venda_cents' as const, valor: 1_000_00 }];

describe('critério 2 da T-0020: app e BKO mostram os mesmos números a partir do mesmo dado', () => {
  const agora = new Date('2026-10-07T15:00:00Z');
  const app = painelLocal({ paradas, visitas: visitas as never, diarios, metas }, [], { usuarioId: U, fuso: 'America/Manaus', agora });

  it('RN-CORE-20/21: o painel do aparelho é igual ao que a API calcula com as mesmas linhas', () => {
    const api = painelDoUsuario({ periodo: '2026-10', usuario_id: U, hoje: '2026-10-07', paradas, visitas: visitas as never, diarios, metas });
    expect({ indicadores: app.indicadores, metas: app.metas }).toEqual(api);
    expect(app.indicadores).toMatchObject({ planejados: 2, visitados: 1, cobertura_pct: 5000, realizado_cents: 400_00 });
  });

  it('RN-CORE-20..22: a linha da tabela do BKO traz exatamente o texto da tela do app', () => {
    const lista = { periodo: '2026-10', base_apuracao: 'aprovado', itens: [{ usuario_id: U, usuario_nome: 'Vera', indicadores: app.indicadores, metas: app.metas }] } as unknown as IndicadoresLista;
    const [nome, visitados, cobertura, positivados, realizado, meta, ating] = celulasDoUsuario(lista.itens[0]!);
    const venda = textoDaLinha(app.metas[0]!);
    expect([nome, visitados, cobertura, positivados, realizado, meta, ating]).toEqual(['Vera', '1 de 2', '50,00%', 'Aguardando pedidos', venda.realizado, venda.meta, venda.atingimento]);
    expect(csvDeIndicadores(lista)).toContain('"Vera";"1 de 2";"50,00%"');
  });

  it('RN-CORE-20: a meta em reais digitada vira centavos inteiros', () => {
    expect(centavosDoTexto('12.345,67')).toBe(1_234_567);
    expect(centavosDoTexto('abc')).toBeNull();
  });
});
