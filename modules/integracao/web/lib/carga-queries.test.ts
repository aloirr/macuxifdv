import { beforeEach, describe, expect, it, vi } from 'vitest';

const api = vi.fn();
vi.mock('@macuxi/platform-sdk/web', () => ({ api: (...a: unknown[]) => api(...a), apiFetch: vi.fn(), downloadBlob: vi.fn() }));
vi.mock('@tanstack/react-query', () => ({ useMutation: vi.fn(), useQueryClient: vi.fn() }));

import { enviarCarga, ErroDeArquivo } from './carga-queries';

const ID = '7d1f6c1e-6d55-4c38-9b1f-1d1f0e8f0a01';
const aceita = (n: number) => ({ lote_id: ID, status: 'recebido', entidade: 'cliente', modo: 'delta', recebidos: n, consulta: `/integracao/v1/lotes/${ID}`, conector_id: 'arquivo-bko', linhas_lidas: n, linhas_invalidas_leitura: 0 });

beforeEach(() => api.mockReset());

describe('T-0100: envio da carga pelo BKO', () => {
  it('RN-INT-12: cada parte vai em POST cargas-arquivo, na ordem, com a MESMA chave; o tenant nunca é enviado (vem do token)', async () => {
    api.mockImplementation(async () => ({ ...aceita(1), lote_id: ID }));
    const texto = ['a;b', ...Array.from({ length: 5001 }, (_, i) => `x${i};y`)].join('\n');
    const progresso: number[] = [];
    const r = await enviarCarga({ entidade: 'cliente', modo: 'completo', texto, aoEnviarParte: (n) => progresso.push(n) }, 'bko-chave-0123456789', () => ID);
    expect(api).toHaveBeenCalledTimes(2);
    const corpos = api.mock.calls.map((c) => (c[1] as { body: Record<string, unknown> }).body);
    expect(api.mock.calls.every((c) => c[0] === '/integracao/cargas-arquivo' && (c[1] as { method: string }).method === 'POST')).toBe(true);
    expect(corpos.map((c) => c.parte)).toEqual([1, 2]);
    expect(new Set(corpos.map((c) => c.chave_idempotencia))).toEqual(new Set(['bko-chave-0123456789']));
    expect(corpos.every((c) => !('tenant_id' in c))).toBe(true);
    expect(progresso).toEqual([1, 2]);
    expect(r.aceitas).toHaveLength(2);
  });

  it('T-0100: a API recusa a parte 2 (ex.: 403/422): para sem enviar as seguintes e repassa a mensagem', async () => {
    api.mockResolvedValueOnce(aceita(1)).mockRejectedValueOnce(new Error('Só administrador ou analista envia carga por arquivo.'));
    const texto = ['a;b', ...Array.from({ length: 5001 }, (_, i) => `x${i};y`)].join('\n');
    await expect(enviarCarga({ entidade: 'cliente', modo: 'delta', texto }, 'bko-chave-0123456789', () => ID)).rejects.toThrow('Só administrador');
    expect(api).toHaveBeenCalledTimes(2);
  });

  it('T-0100: arquivo sem linhas de dados nem chega à API', async () => {
    await expect(enviarCarga({ entidade: 'cliente', modo: 'delta', texto: 'a;b\n' })).rejects.toBeInstanceOf(ErroDeArquivo);
    expect(api).not.toHaveBeenCalled();
  });
});
