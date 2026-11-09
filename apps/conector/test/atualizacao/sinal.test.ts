import { AtualizacaoConector } from '@macuxi/integracao/contracts';
import { describe, expect, it } from 'vitest';
import { atualizacaoParaSinal } from '../../src/atualizacao/sinal';
import type { ResultadoAtualizacao } from '../../src/atualizacao/resultado';

const base = { em: '2026-11-09T03:00:00.000Z', duracao_ms: 900, mensagem: 'Texto curto.' };

describe('T-0100: ResultadoAtualizacao -> resumo do sinal de vida', () => {
  it('sem resultado = nada a enviar', () => expect(atualizacaoParaSinal(null)).toBeNull());

  it.each<[string, ResultadoAtualizacao]>([
    ['atualizado', { resultado: 'atualizado', de: '1.2.1', para: '1.3.0', ...base }],
    ['mantido', { resultado: 'mantido', versao: '1.2.1', oferecida: '1.3.0', motivo: 'sha256_diferente', ...base }],
    ['mantido sem oferta', { resultado: 'mantido', versao: '1.2.1', oferecida: null, motivo: 'sem_pacote', ...base }],
    ['revertido', { resultado: 'revertido', de: '1.2.1', tentou: '1.3.0', motivo: 'falha_na_subida', anterior: 'saudavel', ...base }],
  ])('%s vira um AtualizacaoConector válido, com o código do motivo e as versões certas', (_n, r) => {
    const s = atualizacaoParaSinal(r);
    expect(AtualizacaoConector.safeParse(s).success).toBe(true);
    expect(s?.resultado).toBe(r.resultado);
    expect(s?.em).toBe(base.em);
    expect(s?.codigo ?? null).toBe('motivo' in r ? r.motivo : null);
  });
});
