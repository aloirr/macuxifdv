import { describe, expect, it } from 'vitest';
import { cacheValido, chaveCache, consomeCotaIa, consultasRestantes, deveGuardarNoCache, diaDoTenant, registrarConsultaIa, registrarDesfechoIa, verificarConsultaIa } from './limite-ia';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';

const P = PARAMETROS_PADRAO;

describe('RN-CAT-03: limite de consultas de IA por usuário/dia', () => {
  it('RN-CAT-03: o dia do limite é o dia civil no fuso do tenant (America/Manaus, UTC-4)', () => {
    expect(diaDoTenant('2026-10-31T03:59:59Z', 'America/Manaus')).toBe('2026-10-30');
    expect(diaDoTenant('2026-10-31T04:00:00Z', 'America/Manaus')).toBe('2026-10-31');
    expect(diaDoTenant('2026-10-31T04:00:00Z', 'UTC')).toBe('2026-10-31');
  });

  it('RN-CAT-03: a primeira consulta do dia é permitida e conta 1', () => {
    const r = registrarConsultaIa(null, '2026-10-31T15:00:00Z', P);
    expect(r).toMatchObject({ permitido: true, restantes: 199, motivo: null, mensagem: null });
    expect(r.uso).toEqual({ dia: '2026-10-31', consultas: 1 });
  });

  it('RN-CAT-03: a 200ª consulta passa e a 201ª é barrada, com mensagem em português e ação seguinte', () => {
    const ate199 = { dia: '2026-10-31', consultas: 199 };
    const a = registrarConsultaIa(ate199, '2026-10-31T15:00:00Z', P);
    expect(a).toMatchObject({ permitido: true, restantes: 0 });
    const b = registrarConsultaIa(a.uso, '2026-10-31T15:01:00Z', P);
    expect(b).toMatchObject({ permitido: false, restantes: 0, motivo: 'limite_atingido' });
    expect(b.mensagem).toMatch(/limite/i);
    expect(b.mensagem).toMatch(/busca simples/i);
    expect(b.uso).toEqual(a.uso);
  });

  it('RN-CAT-03: o contador zera na virada do dia no fuso do tenant, não em UTC', () => {
    const cheio = { dia: '2026-10-30', consultas: 200 };
    // 2026-10-31T02:00Z ainda é 30/10 em Manaus: continua barrado
    expect(registrarConsultaIa(cheio, '2026-10-31T02:00:00Z', P).permitido).toBe(false);
    // 2026-10-31T04:00Z já é 31/10 em Manaus: zera
    const novo = registrarConsultaIa(cheio, '2026-10-31T04:00:00Z', P);
    expect(novo).toMatchObject({ permitido: true, restantes: 199 });
    expect(novo.uso.dia).toBe('2026-10-31');
  });

  it('RN-CAT-03: o limite é parâmetro do tenant; zero desliga a busca inteligente', () => {
    const p = resolverParametros({ limite_consultas_ia_dia: 2 });
    let uso = null as ReturnType<typeof registrarConsultaIa>['uso'] | null;
    const agora = '2026-10-31T15:00:00Z';
    uso = registrarConsultaIa(uso, agora, p).uso;
    uso = registrarConsultaIa(uso, agora, p).uso;
    expect(registrarConsultaIa(uso, agora, p).permitido).toBe(false);
    const off = registrarConsultaIa(null, agora, resolverParametros({ limite_consultas_ia_dia: 0 }));
    expect(off).toMatchObject({ permitido: false, motivo: 'ia_desligada' });
    expect(off.mensagem).toMatch(/não está habilitada/);
  });

  it('RN-CAT-03: consultasRestantes não consome e trata uso de outro dia como zerado', () => {
    expect(consultasRestantes({ dia: '2026-10-31', consultas: 150 }, '2026-10-31T15:00:00Z', P)).toBe(50);
    expect(consultasRestantes({ dia: '2026-10-30', consultas: 150 }, '2026-10-31T15:00:00Z', P)).toBe(200);
    expect(consultasRestantes(null, '2026-10-31T15:00:00Z', P)).toBe(200);
    expect(consultasRestantes({ dia: '2026-10-31', consultas: 999 }, '2026-10-31T15:00:00Z', P)).toBe(0);
  });
});

