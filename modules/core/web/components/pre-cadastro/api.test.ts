import { describe, expect, it } from 'vitest';
import { criarApiPreCadastro } from './api';

function chamadas(respostas: Record<string, unknown>) {
  const log: Array<{ caminho: string; opcoes?: { method?: string; body?: unknown } }> = [];
  const chamar = (async (caminho: string, opcoes?: { method?: string; body?: unknown }) => {
    log.push({ caminho, opcoes });
    return respostas[`${opcoes?.method ?? 'GET'} ${caminho}`];
  }) as never;
  return { log, api: criarApiPreCadastro(chamar) };
}

describe('RN-CORE-79: chamadas do BKO do pré-cadastro', () => {
  it('RN-CORE-79: lê e grava os obrigatórios pelo contrato', async () => {
    const { api, log } = chamadas({ 'GET /core/parametros/pre-cadastro': { obrigatorios: ['email'] }, 'PUT /core/parametros/pre-cadastro': {} });
    expect(await api.ler()).toEqual({ obrigatorios: ['email'] });
    await api.gravar({ obrigatorios: ['telefone', 'endereco'] });
    expect(log[1]!.opcoes).toMatchObject({ method: 'PUT', body: { obrigatorios: ['telefone', 'endereco'] } });
  });
  it('RN-CORE-79: recusa campo fora da lista e repetição antes de enviar', async () => {
    const { api } = chamadas({});
    await expect(api.gravar({ obrigatorios: ['documento'] } as never)).rejects.toBeDefined();
    await expect(api.gravar({ obrigatorios: ['email', 'email'] })).rejects.toBeDefined();
  });
});
