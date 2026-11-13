import { describe, expect, it } from 'vitest';
import { criarRelogio } from '@macuxi/comum/relogio';
import { aplicarEventos, estadoInicial, visaoDaEquipe, rankingDaEquipe } from '../../domain';
import { pedidoCriado, statusAlterado, SUPERVISOR, u, VENDEDOR } from '../../domain/fixtures';
import type { MembroEquipe } from '../../contracts';
import { BOM_CSV } from '@macuxi/comum/csv';
import { CABECALHO_EQUIPE, csvDaEquipe, csvDoRanking } from './csv';

const relogio = criarRelogio({ agora: '2026-11-03T15:00:00Z' });
const MEMBROS: MembroEquipe[] = [
  { id: SUPERVISOR, nome: 'Sara', perfil: 'supervisor', superior_id: null, ativo: true },
  { id: VENDEDOR, nome: 'Vera; "a melhor"', perfil: 'vendedor', superior_id: SUPERVISOR, ativo: true },
];
const estado = aplicarEventos(estadoInicial(), [
  pedidoCriado({ pedido: u(900), vendedor: VENDEDOR, total: 123_456, em: relogio.instante({ hora: '09:00' }).toISOString() }),
  statusAlterado({ pedido: u(900), vendedor: VENDEDOR, para: 'aprovado', em: relogio.instante({ hora: '09:01' }).toISOString() }),
]).estado;
const viewer = { id: SUPERVISOR, perfil: 'supervisor' as const };
const modulos = new Set(['core', 'vendedor']);

describe('CSV do BKO do Gestor', () => {
  it('equipe: cabeçalho, reais com vírgula decimal e texto com ; entre aspas', () => {
    const v = visaoDaEquipe({ estado, membros: MEMBROS, viewer, escopo: { tipo: 'equipe', ids: new Set([VENDEDOR]) }, data: relogio.hoje(), modulos, agora: relogio.iso() });
    const [cab, linha] = csvDaEquipe(v).trimEnd().split('\n');
    expect(cab).toBe(BOM_CSV + CABECALHO_EQUIPE.join(';'));
    expect(csvDaEquipe(v).startsWith(BOM_CSV)).toBe(true);
    expect(linha).toContain('"Vera; ""a melhor"""');
    expect(linha).toContain(';1234,56;1;');
  });

  it('ranking: posição, valor em reais quando o indicador é dinheiro', () => {
    const r = rankingDaEquipe({ estado, membros: MEMBROS, viewer, indicador: 'vendas_cents', periodo: 'diario', data_ref: relogio.hoje(), modulos, agora: relogio.iso() });
    expect(csvDoRanking(r).split('\n')[1]).toBe(`1;"Vera; ""a melhor""";vendedor;1234,56;${relogio.hoje()};${relogio.hoje()}`);
  });
});
