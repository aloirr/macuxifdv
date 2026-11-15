import { describe, expect, it } from 'vitest';
import { ESTADOS_LOTE } from '../contracts';
import {
  acoesDoLote,
  autorizacaoReprocessar,
  duracaoLoteSegundos,
  estadosDoStatus,
  formatarDuracaoLote,
  limiteTentativasAutorizacao,
  linhasIntegradas,
  podeCancelarLote,
  podeReprocessarLote,
  statusDoLote,
  STATUS_LOTE,
  transicionarLote,
} from '.';

describe('RN-INT-15: os 5 status do lote na tela', () => {
  it('RN-INT-15: recebido e processando são Em andamento', () => {
    expect(statusDoLote('recebido')).toBe('em_andamento');
    expect(statusDoLote('processando')).toBe('em_andamento');
  });

  it('RN-INT-15: concluido, concluido_com_erros, falhou e cancelado têm um status cada', () => {
    expect(statusDoLote('concluido')).toBe('concluido');
    expect(statusDoLote('concluido_com_erros')).toBe('concluido_com_avisos');
    expect(statusDoLote('falhou')).toBe('com_falha');
    expect(statusDoLote('cancelado')).toBe('cancelado');
  });

  it('RN-INT-15: todo estado do contrato mapeia para um dos 5 status e o filtro devolve os mesmos estados', () => {
    expect(new Set(ESTADOS_LOTE.map(statusDoLote)).size).toBe(5);
    for (const s of STATUS_LOTE) for (const e of estadosDoStatus(s)) expect(statusDoLote(e)).toBe(s);
    expect(STATUS_LOTE.flatMap(estadosDoStatus).sort()).toEqual([...ESTADOS_LOTE].sort());
  });
});

describe('RN-INT-15: ações válidas por status', () => {
  it('RN-INT-15: Cancelar só em andamento', () => {
    for (const e of ESTADOS_LOTE) expect(podeCancelarLote(e), e).toBe(e === 'recebido' || e === 'processando');
  });

  it('RN-INT-15: Reprocessar só em Com falha e Concluído com avisos', () => {
    for (const e of ESTADOS_LOTE) expect(podeReprocessarLote(e), e).toBe(e === 'falhou' || e === 'concluido_com_erros');
  });

  it('RN-INT-15: concluído e cancelado não têm ação; ação que não vale não aparece', () => {
    expect(acoesDoLote('concluido')).toEqual([]);
    expect(acoesDoLote('cancelado')).toEqual([]);
    expect(acoesDoLote('processando')).toEqual(['cancelar']);
    expect(acoesDoLote('falhou')).toEqual(['reprocessar']);
    expect(acoesDoLote('concluido_com_erros')).toEqual(['reprocessar']);
  });
});

describe('RN-INT-15: cancelar e reprocessar na máquina de estados (RN-INT-08)', () => {
  it('RN-INT-15: recebido e processando podem ser cancelados; cancelado é final', () => {
    expect(transicionarLote('recebido', 'cancelado').ok).toBe(true);
    expect(transicionarLote('processando', 'cancelado').ok).toBe(true);
    for (const para of ESTADOS_LOTE) expect(transicionarLote('cancelado', para).ok, para).toBe(false);
  });

  it('RN-INT-15: concluído com erros e falhou voltam para a fila (recebido) ao reprocessar; concluído não cancela', () => {
    expect(transicionarLote('concluido_com_erros', 'recebido').ok).toBe(true);
    expect(transicionarLote('falhou', 'recebido').ok).toBe(true);
    expect(transicionarLote('concluido', 'cancelado').ok).toBe(false);
  });
});

describe('RN-INT-15: duração e linhas integradas', () => {
  const t0 = '2026-11-15T14:31:00.000Z';
  it('RN-INT-15: duração vai do início à conclusão; em andamento, até agora; sem início, nula', () => {
    expect(duracaoLoteSegundos(t0, '2026-11-15T14:33:10.000Z', new Date('2026-11-15T20:00:00Z'))).toBe(130);
    expect(duracaoLoteSegundos(t0, null, new Date('2026-11-15T14:31:45.000Z'))).toBe(45);
    expect(duracaoLoteSegundos(null, null, new Date('2026-11-15T20:00:00Z'))).toBeNull();
  });

  it('RN-INT-15: formato 45 s, 2 min 10 s, 3 min e 1 h 05 min', () => {
    expect(formatarDuracaoLote(45)).toBe('45 s');
    expect(formatarDuracaoLote(130)).toBe('2 min 10 s');
    expect(formatarDuracaoLote(180)).toBe('3 min');
    expect(formatarDuracaoLote(3900)).toBe('1 h 05 min');
    expect(formatarDuracaoLote(3600)).toBe('1 h 00 min');
    expect(formatarDuracaoLote(null)).toBe('');
    expect(formatarDuracaoLote(-5)).toBe('0 s');
  });

  it('RN-INT-15: linhas integradas = recebidas - erros; com erro mostra "x de y"', () => {
    expect(linhasIntegradas(1240, 0)).toEqual({ integradas: 1240, total: 1240, comErro: false });
    expect(linhasIntegradas(1240, 60)).toEqual({ integradas: 1180, total: 1240, comErro: true });
    expect(linhasIntegradas(10, 99)).toEqual({ integradas: 0, total: 10, comErro: true });
  });
});

describe('RN-INT-16: autorização do reprocessamento por senha de quem pode', () => {
  it('RN-INT-16: quem tem lote.reprocessar reprocessa direto', () => {
    expect(autorizacaoReprocessar({ solicitantePode: true, autorizador: null })).toEqual({ ok: true, via: 'direto' });
  });

  it('RN-INT-16: sem a permissão e sem autorizador, pede o autorizador', () => {
    expect(autorizacaoReprocessar({ solicitantePode: false, autorizador: null })).toMatchObject({ ok: false, codigo: 'autorizador_necessario' });
  });

  it('RN-INT-16: o autorizador precisa ter lote.reprocessar (admin ou analista)', () => {
    expect(autorizacaoReprocessar({ solicitantePode: false, autorizador: { perfil: 'admin' } })).toEqual({ ok: true, via: 'autorizado' });
    expect(autorizacaoReprocessar({ solicitantePode: false, autorizador: { perfil: 'gerente' } })).toMatchObject({ ok: false, codigo: 'autorizador_sem_permissao' });
  });

  it('RN-INT-16: limite de 5 tentativas de senha por solicitante em 15 minutos', () => {
    expect(limiteTentativasAutorizacao(4)).toEqual({ bloqueado: false });
    expect(limiteTentativasAutorizacao(5)).toMatchObject({ bloqueado: true });
  });
});
