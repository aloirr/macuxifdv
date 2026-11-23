import { describe, expect, it } from 'vitest';
import { criarApiCamposObrigatorios, criarApiRecusados } from './api';

const ID = '3f1c2a52-3c1e-4f0a-9d49-7c4a5c0e1a11';
const VENDEDOR = '9a8b7c6d-1111-4222-8333-444455556666';

function chamadas(respostas: Record<string, unknown>) {
  const log: Array<{ caminho: string; opcoes?: { method?: string; body?: unknown; query?: Record<string, unknown> } }> = [];
  const chamar = (async (caminho: string, opcoes?: { method?: string; body?: unknown; query?: Record<string, unknown> }) => {
    log.push({ caminho, opcoes });
    return respostas[`${opcoes?.method ?? 'GET'} ${caminho}`];
  }) as never;
  return { log, chamar };
}

describe('RN-CORE-16 e RN-CORE-79: chamadas do BKO da lista única de campos obrigatórios', () => {
  it('RN-CORE-79: lê e grava a lista pelo contrato, em parametros/campos-obrigatorios', async () => {
    const { chamar, log } = chamadas({ 'GET /core/parametros/campos-obrigatorios': { obrigatorios: ['razao_social', 'documento', 'email'] }, 'PUT /core/parametros/campos-obrigatorios': {} });
    const api = criarApiCamposObrigatorios(chamar);
    expect(await api.ler()).toEqual({ obrigatorios: ['razao_social', 'documento', 'email'] });
    await api.gravar({ obrigatorios: ['razao_social', 'documento', 'telefone'] });
    expect(log[1]).toMatchObject({ caminho: '/core/parametros/campos-obrigatorios', opcoes: { method: 'PUT', body: { obrigatorios: ['razao_social', 'documento', 'telefone'] } } });
  });
  it('RN-CORE-16: recusa campo fora da lista e repetição antes de enviar', async () => {
    const api = criarApiCamposObrigatorios(chamadas({}).chamar);
    await expect(api.gravar({ obrigatorios: ['endereco'] } as never)).rejects.toBeDefined();
    await expect(api.gravar({ obrigatorios: ['email', 'email'] })).rejects.toBeDefined();
  });
});

describe('RN-CORE-78: chamadas do BKO dos pré-cadastros recusados (ADR 0069 §7)', () => {
  const item = { cliente_id: ID, revisao: 2, documento_mascarado: '11.***.***/0001-81', razao_social: 'Mercado', vendedor: { id: VENDEDOR, nome: 'Ana' }, recusado_em: '2026-11-23T14:00:00Z', motivo: 'CEP não existe', erros: [], situacao: 'recusado' };
  const atual = { id: ID, revisao: 2, status_cadastro: 'recusado', motivo: 'CEP não existe', erros: [], razao_social: 'Mercado', documento: '11222333000181' };

  it('RN-CORE-78: lista pela situação e pela busca, sem mandar filtro vazio', async () => {
    const { chamar, log } = chamadas({ 'GET /core/clientes/pre-cadastro/recusados': { itens: [item], proximo_cursor: null } });
    const api = criarApiRecusados(chamar);
    expect((await api.listar({ situacao: 'reenviado', busca: '' })).itens).toHaveLength(1);
    expect(log[0]!.opcoes?.query).toEqual({ situacao: 'reenviado', busca: undefined, cursor: undefined, limite: undefined });
  });
  it('RN-CORE-78: lê o histórico e a revisão atual pelo id do cliente', async () => {
    const historico = { cliente_id: ID, revisao_atual: 2, tentativas: [] };
    const { chamar } = chamadas({ [`GET /core/clientes/${ID}/pre-cadastro/historico`]: historico, [`GET /core/clientes/${ID}/pre-cadastro`]: atual });
    const api = criarApiRecusados(chamar);
    expect(await api.historico(ID)).toEqual(historico);
    expect((await api.atual(ID)).revisao).toBe(2);
  });
  it('RN-CORE-78: reenvia no mesmo id com PUT e a revisao_base, só com dígitos no documento', async () => {
    const { chamar, log } = chamadas({ [`PUT /core/clientes/${ID}/pre-cadastro`]: { id: ID, status_cadastro: 'pendente', revisao: 3, ja_existia: false } });
    const api = criarApiRecusados(chamar);
    const r = await api.reenviar(ID, { razao_social: 'Mercado', documento: '11.222.333/0001-81', revisao_base: 2 });
    expect(r.revisao).toBe(3);
    expect(log[0]!.opcoes).toMatchObject({ method: 'PUT', body: { documento: '11222333000181', revisao_base: 2 } });
    await expect(api.reenviar(ID, { razao_social: 'Mercado', documento: '1122', revisao_base: 2 })).rejects.toBeDefined();
  });
});
