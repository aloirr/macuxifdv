import { describe, expect, it } from 'vitest';
import { conteudoCanonicoLote, decidirIdempotenciaLote, validarChaveIdempotencia } from './lote-idempotencia';

const SHA = 'a'.repeat(64);
const lote = {
  versao_contrato: 'v1',
  entidade: 'cliente',
  modo: 'delta',
  registros: [{ external_id: 'C1', alterado_em: '2026-11-01T10:00:00Z', razao_social: 'A' }],
  enviado_em: '2026-11-01T10:00:01Z',
  conector_id: 'matriz-01',
  versao_conector: '1.1.0',
  cursor: { alterado_em: '2026-11-01T10:00:00Z', external_id: 'C1' },
};

describe('RN-INT-12 (proposta): chave de idempotência do lote', () => {
  it('RN-INT-12: aceita SHA-256 hex e recusa chave vazia, curta ou com caracteres fora do conjunto seguro', () => {
    expect(validarChaveIdempotencia(SHA)).toEqual({ ok: true, chave: SHA });
    for (const ruim of [undefined, '', 'curta', `${SHA}\r\nX: 1`, 'a'.repeat(129)]) {
      const r = validarChaveIdempotencia(ruim);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.codigo).toBe('chave_idempotencia_invalida');
    }
  });

  it('RN-INT-12: o conteúdo canônico ignora enviado_em, versao_conector, conector_id e cursor declarado (reenvio da fila não vira conflito)', () => {
    const outro = { ...lote, enviado_em: '2026-11-02T00:00:00Z', versao_conector: '1.2.0', conector_id: 'outro', cursor: undefined };
    expect(conteudoCanonicoLote(outro)).toBe(conteudoCanonicoLote(lote));
  });

  it('RN-INT-12: não depende da ordem das chaves nem de null x ausente (igual ao hash do registro, RN-INT-02)', () => {
    const embaralhado = {
      registros: [{ razao_social: 'A', alterado_em: '2026-11-01T10:00:00Z', external_id: 'C1', telefone: null }],
      modo: 'delta',
      entidade: 'cliente',
      versao_contrato: 'v1',
    };
    expect(conteudoCanonicoLote(embaralhado)).toBe(conteudoCanonicoLote(lote));
  });

  it('RN-INT-12: muda quando muda um registro, a sessão/parte, as linhas inválidas ou o modo', () => {
    const base = conteudoCanonicoLote(lote);
    expect(conteudoCanonicoLote({ ...lote, registros: [{ ...lote.registros[0], razao_social: 'B' }] })).not.toBe(base);
    expect(conteudoCanonicoLote({ ...lote, modo: 'completo', sessao: { id: 's', parte: 1, ultimo: true } })).not.toBe(base);
    expect(conteudoCanonicoLote({ ...lote, linhas_invalidas: [{ codigo: 'campo_obrigatorio', mensagem: 'x' }] })).not.toBe(base);
    expect(conteudoCanonicoLote({ ...lote, linhas_invalidas_omitidas: 2 })).not.toBe(base);
  });
});

describe('RN-INT-12 (proposta): decisão de idempotência do lote', () => {
  const existente = { lote_id: 'L1', hash_conteudo: 'h1', status: 'concluido' as const };

  it('RN-INT-12: chave nova → processar', () => {
    expect(decidirIdempotenciaLote({ chave: SHA, hashConteudo: 'h1', existente: null })).toEqual({ acao: 'processar' });
  });

  it('RN-INT-12: mesma chave e mesmo conteúdo → repetir a resposta com o mesmo lote_id, sem reprocessar (qualquer status)', () => {
    for (const status of ['recebido', 'processando', 'concluido', 'concluido_com_erros', 'falhou'] as const) {
      expect(decidirIdempotenciaLote({ chave: SHA, hashConteudo: 'h1', existente: { ...existente, status } })).toEqual({ acao: 'repetir', lote_id: 'L1', status });
    }
  });

  it('RN-INT-12: mesma chave com conteúdo diferente → 409 chave_idempotencia_reutilizada, com mensagem em português e a ação seguinte', () => {
    const r = decidirIdempotenciaLote({ chave: SHA, hashConteudo: 'h2', existente });
    expect(r).toMatchObject({ acao: 'conflito', lote_id: 'L1', status_http: 409, codigo: 'chave_idempotencia_reutilizada' });
    if (r.acao === 'conflito') {
      expect(r.mensagem).toMatch(/Idempotency-Key/);
      expect(r.mensagem).not.toContain(SHA);
    }
  });
});
