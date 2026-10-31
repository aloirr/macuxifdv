import { describe, expect, it } from 'vitest';
import { ApiRequestError, buildUrl, filenameFromDisposition } from './api';

describe('cliente da API', () => {
  it('monta a URL ignorando filtros vazios', () => {
    expect(buildUrl('/dashboards/orders', { period: 'today', branch_id: '', team_id: undefined, status: null })).toBe('http://localhost:8000/v1/dashboards/orders?period=today');
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
});
