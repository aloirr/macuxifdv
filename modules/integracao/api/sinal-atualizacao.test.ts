/**
 * T-0100 item 3: `POST /integracao/v1/sinal` com e sem o campo aditivo `atualizacao` (banco simulado). O que vai ao jsonb é o objeto já
 * validado pelo schema; sinal sem o campo = sem informação (o `atualizacao` anterior não é preservado).
 */
import { describe, expect, it, vi } from 'vitest';
import { atualizacaoDoSinal } from '../domain';
import { SinalConector } from '../contracts';
import { sinalDeVida } from './rotas-pedidos';

const AGORA = '2026-11-09T03:05:00.000Z';
const ATUALIZACAO = { resultado: 'revertido', codigo: 'sem_saude', versao_de: '1.2.1', versao_para: '1.3.0', em: '2026-11-09T03:00:00.000Z', mensagem: 'A versão anterior foi restaurada.' };
const sinal = (extra: Record<string, unknown> = {}) =>
  SinalConector.parse({ conector_id: 'matriz-01', versao_conector: '1.2.1', versao_contrato: 'v1', em: AGORA, fila: [], entidades: [], ...extra });

async function gravar(corpo: SinalConector) {
  const query = vi.fn(async () => ({ rows: [] }));
  const ctx = {
    tenantId: '11111111-1111-4111-8111-111111111111',
    conector: { id: 'c1', identificador: 'matriz-01' },
    corpo,
    agora: () => new Date(AGORA),
    comTenant: (fn: (d: { query: typeof query }) => Promise<unknown>) => fn({ query }),
  };
  await sinalDeVida(ctx as never, null);
  const params = query.mock.calls[0] as unknown as [string, unknown[]];
  return JSON.parse(params[1][6] as string) as Record<string, unknown>;
}

describe('T-0100: sinal de vida com o resultado da atualização automática', () => {
  it('com o campo, o resumo vai para sinal_resumo.atualizacao e o monitor o lê de volta', async () => {
    const resumo = await gravar(sinal({ atualizacao: ATUALIZACAO }));
    expect(resumo.atualizacao).toEqual(ATUALIZACAO);
    expect(atualizacaoDoSinal(resumo)).toEqual(ATUALIZACAO);
  });

  it('sem o campo (Conector antigo), nada de atualizacao no jsonb e o monitor mostra "sem informação"', async () => {
    const resumo = await gravar(sinal());
    expect(resumo).toEqual({ fila: [], entidades: [] });
    expect(atualizacaoDoSinal(resumo)).toBeNull();
  });

  it('só o que passa pelo schema chega ao jsonb: campo extra dentro de atualizacao é descartado', async () => {
    const resumo = await gravar(sinal({ atualizacao: { ...ATUALIZACAO, caminho: '/home/fulano/pacote.zip' } }));
    expect(JSON.stringify(resumo)).not.toContain('fulano');
  });

  it('resultado desconhecido ou mensagem acima de 300 caracteres é recusado pelo contrato (422 do Hub)', () => {
    expect(SinalConector.safeParse({ ...sinal(), atualizacao: { ...ATUALIZACAO, resultado: 'explodiu' } }).success).toBe(false);
    expect(SinalConector.safeParse({ ...sinal(), atualizacao: { ...ATUALIZACAO, mensagem: 'x'.repeat(301) } }).success).toBe(false);
  });
});
