import { describe, expect, it } from 'vitest';
import { calcularInativacao, novaSessao, registrarParte, situacaoSessao } from './sessao';

const t0 = '2026-10-31T10:00:00Z';
const base = () => novaSessao('s1', 'cliente', t0);

describe('RN-INT-06: sessão de carga completa', () => {
  it('RN-INT-06: só está completa depois do último lote, com todas as partes 1..n concluídas', () => {
    let s = registrarParte(base(), { parte: 1, ultimo: false, status: 'concluido' });
    expect(situacaoSessao(s, t0)).toBe('aberta');
    s = registrarParte(s, { parte: 3, ultimo: true, status: 'concluido' });
    expect(situacaoSessao(s, t0)).toBe('aberta'); // falta a parte 2
    s = registrarParte(s, { parte: 2, ultimo: false, status: 'concluido_com_erros' });
    expect(situacaoSessao(s, t0)).toBe('completa');
  });

  it('RN-INT-06: parte falhou ou ainda processando mantém a sessão aberta; reenvio da parte conserta', () => {
    let s = registrarParte(base(), { parte: 1, ultimo: true, status: 'falhou' });
    expect(situacaoSessao(s, t0)).toBe('aberta');
    s = registrarParte(s, { parte: 1, ultimo: true, status: 'processando' });
    expect(situacaoSessao(s, t0)).toBe('aberta');
    s = registrarParte(s, { parte: 1, ultimo: true, status: 'concluido' });
    expect(situacaoSessao(s, t0)).toBe('completa');
  });

  it('RN-INT-06: parte além da última declarada torna a sessão inconsistente (não completa)', () => {
    let s = registrarParte(base(), { parte: 2, ultimo: false, status: 'concluido' });
    s = registrarParte(s, { parte: 1, ultimo: true, status: 'concluido' });
    expect(situacaoSessao(s, t0)).toBe('aberta');
  });

  it('RN-INT-06: sessão sem fechar expira depois do TTL parametrizável (24 h por padrão)', () => {
    const s = registrarParte(base(), { parte: 1, ultimo: false, status: 'concluido' });
    expect(situacaoSessao(s, '2026-11-01T09:59:59Z')).toBe('aberta');
    expect(situacaoSessao(s, '2026-11-01T10:00:01Z')).toBe('expirada');
    expect(situacaoSessao(s, '2026-10-31T10:11:00Z', { ttlMin: 10 })).toBe('expirada');
  });

  it('RN-INT-06: sessão completa não expira depois de fechada', () => {
    const s = registrarParte(base(), { parte: 1, ultimo: true, status: 'concluido' });
    expect(situacaoSessao(s, '2027-01-01T00:00:00Z')).toBe('completa');
  });

  it('RN-INT-06: registrarParte não altera a sessão original (imutável)', () => {
    const s = base();
    registrarParte(s, { parte: 1, ultimo: true, status: 'concluido' });
    expect(s.partes).toEqual({});
  });
});

describe('RN-INT-06: inativação da carga completa', () => {
  const completa = () => registrarParte(base(), { parte: 1, ultimo: true, status: 'concluido' });
  const aberta = () => registrarParte(base(), { parte: 1, ultimo: false, status: 'concluido' });

  it('RN-INT-06: com a sessão completa, inativa os ativos ausentes da carga (nunca apaga)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A', 'B', 'C', 'D'], recebidosNaSessao: ['A', 'C'] });
    expect(r).toEqual({ permitido: true, inativar: ['B', 'D'], motivo: null });
  });

  it('RN-INT-06: sessão incompleta não inativa nada', () => {
    const r = calcularInativacao({ sessao: aberta(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'] });
    expect(r.permitido).toBe(false);
    expect(r.inativar).toEqual([]);
    expect(r.motivo).toBe('sessao_incompleta');
  });

  it('RN-INT-06: sessão expirada não inativa nada', () => {
    const r = calcularInativacao({ sessao: aberta(), agora: '2026-12-01T00:00:00Z', ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'] });
    expect(r).toMatchObject({ permitido: false, inativar: [], motivo: 'sessao_incompleta' });
  });

  it('RN-INT-06: linha sem external_id legível na sessão bloqueia a inativação (não dá para saber o que faltou)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A'], linhasSemExternalId: 1 });
    expect(r).toMatchObject({ permitido: false, inativar: [], motivo: 'linhas_sem_external_id' });
  });

  it('RN-INT-06: sessão completa sem nenhum registro recebido não inativa (proteção contra carga vazia)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A'], recebidosNaSessao: [] });
    expect(r).toMatchObject({ permitido: false, inativar: [], motivo: 'carga_vazia' });
  });

  it('RN-INT-06: registro com erro de validação mas presente na carga não é inativado (basta estar em recebidosNaSessao)', () => {
    const r = calcularInativacao({ sessao: completa(), agora: t0, ativosNoMacuxi: ['A', 'B'], recebidosNaSessao: ['A', 'B'] });
    expect(r.inativar).toEqual([]);
    expect(r.permitido).toBe(true);
  });
});
