import { describe, expect, it } from 'vitest';
import { AuditoriaInativacao, ChaveNovaConector, ConectoresQuery, DecidirInativacaoResposta, PendenciaInativacao, RecusaTopologiaConector } from './bko';

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

describe('R-155028 (🟡 2 e 3): topologia no ErroApi e inativadas na auditoria', () => {
  it('RN-INT-13: o 409 de topologia leva conflitos e entidades_livres em detalhes (ErroApi, ADR 0008), não no topo', () => {
    const corpo = {
      codigo: 'topologia_conflitante',
      mensagem: 'O Conector "x" não foi salvo.',
      detalhes: { conflitos: [{ codigo: 'entidade_em_outro_conector', entidade: 'cliente', conector_id: 'erp-alfa', mensagem: 'A entidade "cliente" já é recebida.' }], entidades_livres: [] },
      requisicao_id: 'req-1',
    };
    expect(RecusaTopologiaConector.safeParse(corpo).success).toBe(true);
    const { detalhes: _d, ...semDetalhes } = corpo;
    expect(RecusaTopologiaConector.safeParse({ ...semDetalhes, conflitos: corpo.detalhes.conflitos, entidades_livres: [] }).success).toBe(false);
  });

  it('RN-INT-06: a auditoria registra quantas foram inativadas de fato (opcional; nulo na recusa)', () => {
    expect(AuditoriaInativacao.safeParse({ ...auditoria, inativadas: 3 }).success).toBe(true);
    expect(AuditoriaInativacao.safeParse({ ...auditoria, acao: 'recusar', inativadas: null }).success).toBe(true);
    expect(AuditoriaInativacao.safeParse({ ...auditoria, inativadas: -1 }).success).toBe(false);
  });
});

describe('RN-INT-10: filtro ?tipo= da listagem de conectores (credencial de API = tipo nuvem)', () => {
  it('RN-INT-10: tipo é opcional (sem ele, todos) e só aceita os tipos do contrato', () => {
    expect(ConectoresQuery.parse({})).toEqual({});
    expect(ConectoresQuery.parse({ tipo: 'nuvem' })).toEqual({ tipo: 'nuvem' });
    expect(ConectoresQuery.parse({ tipo: 'conector' })).toEqual({ tipo: 'conector' });
    expect(ConectoresQuery.safeParse({ tipo: 'api' }).success).toBe(false);
  });
});

describe('RN-INT-10: ChaveNovaConector devolvida na criação e na rotação', () => {
  const chave = {
    conector_id: 'conector-matriz_01',
    escopo: 'integracao.v1',
    chave: 'k'.repeat(40),
    prefixo: 'abcd1234',
    criada_em: '2026-11-22T12:00:00.000Z',
  };
  it('RN-INT-10: aceita um conector_id no formato do identificador do Conector', () => {
    expect(ChaveNovaConector.safeParse(chave).success).toBe(true);
  });
  it('RN-INT-10: rejeita conector_id inválido (espaço, barra, acento ou vazio)', () => {
    for (const conector_id of ['com espaço', 'a/b', 'ação', '', 'x'.repeat(101)]) {
      expect(ChaveNovaConector.safeParse({ ...chave, conector_id }).success).toBe(false);
    }
  });
});
