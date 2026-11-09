/**
 * Base de demo — monitor da Integração ERP (db/seeds/demo/integracao.ts; T-0051, pedido R-20261102-125759-2-modulo-integracao).
 * Função pura (sem banco): licença só para admin e analista, 2 Conectores (um só recebe pedidos, guarda P-7), política 1.2.1,
 * 5 lotes com os 3 desfechos, erros de linha sem payload nem dado pessoal e a inativação aguardando com 7 dias. Os instantes
 * saem do `agora` passado (o now() do banco no seed). A carga no banco é conferida em seed-demo.test.ts (CI).
 */
import { describe, expect, it } from 'vitest';
import { TENANT_DEMO } from '../seeds/demo/demo';
import { dadosIntegracaoDemo, INTEGRACAO_DEMO, PERFIS_INTEGRACAO_DEMO, TENANT_DEMO_INTEGRACAO, VERSAO_CONECTOR_DEMO } from '../seeds/demo/integracao';

const AGORA = new Date('2026-11-09T04:00:00.000Z'); // hora-fixa-ok: só o "agora" da função pura; os instantes são relativos a ele
const d = dadosIntegracaoDemo(AGORA);
const minutosAntes = (iso: unknown) => (AGORA.getTime() - new Date(String(iso)).getTime()) / 60_000;

describe('base de demo — monitor da Integração ERP (estático)', () => {
  it('tenant demo e licença de integracao só para admin e analista (nenhum perfil de campo)', () => {
    expect(TENANT_DEMO_INTEGRACAO).toBe(TENANT_DEMO);
    for (const linhas of Object.values(d)) for (const l of linhas) expect(l.tenant_id).toBe(TENANT_DEMO);
    expect(d['plataforma.tenant_modulo']).toEqual([expect.objectContaining({ modulo: 'integracao', ativo: true })]);
    expect(d['plataforma.perfil_modulo'].map((p) => p.perfil).sort()).toEqual([...PERFIS_INTEGRACAO_DEMO].sort());
    expect(PERFIS_INTEGRACAO_DEMO).toEqual(['admin', 'analista']);
  });

  it('2 Conectores: matriz recebe pedidos com sinal recente; filial sem pedidos e sem sinal há mais de 15 min; versão 1.2.1', () => {
    const [filial, matriz] = d['integracao.conector'];
    expect(matriz).toMatchObject({ identificador: 'erp-matriz', ativo: true, recebe_pedidos: true, versao_conector: VERSAO_CONECTOR_DEMO });
    expect(filial).toMatchObject({ identificador: 'erp-filial', ativo: true, recebe_pedidos: false });
    expect(minutosAntes(matriz!.ultimo_sinal_em)).toBeLessThan(15);
    expect(minutosAntes(filial!.ultimo_sinal_em)).toBeGreaterThan(15);
    // P-7: no máximo um ativo que recebe pedidos
    expect(d['integracao.conector'].filter((c) => c.ativo && c.recebe_pedidos)).toHaveLength(1);
    expect(d['integracao.politica_versao']).toEqual([expect.objectContaining({ versao_minima: '1.2.1', versao_recomendada: '1.2.1' })]);
  });

  it('5 lotes (concluído, concluído com erros e falhou); o completo é o da sessão de cliente; chave e hash nos formatos do CHECK', () => {
    const lotes = d['integracao.lote'];
    expect(lotes.map((l) => l.status).sort()).toEqual(['concluido', 'concluido', 'concluido', 'concluido_com_erros', 'falhou']);
    for (const l of lotes) {
      expect(String(l.chave_idempotencia)).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
      expect(String(l.hash_conteudo)).toMatch(/^[0-9a-f]{64}$/);
      expect((l.modo === 'completo') === (l.sessao_id !== null)).toBe(true);
      expect(minutosAntes(l.recebido_em)).toBeGreaterThan(0);
    }
    expect(lotes.filter((l) => l.modo === 'completo').map((l) => l.id)).toEqual([INTEGRACAO_DEMO.lotes.cliente]);
    expect(lotes.find((l) => l.status === 'falhou')).toMatchObject({ entidade: 'estoque', concluido_em: null });
    expect(new Set(lotes.map((l) => l.chave_idempotencia)).size).toBe(5);
  });

  it('erros de linha só com external_id, código e mensagem (sem payload, sem dado pessoal), no lote com erros', () => {
    const erros = d['integracao.lote_linha_erro'];
    const comErros = d['integracao.lote'].find((l) => l.status === 'concluido_com_erros')!;
    expect(erros).toHaveLength(Number(comErros.com_erro));
    for (const e of erros) {
      expect(e).toMatchObject({ lote_id: comErros.id, payload: null, origem: 'hub' });
      expect(String(e.external_id)).not.toMatch(/\d{11,14}/); // nada de CPF/CNPJ na chave
    }
  });

  it('inativação aguardando na carga completa de cliente, validade de 7 dias a partir do agora, acima do limite', () => {
    const [p] = d['integracao.pendencia_inativacao'];
    expect(p).toMatchObject({ estado: 'aguardando', entidade: 'cliente', sessao_id: INTEGRACAO_DEMO.sessaoCliente, lote_id: INTEGRACAO_DEMO.lotes.cliente, decidida_em: null });
    expect(new Date(String(p!.expira_em)).getTime() - AGORA.getTime()).toBe(7 * 86_400_000);
    expect(Number(p!.percentual)).toBeGreaterThan(Number(p!.limite_pct));
    expect(Number(p!.candidatos) / Number(p!.total_ativos) * 100).toBeCloseTo(Number(p!.percentual), 2);
  });
});
