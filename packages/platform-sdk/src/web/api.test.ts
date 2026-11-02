import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiRequestError, baseDaChamada, buildUrl, errorMessage, filenameFromDisposition, lerCorpoDeErro, lerModoApiWeb, PROXY_BASE, MENSAGEM_ERRO_PADRAO, MENSAGEM_FORMATO_INESPERADO, urlPadraoDaApi } from './api';

describe('cliente da API', () => {
  it('monta a URL ignorando filtros vazios', () => {
    expect(buildUrl('/dashboards/orders', { period: 'today', branch_id: '', team_id: undefined, status: null }, 'http://localhost:8000/v1')).toBe('http://localhost:8000/v1/dashboards/orders?period=today');
  });

  it('PUT passa pelo proxy same-origin (CORS do mock-api)', () => {
    expect(buildUrl('/incentive-plans/p1', undefined, '/api-proxy')).toBe('/api-proxy/incentive-plans/p1');
  });

  it('lê o nome do arquivo do Content-Disposition', () => {
    expect(filenameFromDisposition('attachment; filename="rv_2026-10.csv"', 'x.csv')).toBe('rv_2026-10.csv');
    expect(filenameFromDisposition("attachment; filename*=UTF-8''rv%202026.csv", 'x.csv')).toBe('rv 2026.csv');
    expect(filenameFromDisposition(null, 'x.csv')).toBe('x.csv');
  });

  it('reconhece planilha aberta no Excel (503 file_locked)', () => {
    expect(new ApiRequestError(503, 'file_locked', 'Feche pedidos.xlsx no Excel').isFileLocked).toBe(true);
    expect(new ApiRequestError(403, 'forbidden', 'x').isFileLocked).toBe(false);
  });

  it('T-0003 F2: API real por padrão (8100, tudo pelo proxy same-origin); demo só com NEXT_PUBLIC_API_MODO=demo', () => {
    expect(lerModoApiWeb(undefined)).toBe('v1');
    expect(lerModoApiWeb(' DEMO ')).toBe('demo');
    expect(urlPadraoDaApi('v1')).toBe('http://localhost:8100/v1');
    expect(urlPadraoDaApi('demo')).toBe('http://localhost:8000/v1');
    expect(baseDaChamada('GET', 'v1')).toBe(PROXY_BASE);
    expect(baseDaChamada('GET', 'demo')).not.toBe(PROXY_BASE);
  });

  it('lê o erro da API v1 ({ codigo, mensagem, detalhes }) e o da Fase M ({ code, message, details })', () => {
    expect(lerCorpoDeErro(423, { codigo: 'USUARIO_BLOQUEADO', mensagem: 'Bloqueado.' })).toEqual({ code: 'USUARIO_BLOQUEADO', message: 'Bloqueado.' });
    expect(lerCorpoDeErro(409, { code: 'invalid_transition', message: 'x', details: { a: 1 } })).toEqual({ code: 'invalid_transition', message: 'x', details: { a: 1 } });
    expect(lerCorpoDeErro(500, 'texto')).toEqual({ code: 'http_error', message: 'Erro 500 no servidor.' });
  });

  it('T-0059: errorMessage nunca devolve o JSON do Zod nem pilha; a frase da API passa', () => {
    const console_ = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const zod = z.object({ documento: z.string() }).safeParse({});
    expect(zod.success).toBe(false);
    if (!zod.success) expect(errorMessage(zod.error)).toBe(MENSAGEM_FORMATO_INESPERADO);
    expect(errorMessage(new Error('[{"code":"invalid_type","path":["cliente","documento"]}]'))).toBe(MENSAGEM_ERRO_PADRAO);
    expect(errorMessage(new ApiRequestError(422, 'RN-VEN-13', 'Salve como orçamento.'))).toBe('Salve como orçamento.');
    expect(errorMessage(new Error('Sem conexão com o servidor.'))).toBe('Sem conexão com o servidor.');
    expect(errorMessage('x')).toBe(MENSAGEM_ERRO_PADRAO);
    expect(console_).toHaveBeenCalledTimes(2);
    console_.mockRestore();
  });
});
