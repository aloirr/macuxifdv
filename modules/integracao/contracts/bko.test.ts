import { describe, expect, it } from 'vitest';
import { AuditoriaInativacao, DecidirInativacaoResposta, PendenciaInativacao } from './bko';

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const pendencia = {
  id: U(1), sessao_id: U(2), entidade: 'cliente', conector_id: 'matriz-01', lote_id: U(3), estado: 'aguardando', candidatos: 5,
  total_ativos: 10, percentual: 50, limite_pct: 30, amostra: ['A5'], criada_em: '2026-11-01T10:00:00.000Z',
  expira_em: '2026-11-08T10:00:00.000Z', decidida_em: null,
};
const auditoria = {
  pendencia_id: U(1), sessao_id: U(2), lote_id: U(3), entidade: 'cliente', conector_id: 'matriz-01', acao: 'confirmar',
  decidida_por: U(9), perfil: 'analista', decidida_em: '2026-11-02T10:00:00.000Z', quantidade: 5, total_ativos: 10, percentual: 50, motivo: null,
};

describe('P-3: contratos da decisão da inativação em massa', () => {
  it('P-3: a pendência sem os campos de autor continua válida (campos novos opcionais, RN-INT-09)', () => {
    expect(PendenciaInativacao.safeParse(pendencia).success).toBe(true);
    expect(PendenciaInativacao.safeParse({ ...pendencia, estado: 'confirmada', decidida_em: auditoria.decidida_em, decidida_por: U(9), decidida_por_perfil: 'admin' }).success).toBe(true);
  });

  it('P-3: a auditoria leva quem, quando, lote e quantidade; só admin ou analista aparecem como autor', () => {
    expect(AuditoriaInativacao.safeParse(auditoria).success).toBe(true);
    expect(AuditoriaInativacao.safeParse({ ...auditoria, perfil: 'supervisor' }).success).toBe(false);
    for (const campo of ['decidida_por', 'decidida_em', 'lote_id', 'quantidade'] as const) {
      const { [campo]: _fora, ...sem } = auditoria;
      expect(AuditoriaInativacao.safeParse(sem).success).toBe(false);
    }
  });

  it('P-3: a resposta da decisão aceita a auditoria (opcional)', () => {
    expect(DecidirInativacaoResposta.safeParse({ pendencia, inativadas: 0 }).success).toBe(true);
    expect(DecidirInativacaoResposta.safeParse({ pendencia, inativadas: 5, auditoria }).success).toBe(true);
  });
});
