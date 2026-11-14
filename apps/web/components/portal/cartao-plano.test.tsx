/**
 * Spec portal-config-enxuto §8 e §11.4 (R-20261114-181000) — cartão "Plano {nome}" da aba Empresa, renderizado com
 * `react-dom/server` e a ficha já no cache do React Query (a do modo falso: Distribuidora Uma, PME em teste):
 * - time da Macuxi: "Trocar de plano" ao lado do título; valor e teste logo abaixo; blocos "{em uso} de {contratadas}";
 *   "no limite" só com o selo;
 * - admin do cliente: só vê (sem "Trocar de plano").
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { FichaAssinaturaSchema, ITENS_CONTADOS, licencasContratadas, valorDaAssinatura } from '@macuxi/platform-sdk';

import { PLANOS_FALSOS } from '@/lib/portal-falso';

import { CartaoPlano, chaveDaFicha } from './cartao-plano';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const pme = PLANOS_FALSOS[1];
if (!pme) throw new Error('catálogo falso incompleto');
const adicionais = [
  { adicional: 'promotor' as const, quantidade: 3 },
  { adicional: 'pesquisa' as const, quantidade: 10 },
];
const emUso: Record<string, number> = { vendedor: 14, gestor: 2, bko: 1, promotor: 3, pesquisa: 6 };
const contratadas = licencasContratadas(pme, adicionais);
const ficha = FichaAssinaturaSchema.parse({
  tenant_id: TENANT,
  plano: pme,
  ciclo: 'mensal',
  adicionais,
  teste_ate: '2026-11-27',
  paga: false,
  licencas: ITENS_CONTADOS.map((item) => ({ item, contratadas: contratadas[item], em_uso: emUso[item] ?? 0 })),
  valor: valorDaAssinatura(pme, adicionais, 'mensal'),
  desde: '2026-11-01T12:00:00.000Z',
  atualizada_em: '2026-11-01T12:00:00.000Z',
});

function renderizar(podeTrocar: boolean): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(chaveDaFicha(TENANT), ficha);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <CartaoPlano tenant={TENANT} podeTrocar={podeTrocar} largo={!podeTrocar} />
    </QueryClientProvider>,
  );
}

const bloco = (html: string, item: string) => {
  const inicio = html.indexOf(`data-testid="empresa-plano.uso-${item}"`);
  if (inicio < 0) throw new Error(`sem o bloco ${item}`);
  return html.slice(inicio, html.indexOf('</li>', inicio));
};

describe('cartão Plano da aba Empresa', () => {
  it('time da Macuxi: título "Plano PME", "Trocar de plano", valor e teste; blocos "{em uso} de {contratadas}"', () => {
    const html = renderizar(true);
    expect(html).toContain('Plano PME');
    expect(html).toContain('data-testid="empresa-plano.trocar"');
    expect(html).toContain('R$ 1.537,00/mês');
    expect(html).toContain('Teste até 27/11/2026');
    expect(html).not.toContain('Contratadas');
    expect(bloco(html, 'vendedor')).toContain('>14<');
    expect(bloco(html, 'vendedor')).toContain('de 20');
    expect(bloco(html, 'vendedor')).not.toContain('no limite');
    // no limite: só o selo, o número segue igual aos demais (RD-a)
    expect(bloco(html, 'gestor')).toContain('no limite');
    expect(bloco(html, 'gestor')).not.toContain('text-warning font-');
    expect(bloco(html, 'promotor')).toContain('Promotor Avulso');
    expect(html).not.toContain('empresa-plano.uso-treinamento');
    expect(html).not.toContain('empresa-plano.dialogo');
  });

  it('admin do cliente: só vê, sem "Trocar de plano"', () => {
    const html = renderizar(false);
    expect(html).toContain('Plano PME');
    expect(html).not.toContain('empresa-plano.trocar');
  });
});
