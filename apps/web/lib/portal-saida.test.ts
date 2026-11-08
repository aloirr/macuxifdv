/** T-0087 fatia E, revisão de UX R-20261106-050553 R1 e Y2: os links que aparecem uma vez seguram a saída do portal. */
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  assinarSaida,
  AVISO_TETO_MS,
  avisoDeFimDaSessao,
  baixarPendencias,
  descartarPendenciasDeSaida,
  haSaidaSegurada,
  liberarSaida,
  pendenciasDeSaida,
  segurarSaida,
  versaoDaSaida,
} from './portal-saida';
import type { SessaoPortal } from './portal-sessao';

afterEach(() => descartarPendenciasDeSaida());

describe('segurar a saída', () => {
  it('registra, avisa os ouvintes e libera; o mesmo id substitui', () => {
    const ouvinte = vi.fn();
    const parar = assinarSaida(ouvinte);
    const v0 = versaoDaSaida();
    const liberar = segurarSaida({ id: 'equipe-novos:t1', rotulo: 'Baixar convites', baixar: () => undefined });
    segurarSaida({ id: 'equipe-novos:t1', rotulo: 'Baixar convites', baixar: () => undefined });
    expect(pendenciasDeSaida()).toHaveLength(1);
    expect(haSaidaSegurada()).toBe(true);
    expect(versaoDaSaida()).toBeGreaterThan(v0);
    liberar();
    expect(haSaidaSegurada()).toBe(false);
    expect(ouvinte).toHaveBeenCalledTimes(3);
    parar();
  });

  it('"Baixar e sair" baixa todas as pendências (novos e renovados); quem baixa libera a sua', () => {
    const baixados: string[] = [];
    segurarSaida({ id: 'novos', rotulo: 'Baixar convites', baixar: () => (baixados.push('novos'), liberarSaida('novos')) });
    segurarSaida({ id: 'renovados', rotulo: 'Baixar links renovados', baixar: () => (baixados.push('renovados'), liberarSaida('renovados')) });
    baixarPendencias();
    expect(baixados.sort()).toEqual(['novos', 'renovados']);
    expect(haSaidaSegurada()).toBe(false);
  });

  it('"Sair sem baixar" descarta tudo', () => {
    segurarSaida({ id: 'novos', rotulo: 'Baixar convites', baixar: () => undefined });
    descartarPendenciasDeSaida();
    expect(pendenciasDeSaida()).toEqual([]);
  });
});

describe('aviso antes do fim da sessão', () => {
  const agora = Date.parse('2026-11-06T12:00:00Z');
  const sessao = (tokenMin: number, tetoMin: number) =>
    ({ expira_em: new Date(agora + tokenMin * 60_000).toISOString(), sessao_expira_em: new Date(agora + tetoMin * 60_000).toISOString() }) as SessaoPortal;

  it('sem links por baixar, nunca avisa', () => {
    expect(avisoDeFimDaSessao(sessao(1, 5), agora, { pendente: false, usoRecente: false })).toEqual({ tipo: 'nenhum' });
  });
  it('teto a 10 min ou menos: avisa com os minutos (não se renova)', () => {
    expect(avisoDeFimDaSessao(sessao(14, AVISO_TETO_MS / 60_000), agora, { pendente: true, usoRecente: true })).toEqual({ tipo: 'teto', minutos: 10 });
    expect(avisoDeFimDaSessao(sessao(14, 4.5), agora, { pendente: true, usoRecente: true })).toEqual({ tipo: 'teto', minutos: 5 });
  });
  it('token perto do fim e sem uso recente: avisa que vai terminar por falta de uso', () => {
    expect(avisoDeFimDaSessao(sessao(2, 120), agora, { pendente: true, usoRecente: false })).toEqual({ tipo: 'parado', minutos: 2 });
  });
  it('com uso recente o token é renovado: sem aviso; longe do fim: sem aviso; já vencida: o Dialog da sessão terminada cuida', () => {
    expect(avisoDeFimDaSessao(sessao(2, 120), agora, { pendente: true, usoRecente: true })).toEqual({ tipo: 'nenhum' });
    expect(avisoDeFimDaSessao(sessao(12, 120), agora, { pendente: true, usoRecente: false })).toEqual({ tipo: 'nenhum' });
    expect(avisoDeFimDaSessao(sessao(-1, 120), agora, { pendente: true, usoRecente: false })).toEqual({ tipo: 'nenhum' });
    expect(avisoDeFimDaSessao(null, agora, { pendente: true, usoRecente: false })).toEqual({ tipo: 'nenhum' });
  });
});
