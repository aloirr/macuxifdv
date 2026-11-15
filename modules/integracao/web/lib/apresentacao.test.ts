import { criarRelogio } from '@macuxi/comum/relogio';
import { describe, expect, it } from 'vitest';
import { ENTIDADES, ESTADOS_LOTE_BKO, ESTADOS_PEDIDO_ERP, SAUDES_CONECTOR, SITUACOES_VERSAO_CONECTOR, type PendenciaInativacao } from '../../contracts';
import {
  ROTULO_ENTIDADE,
  ROTULO_ESTADO_PEDIDO,
  ROTULO_SAUDE,
  ROTULO_SITUACAO_VERSAO,
  ROTULO_STATUS_LOTE,
  decisaoDaPendencia,
  perfilDaSessao,
  podeExecutar,
  tempoDesde,
} from './apresentacao';

/** Uma só linha do tempo por teste (ADR 0015): tudo derivado do relógio do teste. */
const relogio = criarRelogio();

function pendencia(p: Partial<PendenciaInativacao> = {}): PendenciaInativacao {
  return {
    id: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a01',
    sessao_id: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a02',
    entidade: 'cliente',
    conector_id: 'erp-matriz',
    lote_id: '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a03',
    estado: 'aguardando',
    candidatos: 420,
    total_ativos: 1000,
    percentual: 42,
    limite_pct: 30,
    amostra: ['C-1', 'C-2'],
    criada_em: relogio.relativo({ horas: -2 }).toISOString(),
    expira_em: relogio.relativo({ dias: 5 }).toISOString(),
    decidida_em: null,
    ...p,
  };
}

describe('rótulos do monitor (todo valor do contrato tem texto em português)', () => {
  it('cobre saúde, versão, status do lote, entidade e estado do pedido no ERP', () => {
    for (const s of SAUDES_CONECTOR) expect(ROTULO_SAUDE[s], s).toBeTruthy();
    for (const s of SITUACOES_VERSAO_CONECTOR) expect(ROTULO_SITUACAO_VERSAO[s], s).toBeTruthy();
    for (const s of ESTADOS_LOTE_BKO) expect(ROTULO_STATUS_LOTE[s], s).toBeTruthy();
    for (const e of ENTIDADES) expect(ROTULO_ENTIDADE[e], e).toBeTruthy();
    for (const e of ESTADOS_PEDIDO_ERP) expect(ROTULO_ESTADO_PEDIDO[e], e).toBeTruthy();
  });
});

describe('tempoDesde (sinal de vida relativo ao relógio injetado)', () => {
  it('nunca, agora há pouco, minutos, horas e dias', () => {
    const agora = relogio.agora();
    expect(tempoDesde(null, agora)).toBe('nunca');
    expect(tempoDesde(relogio.relativo({ segundos: -20 }).toISOString(), agora)).toBe('agora há pouco');
    expect(tempoDesde(relogio.relativo({ minutos: -1 }).toISOString(), agora)).toBe('há 1 min');
    expect(tempoDesde(relogio.relativo({ minutos: -16 }).toISOString(), agora)).toBe('há 16 min');
    expect(tempoDesde(relogio.relativo({ horas: -3 }).toISOString(), agora)).toBe('há 3 h');
    expect(tempoDesde(relogio.relativo({ dias: -1 }).toISOString(), agora)).toBe('há 1 dia');
    expect(tempoDesde(relogio.relativo({ dias: -4 }).toISOString(), agora)).toBe('há 4 dias');
  });

  it('instante no futuro (relógio do servidor adiantado) não vira tempo negativo', () => {
    expect(tempoDesde(relogio.relativo({ minutos: 2 }).toISOString(), relogio.agora())).toBe('agora há pouco');
  });
});

describe('perfil da sessão', () => {
  it('aceita só perfis conhecidos', () => {
    expect(perfilDaSessao('admin')).toBe('admin');
    expect(perfilDaSessao('analista')).toBe('analista');
    expect(perfilDaSessao('')).toBeNull();
    expect(perfilDaSessao('root')).toBeNull();
    expect(perfilDaSessao(undefined)).toBeNull();
  });
});

describe('P-3: permissões refletidas na UI (a proteção real é na API)', () => {
  it('P-3: monitor e inativação para admin e analista; Conector e chave só admin', () => {
    expect(podeExecutar('monitor.ver', 'admin')).toBe(true);
    expect(podeExecutar('monitor.ver', 'analista')).toBe(true);
    expect(podeExecutar('inativacao.decidir', 'analista')).toBe(true);
    expect(podeExecutar('conector.gerenciar', 'analista')).toBe(false);
    expect(podeExecutar('conector.gerenciar', 'admin')).toBe(true);
  });

  it('P-3 / RN-PRO-01: perfis de campo e o assistente nunca agem no Hub; sem perfil, nada', () => {
    for (const p of ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'] as const) {
      expect(podeExecutar('monitor.ver', p), p).toBe(false);
      expect(podeExecutar('inativacao.decidir', p), p).toBe(false);
    }
    expect(podeExecutar('monitor.ver', null)).toBe(false);
  });
});

describe('RN-INT-06: decisão da inativação em massa no BKO', () => {
  it('RN-INT-06 (P-3): admin e analista decidem a pendência aguardando e dentro da validade', () => {
    expect(decisaoDaPendencia(pendencia(), 'admin', relogio.agora())).toEqual({ pode: true });
    expect(decisaoDaPendencia(pendencia(), 'analista', relogio.agora())).toEqual({ pode: true });
  });

  it('RN-INT-06 (P-3): outro perfil vê o motivo do domain e não decide', () => {
    const d = decisaoDaPendencia(pendencia(), 'supervisor', relogio.agora());
    expect(d.pode).toBe(false);
    expect(d.pode === false && d.motivo).toMatch(/administrador ou analista/);
  });

  it('RN-INT-06: passou da validade (7 dias) = expirada, pede nova carga completa', () => {
    const vencida = pendencia({ expira_em: relogio.relativo({ minutos: -1 }).toISOString() });
    const d = decisaoDaPendencia(vencida, 'admin', relogio.agora());
    expect(d.pode).toBe(false);
    expect(d.pode === false && d.motivo).toMatch(/nova carga completa/);
  });

  it('RN-INT-06: a expiração vale no instante exato do relógio (avançar o relógio expira)', () => {
    const r = criarRelogio({ agora: relogio.agora() });
    const p = pendencia({ expira_em: r.relativo({ minutos: 10 }).toISOString() });
    expect(decisaoDaPendencia(p, 'admin', r.agora()).pode).toBe(true);
    r.avancar({ minutos: 10 });
    expect(decisaoDaPendencia(p, 'admin', r.agora()).pode).toBe(false);
  });

  it('RN-INT-06: pendência já decidida não volta a ser decidida', () => {
    const d = decisaoDaPendencia(pendencia({ estado: 'confirmada', decidida_em: relogio.iso() }), 'admin', relogio.agora());
    expect(d.pode).toBe(false);
    expect(d.pode === false && d.motivo).toMatch(/já foi confirmada/);
  });
});