describe('RN-CAT-03: só consulta respondida pelo provedor consome a cota', () => {
  const AGORA = '2026-10-31T15:00:00Z';
  const uso = { dia: '2026-10-31', consultas: 10 };

  it('RN-CAT-03: verificarConsultaIa só confere (antes de chamar o provedor) e nunca consome', () => {
    expect(verificarConsultaIa(uso, AGORA, P)).toMatchObject({ permitido: true, uso, restantes: 190, motivo: null });
    expect(verificarConsultaIa({ dia: '2026-10-31', consultas: 200 }, AGORA, P)).toMatchObject({ permitido: false, motivo: 'limite_atingido', restantes: 0 });
    expect(verificarConsultaIa(null, AGORA, resolverParametros({ limite_consultas_ia_dia: 0 }))).toMatchObject({ permitido: false, motivo: 'ia_desligada' });
    expect(verificarConsultaIa({ dia: '2026-10-30', consultas: 200 }, AGORA, P)).toMatchObject({ permitido: true, uso: { dia: '2026-10-31', consultas: 0 }, restantes: 200 });
  });

  it('RN-CAT-03: falha do provedor (erro) não consome a cota', () => {
    const r = registrarDesfechoIa(uso, AGORA, P, 'erro');
    expect(r).toMatchObject({ uso, restantes: 190, consumiu: false });
  });

  it('RN-CAT-03: tempo esgotado no provedor não consome a cota', () => {
    const r = registrarDesfechoIa(uso, AGORA, P, 'tempo_esgotado');
    expect(r).toMatchObject({ uso, restantes: 190, consumiu: false });
  });

  it('RN-CAT-03: consulta respondida pelo provedor consome uma da cota', () => {
    const r = registrarDesfechoIa(uso, AGORA, P, 'respondida');
    expect(r).toMatchObject({ uso: { dia: '2026-10-31', consultas: 11 }, restantes: 189, consumiu: true });
  });

  it('RN-CAT-03: provedor não chamado (cache, offline, limite, busca simples) não consome', () => {
    expect(registrarDesfechoIa(uso, AGORA, P, 'nao_chamada')).toMatchObject({ uso, consumiu: false });
    expect(consomeCotaIa('nao_chamada')).toBe(false);
    expect(consomeCotaIa('erro')).toBe(false);
    expect(consomeCotaIa('tempo_esgotado')).toBe(false);
    expect(consomeCotaIa('respondida')).toBe(true);
  });

  it('RN-CAT-03: dez falhas seguidas no fim da cota não tiram a última consulta do usuário', () => {
    let u = { dia: '2026-10-31', consultas: 199 };
    for (let i = 0; i < 10; i++) u = registrarDesfechoIa(u, AGORA, P, i % 2 ? 'erro' : 'tempo_esgotado').uso;
    expect(verificarConsultaIa(u, AGORA, P)).toMatchObject({ permitido: true, restantes: 1 });
    u = registrarDesfechoIa(u, AGORA, P, 'respondida').uso;
    expect(verificarConsultaIa(u, AGORA, P)).toMatchObject({ permitido: false, motivo: 'limite_atingido' });
  });

  it('RN-CAT-03: resposta que chegou no limite (corrida entre duas consultas) é gravada sem passar do limite', () => {
    const r = registrarDesfechoIa({ dia: '2026-10-31', consultas: 200 }, AGORA, P, 'respondida');
    expect(r).toMatchObject({ uso: { dia: '2026-10-31', consultas: 200 }, restantes: 0, consumiu: false });
  });
});

