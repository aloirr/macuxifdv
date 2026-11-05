import { describe, expect, it } from 'vitest';

import { InicioSchema, SessaoRespostaSchema } from '../../contracts';
import { tolerante } from './leitor-tolerante';

const base = { dia: '2026-10-15', periodo: '2026-10', calculado_em: '2026-10-15T12:00:00.000Z', escopo: 'proprio', usuarios: [], metas_do_dia: [] };

describe('T-0076 C1: leitor tolerante do core.inicio@1 no app', () => {
  it('o contrato estrito recusa campo extra (referência)', () => {
    expect(InicioSchema.safeParse({ ...base, campo_futuro: 'x' }).success).toBe(false);
  });
  it('resposta com campo extra é aceita e o campo some', () => {
    const r = tolerante(InicioSchema).safeParse({ ...base, campo_futuro: 'x' });
    expect(r.success).toBe(true);
    if (r.success) expect(r.data).not.toHaveProperty('campo_futuro');
  });
  it('resposta sem campo obrigatório continua recusada', () => {
    const { dia: _dia, ...semDia } = base;
    expect(tolerante(InicioSchema).safeParse(semDia).success).toBe(false);
    expect(tolerante(InicioSchema).safeParse({ ...base, dia: 'ontem' }).success).toBe(false);
  });
  it('login: campo novo no usuário é ignorado, token ausente é recusado', () => {
    const t = tolerante(SessaoRespostaSchema);
    expect(t.safeParse({}).success).toBe(false);
  });
});
