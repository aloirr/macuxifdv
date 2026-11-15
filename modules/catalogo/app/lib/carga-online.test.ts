import { describe, expect, it, vi } from 'vitest';
import { ConsultaIndisponivel } from '@macuxi/platform-sdk';
import {
  catalogoPendente,
  definirCargaOnline,
  fichasDaApi,
  modoDaCarga,
  paginasDaApi,
  soVendaveisNaCarga,
  usarApiNaCarga,
  type PortaCargaOnline,
} from './carga-online';

const porta = (o: Partial<PortaCargaOnline> = {}): PortaCargaOnline => ({ pendentes: () => ['tabela_preco_item'], online: () => true, get: vi.fn(), ...o });

describe('catálogo pendente na carga inicial (ADR 0054, solução 5)', () => {
  it('RF-CAT-01: pendente quando a etapa ou uma entidade do catálogo/produto ainda não terminou', () => {
    expect(catalogoPendente(['catalogo_precos'])).toBe(true);
    expect(catalogoPendente(['produto'])).toBe(true);
    expect(catalogoPendente(['estoque_saldo', 'cliente'])).toBe(true);
  });
  it('RF-CAT-01: sem pendência, ausente ou só de outros módulos = não pendente (comportamento de hoje, local)', () => {
    expect(catalogoPendente([])).toBe(false);
    expect(catalogoPendente(undefined)).toBe(false);
    expect(catalogoPendente(['cliente', 'pedido'])).toBe(false);
  });
});

describe('fonte da busca durante a carga', () => {
  it('RF-CAT-01: pendente e com sinal vai à API; pendente sem sinal avisa; sem pendência segue local', () => {
    expect(usarApiNaCarga(porta())).toBe('api');
    expect(usarApiNaCarga(porta({ online: () => false }))).toBe('sem_sinal');
    expect(usarApiNaCarga(porta({ pendentes: () => [] }))).toBe('local');
    expect(usarApiNaCarga(null)).toBe('local');
  });
  it('RN-CAT-06: na carga, dentro do pedido, só entra produto vendável (perfil sem preço não é filtrado: RN-CAT-05)', () => {
    const itens = [
      { id: 'a', price: { sellable: true } },
      { id: 'b', price: { sellable: false } },
      { id: 'c', price: null },
    ];
    expect(soVendaveisNaCarga(itens).map((i) => i.id)).toEqual(['a', 'c']);
  });
});

describe('paginação da API durante a carga', () => {
  it('RF-CAT-01: junta páginas de 50 até o limite pedido e para quando a API acaba', async () => {
    const pagina = (de: number, n: number, prox: number | null) => ({ items: Array.from({ length: n }, (_, i) => ({ id: String(de + i) })), total: 120, next_offset: prox });
    const get = vi.fn().mockResolvedValueOnce(pagina(0, 50, 50)).mockResolvedValueOnce(pagina(50, 50, 100));
    const r = await paginasDaApi<{ id: string }>(get, '/x', { q: 'a' }, 80);
    expect(r.items).toHaveLength(80);
    expect(r.total).toBe(120);
    expect(get).toHaveBeenNthCalledWith(2, '/x', { q: 'a', limit: 50, offset: 50 });
  });
  it('RF-CAT-01: next_offset nulo encerra', async () => {
    const get = vi.fn().mockResolvedValueOnce({ items: [{ id: '1' }], total: 1, next_offset: null });
    expect((await paginasDaApi(get, '/x', {}, 100)).items).toHaveLength(1);
    expect(get).toHaveBeenCalledTimes(1);
  });
});

describe('fichas da API (preço do cliente e textos)', () => {
  it('RN-CAT-06: pede a ficha com o customer_id; falha de uma ficha derruba a consulta (não finge "sem preço")', async () => {
    const get = vi.fn().mockResolvedValueOnce({ product: { id: 'a' } }).mockRejectedValueOnce(new Error('x'));
    await expect(fichasDaApi(get, ['a', 'b'], 'c1')).rejects.toBeInstanceOf(ConsultaIndisponivel);
    expect(get).toHaveBeenCalledWith('/v1/catalogo/produtos/a', { customer_id: 'c1' });
  });
  it('RN-CAT-05: sem cliente não manda customer_id', async () => {
    const get = vi.fn().mockResolvedValue({ product: { id: 'a' } });
    await fichasDaApi(get, ['a'], null);
    expect(get).toHaveBeenCalledWith('/v1/catalogo/produtos/a', {});
  });
  it('definirCargaOnline guarda a porta do shell', () => {
    expect(() => definirCargaOnline(porta())).not.toThrow();
    definirCargaOnline(null);
  });
});

describe('modo da carga a partir do estado do sync', () => {
  it('RF-CAT-01: sem pendência do catálogo = local, com ou sem sinal', () => {
    expect(modoDaCarga({}, true)).toBe('local');
    expect(modoDaCarga({ pendentes: ['cliente'] }, false)).toBe('local');
  });
  it('RF-CAT-01: pendente com sinal = api; pendente sem sinal = sem_sinal', () => {
    expect(modoDaCarga({ pendentes: ['catalogo_precos'] }, true)).toBe('api');
    expect(modoDaCarga({ pendentes: ['produto'] }, false)).toBe('sem_sinal');
  });
});