describe('RF-CAT-01: cache de consultas frequentes', () => {
  const base = { tenant_id: 't1', tipo: 'interpretacao' as const };

  it('RN-CAT-01: a chave inclui o tenant — o mesmo texto em tenants diferentes nunca compartilha cache', () => {
    expect(chaveCache({ ...base, consulta: 'detergente' })).not.toBe(chaveCache({ ...base, tenant_id: 't2', consulta: 'detergente' }));
    expect(chaveCache({ ...base, consulta: 'detergente' })).toContain('t1');
  });

  it('RF-CAT-01: a chave é normalizada — caixa, acento, espaços, medida e plural não criam entradas novas', () => {
    const k = chaveCache({ ...base, consulta: 'Detergente Neutro 5 litros' });
    expect(chaveCache({ ...base, consulta: '  detergente   NEUTRO 5L ' })).toBe(k);
    expect(chaveCache({ ...base, consulta: 'detergentes neutros 5000 ml' })).toBe(k);
  });

  it('RF-CAT-01: a chave preserva o sentido — "com estoque" e "sem estoque" são entradas diferentes', () => {
    expect(chaveCache({ ...base, consulta: 'café com estoque' })).not.toBe(chaveCache({ ...base, consulta: 'café sem estoque' }));
    expect(chaveCache({ ...base, consulta: 'até R$ 10' })).not.toBe(chaveCache({ ...base, consulta: 'a partir de R$ 10' }));
  });

  it('RF-CAT-01: o tipo e o escopo (tabela, filiais em qualquer ordem) entram na chave', () => {
    expect(chaveCache({ ...base, consulta: 'x' })).not.toBe(chaveCache({ ...base, tipo: 'pergunta', consulta: 'x' }));
    const e1 = chaveCache({ ...base, consulta: 'x', escopo: { tabela_id: 'ta', filiais: ['f2', 'f1'] } });
    const e2 = chaveCache({ ...base, consulta: 'x', escopo: { tabela_id: 'ta', filiais: ['f1', 'f2'] } });
    expect(e1).toBe(e2);
    expect(e1).not.toBe(chaveCache({ ...base, consulta: 'x', escopo: { tabela_id: 'tb', filiais: ['f1', 'f2'] } }));
  });

  it('RN-CAT-01: separadores dentro do tenant ou da consulta não forjam a chave de outro tenant', () => {
    expect(chaveCache({ ...base, tenant_id: 't1:interpretacao', consulta: 'x' })).not.toBe(chaveCache({ ...base, tenant_id: 't1', consulta: 'x' }));
  });

  it('RN-CAT-01: tenant vazio é erro (nunca gerar chave global)', () => {
    expect(() => chaveCache({ ...base, tenant_id: '  ', consulta: 'x' })).toThrow(RangeError);
  });

  it('RF-CAT-01: entrada vale enquanto não passar do tempo de vida (10 min por padrão) e só para o mesmo tenant', () => {
    const e = { tenant_id: 't1', gravado_em: '2026-10-31T15:00:00Z' };
    expect(cacheValido(e, 't1', '2026-10-31T15:09:59Z', P)).toBe(true);
    expect(cacheValido(e, 't1', '2026-10-31T15:10:00Z', P)).toBe(false);
    expect(cacheValido(e, 't2', '2026-10-31T15:01:00Z', P)).toBe(false);
  });

  it('RF-CAT-01: tempo de vida zero desliga o cache', () => {
    const e = { tenant_id: 't1', gravado_em: '2026-10-31T15:00:00Z' };
    const p = resolverParametros({ cache_ttl_s: 0 });
    expect(cacheValido(e, 't1', '2026-10-31T15:00:00Z', p)).toBe(false);
    expect(deveGuardarNoCache(50, p)).toBe(false);
  });

  it('RF-CAT-01: só guarda no cache a consulta que já se repetiu (frequente)', () => {
    expect(deveGuardarNoCache(1, P)).toBe(false);
    expect(deveGuardarNoCache(2, P)).toBe(true);
  });
});
