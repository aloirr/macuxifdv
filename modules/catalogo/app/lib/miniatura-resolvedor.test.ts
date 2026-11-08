import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MiniaturaProduto } from '../../contracts';
import { baixarMiniatura, definirResolvedorMiniatura } from './miniatura-resolvedor';

const m = { url: '/v1/arquivos/3f1c0a52-0000-4000-8000-000000000001', versao: 1, largura: 200, altura: 200, bytes_max: 20000 } as unknown as MiniaturaProduto;
const portas = () => ({ fetch: vi.fn(), prefetch: vi.fn() });

afterEach(() => definirResolvedorMiniatura(null));

describe('T-0097 miniatura: resolvedor do shell', () => {
  it('file:// do resolvedor = ok, sem HEAD nem prefetch', async () => {
    definirResolvedorMiniatura(() => 'file:///cache/miniaturas/a-1.jpg');
    const p = portas();
    expect(await baixarMiniatura(m, p)).toBe('ok');
    expect(p.fetch).not.toHaveBeenCalled();
    expect(p.prefetch).not.toHaveBeenCalled();
  });
  it('relativa sem resolvedor = falhou', async () => {
    expect(await baixarMiniatura(m, portas())).toBe('falhou');
  });
  it('resolvedor que devolve null = falhou', async () => {
    definirResolvedorMiniatura(async () => null);
    expect(await baixarMiniatura(m, portas())).toBe('falhou');
  });
  it('http(s) segue com HEAD + prefetch e respeita o teto', async () => {
    definirResolvedorMiniatura(() => 'https://x/y.jpg');
    const p = portas();
    p.fetch.mockResolvedValue({ ok: true, headers: { get: () => '1000' } });
    p.prefetch.mockResolvedValue(true);
    expect(await baixarMiniatura(m, p)).toBe('ok');
    p.fetch.mockResolvedValue({ ok: true, headers: { get: () => '99999' } });
    expect(await baixarMiniatura(m, p)).toBe('grande');
  });
});
