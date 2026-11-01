import { describe, expect, it } from 'vitest';
import { avaliarChaveConector, revogarChaves, rotacionarChaves, type ChaveArmazenada, type ChavesDoConector } from './credencial';
import { PARAMETROS_PADRAO } from './parametros';

const t0 = '2026-11-01T10:00:00.000Z';
const mais = (iso: string, min: number) => new Date(Date.parse(iso) + min * 60_000).toISOString();

const atual: ChaveArmazenada = {
  conector_id: 'matriz-01',
  conector_ativo: true,
  escopo: 'integracao.v1',
  papel: 'atual',
  criada_em: '2026-10-01T00:00:00.000Z',
  expira_em: null,
  anterior_valida_ate: null,
  revogada_em: null,
};
const aval = (chave: ChaveArmazenada | null, extra: Partial<Parameters<typeof avaliarChaveConector>[0]> = {}) =>
  avaliarChaveConector({ chave, conector_id_cabecalho: 'matriz-01', agora: t0, ...extra });

describe('RN-INT-10 (proposta): validação da chave de API do Conector', () => {
  it('RN-INT-10: chave ativa do Conector certo passa', () => {
    expect(aval(atual)).toMatchObject({ ok: true, situacao: 'ativa', valida_ate: null });
  });

  it('RN-INT-10: chave desconhecida, sem identificador ou com identificador de outro Conector = 401 genérico (não revela qual)', () => {
    for (const r of [aval(null), aval(atual, { conector_id_cabecalho: null }), aval(atual, { conector_id_cabecalho: 'outro' })]) {
      expect(r).toMatchObject({ ok: false, status: 401, codigo: 'credencial_invalida' });
      if (!r.ok) expect(r.mensagem).not.toMatch(/outro|matriz-01/);
    }
    expect((aval(atual, { conector_id_cabecalho: 'outro' }) as { motivo: string }).motivo).toBe('conector_divergente');
  });

  it('RN-INT-10: chave revogada ou expirada = 401, com o motivo interno para o log/monitor', () => {
    expect(aval({ ...atual, revogada_em: '2026-10-31T00:00:00Z' })).toMatchObject({ ok: false, status: 401, motivo: 'revogada' });
    expect(aval({ ...atual, expira_em: '2026-10-31T00:00:00Z' })).toMatchObject({ ok: false, status: 401, motivo: 'expirada' });
    expect(aval({ ...atual, expira_em: '2026-12-31T00:00:00Z' })).toMatchObject({ ok: true });
  });

  it('RN-INT-10: chave anterior vale DENTRO da convivência (com aviso) e deixa de valer no instante limite', () => {
    const anterior: ChaveArmazenada = { ...atual, papel: 'anterior', anterior_valida_ate: mais(t0, 30) };
    expect(aval(anterior)).toMatchObject({ ok: true, situacao: 'em_convivencia', valida_ate: mais(t0, 30), aviso: 'chave_anterior_em_uso' });
    expect(aval(anterior, { agora: mais(t0, 30) })).toMatchObject({ ok: false, status: 401, motivo: 'fora_da_convivencia' });
    expect(aval({ ...anterior, anterior_valida_ate: null })).toMatchObject({ ok: false, motivo: 'fora_da_convivencia' });
  });

  it('RN-INT-10: chave anterior revogada antes do fim da convivência não vale', () => {
    const anterior: ChaveArmazenada = { ...atual, papel: 'anterior', anterior_valida_ate: mais(t0, 30), revogada_em: t0 };
    expect(aval(anterior)).toMatchObject({ ok: false, motivo: 'revogada' });
  });

  it('RN-INT-10: escopo diferente de integracao.v1 = 403 (a chave não abre outra rota); Conector desativado = 403', () => {
    expect(aval({ ...atual, escopo: 'core.admin' })).toMatchObject({ ok: false, status: 403, codigo: 'acesso_negado', motivo: 'escopo_invalido' });
    expect(aval({ ...atual, conector_ativo: false })).toMatchObject({ ok: false, status: 403, motivo: 'conector_inativo' });
  });

  it('RN-INT-10: IP fora da lista = 403; módulo sem licença = 403 modulo_inativo (RN-CORE-02)', () => {
    expect(aval(atual, { ipPermitido: false })).toMatchObject({ ok: false, status: 403, codigo: 'acesso_negado', motivo: 'ip_nao_permitido' });
    expect(aval(atual, { moduloAtivo: false })).toMatchObject({ ok: false, status: 403, codigo: 'modulo_inativo', motivo: 'modulo_inativo' });
  });

  it('RN-INT-10: a mensagem de recusa nunca carrega a chave nem o hash', () => {
    const r = aval({ ...atual, revogada_em: t0 });
    expect(JSON.stringify(r)).not.toMatch(/Bearer|hash/i);
  });
});

