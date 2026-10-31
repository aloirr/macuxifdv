import { describe, expect, it } from 'vitest';
import type { DispositivoItem } from '../../contracts';
import { csvDeAparelhos, quandoEmPortugues, textoDoBloqueio } from './aparelhos';

const d = (extra: Partial<DispositivoItem> = {}): DispositivoItem => ({
  id: '5d000000-0000-4000-8000-000000000001',
  usuario_id: '5d000000-0000-4000-8000-000000000002',
  usuario_nome: 'Vera "Vendedora"',
  nome: 'Aparelho da Vera',
  plataforma: 'android',
  ultimo_acesso_em: '2026-10-31T15:30:00.000Z',
  bloqueado_em: null,
  ...extra,
});

describe('RN-CORE-15: tela Aparelhos do BKO', () => {
  it('RN-CORE-15: situação do aparelho vem de bloqueado_em', () => {
    expect(textoDoBloqueio(d())).toBe('Liberado');
    expect(textoDoBloqueio(d({ bloqueado_em: '2026-10-31T16:00:00.000Z' }))).toBe('Bloqueado');
  });
  it('datas aparecem no fuso do tenant (Manaus = UTC−4)', () => {
    expect(quandoEmPortugues('2026-10-31T15:30:00.000Z', 'America/Manaus')).toContain('11:30');
    expect(quandoEmPortugues(null, 'America/Manaus')).toBe('Nunca');
  });
  it('CSV: cabeçalho em português, aspas escapadas e BOM para o Excel', () => {
    const csv = csvDeAparelhos([d(), d({ id: 'x', nome: null, bloqueado_em: '2026-10-31T16:00:00.000Z' })], 'America/Manaus');
    expect(csv.startsWith('﻿"Aparelho";"Usuário"')).toBe(true);
    expect(csv).toContain('"Vera ""Vendedora"""');
    expect(csv).toContain('"Bloqueado"');
  });
});
