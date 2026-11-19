import { describe, expect, it } from 'vitest';
import { corpoDosAprovadores, formDosAprovadores, houveMudanca, ROTULO_NIVEL } from './aprovadores-form';

const base = { seller_pct: 5, supervisor_pct: 10, manager_pct: 15, above_manager: 'director' as const, exceptions: [] };

describe('BKO > Parâmetros > Pedidos: quem aprova crédito e inadimplência (T-0184, P2 B, P5 B)', () => {
  it('RN-VEN-12 e RN-VEN-13: o padrão dos dois campos é gerente (servidor sem os campos)', () => {
    expect(formDosAprovadores(base)).toEqual({ credito: 'gerente', inadimplencia: 'gerente' });
  });
  it('lê os níveis que o servidor devolve e monta o corpo do PUT', () => {
    const f = formDosAprovadores({ ...base, aprovador_credito: 'analista', aprovador_inadimplencia: 'supervisor' });
    expect(f).toEqual({ credito: 'analista', inadimplencia: 'supervisor' });
    expect(corpoDosAprovadores(f)).toEqual({ aprovador_credito: 'analista', aprovador_inadimplencia: 'supervisor' });
  });
  it('Salvar e Descartar só habilitam com mudança', () => {
    const atual = formDosAprovadores(base);
    expect(houveMudanca(atual, atual)).toBe(false);
    expect(houveMudanca({ ...atual, credito: 'analista' }, atual)).toBe(true);
  });
  it('os rótulos são os mesmos níveis das Alçadas', () => {
    expect(ROTULO_NIVEL).toEqual({ supervisor: 'Supervisor', gerente: 'Gerente', analista: 'Analista comercial' });
  });
});