describe('RN-INT-10 (proposta): rotação e revogação', () => {
  const ref = (id: string, extra = {}) => ({ id, prefixo: id.slice(0, 6), criada_em: '2026-10-01T00:00:00.000Z', expira_em: null, revogada_em: null, anterior_valida_ate: null, ...extra });
  const base: ChavesDoConector = { atual: ref('k1abcdef'), anterior: null };

  it('RN-INT-10: rotacionar promove a nova, mantém a antiga como anterior até agora + convivência (padrão 24 h)', () => {
    const r = rotacionarChaves(base, { id: 'k2abcdef', prefixo: 'k2abcd' }, t0);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.chaves.atual?.id).toBe('k2abcdef');
      expect(r.chaves.anterior).toMatchObject({ id: 'k1abcdef', anterior_valida_ate: mais(t0, 24 * 60), revogada_em: null });
      expect(r.anterior_valida_ate).toBe(mais(t0, 24 * 60));
    }
  });

  it('RN-INT-10: convivência 0 revoga a anterior na hora; acima de 7 dias é recusada', () => {
    const zero = rotacionarChaves(base, { id: 'k2abcdef', prefixo: 'k2abcd' }, t0, { convivenciaMin: 0 });
    expect(zero.ok && zero.chaves.anterior).toMatchObject({ id: 'k1abcdef', revogada_em: t0 });
    const longa = rotacionarChaves(base, { id: 'k2abcdef', prefixo: 'k2abcd' }, t0, { convivenciaMin: 10_081 });
    expect(longa).toMatchObject({ ok: false, codigo: 'convivencia_invalida' });
  });

  it('RN-INT-10: no máximo duas chaves válidas — rotacionar de novo na convivência revoga a anterior mais velha', () => {
    const r1 = rotacionarChaves(base, { id: 'k2abcdef', prefixo: 'k2abcd' }, t0);
    if (!r1.ok) throw new Error('esperado ok');
    const r2 = rotacionarChaves(r1.chaves, { id: 'k3abcdef', prefixo: 'k3abcd' }, mais(t0, 5));
    expect(r2.ok && r2.chaves.anterior?.id).toBe('k2abcdef');
    expect(r2.ok && r2.revogadas).toEqual(['k1abcdef']);
  });

  it('RN-INT-10: primeira chave (sem atual) não cria anterior', () => {
    const r = rotacionarChaves({ atual: null, anterior: null }, { id: 'k1abcdef', prefixo: 'k1abcd' }, t0);
    expect(r.ok && r.chaves).toMatchObject({ anterior: null });
    expect(r.ok && r.anterior_valida_ate).toBeNull();
  });

  it('RN-INT-10: revogar atual, anterior ou todas marca revogada_em e não toca na outra', () => {
    const rot = rotacionarChaves(base, { id: 'k2abcdef', prefixo: 'k2abcd' }, t0);
    if (!rot.ok) throw new Error('esperado ok');
    const soAtual = revogarChaves(rot.chaves, 'atual', mais(t0, 1));
    expect(soAtual.atual?.revogada_em).toBe(mais(t0, 1));
    expect(soAtual.anterior?.revogada_em).toBeNull();
    const soAnterior = revogarChaves(rot.chaves, 'anterior', mais(t0, 1));
    expect(soAnterior.atual?.revogada_em).toBeNull();
    expect(soAnterior.anterior?.revogada_em).toBe(mais(t0, 1));
    const todas = revogarChaves(rot.chaves, 'todas', mais(t0, 1));
    expect([todas.atual?.revogada_em, todas.anterior?.revogada_em]).toEqual([mais(t0, 1), mais(t0, 1)]);
  });

  it('RN-INT-10: revogar chave já revogada preserva o instante original (idempotente)', () => {
    const uma = revogarChaves(base, 'atual', t0);
    const duas = revogarChaves(uma, 'atual', mais(t0, 60));
    expect(duas.atual?.revogada_em).toBe(t0);
  });
});

describe('RN-INT-10 (P-5, T-0027): a chave antiga convive 24 h na rotação, como parâmetro do tenant', () => {
  const ref = (id: string) => ({ id, prefixo: id.slice(0, 6), criada_em: '2026-10-01T00:00:00.000Z', expira_em: null, revogada_em: null, anterior_valida_ate: null });
  const base: ChavesDoConector = { atual: ref('k1abcdef'), anterior: null };
  const anteriorDe = (validaAte: string): ChaveArmazenada => ({
    conector_id: 'matriz-01', conector_ativo: true, escopo: 'integracao.v1', papel: 'anterior', criada_em: t0, expira_em: null, anterior_valida_ate: validaAte, revogada_em: null,
  });

  it('RN-INT-10 (P-5): o padrão é 24 h (1440 min) e a anterior autentica até 1 ms antes do fim da janela', () => {
    expect(PARAMETROS_PADRAO.convivenciaChaveMin).toBe(24 * 60);
    const r = rotacionarChaves(base, { id: 'k2abcdef', prefixo: 'k2abcd' }, t0);
    const fim = r.ok ? (r.anterior_valida_ate as string) : '';
    expect(fim).toBe(mais(t0, 1440));
    const quase = new Date(Date.parse(fim) - 1).toISOString();
    expect(avaliarChaveConector({ chave: anteriorDe(fim), conector_id_cabecalho: 'matriz-01', agora: quase })).toMatchObject({ ok: true, situacao: 'em_convivencia' });
    expect(avaliarChaveConector({ chave: anteriorDe(fim), conector_id_cabecalho: 'matriz-01', agora: fim })).toMatchObject({ ok: false, motivo: 'fora_da_convivencia' });
  });

  it('RN-INT-10 (P-5): o tenant pode mudar a convivência (ex.: 48 h) dentro do teto de 7 dias', () => {
    const r = rotacionarChaves(base, { id: 'k2abcdef', prefixo: 'k2abcd' }, t0, { convivenciaMin: 48 * 60 });
    expect(r).toMatchObject({ ok: true, anterior_valida_ate: mais(t0, 48 * 60) });
    expect(rotacionarChaves(base, { id: 'k2abcdef', prefixo: 'k2abcd' }, t0, { convivenciaMin: 7 * 24 * 60 + 1 }).ok).toBe(false);
  });
});
