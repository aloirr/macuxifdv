/**
 * Spec docs/design/telas/portal-config-enxuto.md §8 e §11.4 — cartão "Plano {nome}" e a aba Empresa, renderizados com
 * `react-dom/server` e os dados já no cache do React Query (Distribuidora Uma, PME em teste, Promotor 3 e Pesquisa 10):
 * - time da Macuxi: "Trocar de plano" ao lado do título; valor e teste logo abaixo; blocos "{em uso} de {contratadas}"; "no limite"
 *   só com o selo; Plano e Administradores lado a lado;
 * - admin do cliente: só o Plano, sem "Trocar de plano" e sem Administradores;
 * - diálogo: os planos com "Atual", adicionais com um cabeçalho só, ciclo e o rodapé com Total, "Cancelar" e o principal.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { fichaExemplo, PLANOS_EXEMPLO } from '@/lib/portal-planos.fixture';

import { AbaEmpresa } from './aba-empresa';
import { CartaoPlano, chaveDaFicha, DialogoTrocarPlano } from './cartao-plano';
import { CHAVE_PLANOS } from './seletor-plano';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const ficha = fichaExemplo({ tenant_id: TENANT });

function renderizar(no: ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(chaveDaFicha(TENANT), ficha);
  qc.setQueryData(CHAVE_PLANOS, PLANOS_EXEMPLO);
  qc.setQueryData(['portal', TENANT, 'admins'], []);
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{no}</QueryClientProvider>);
}

const bloco = (html: string, item: string) => {
  const inicio = html.indexOf(`data-testid="empresa-plano.uso-${item}"`);
  if (inicio < 0) throw new Error(`sem o bloco ${item}`);
  return html.slice(inicio, html.indexOf('</li>', inicio));
};

describe('cartão Plano da aba Empresa (§11.4)', () => {
  it('time da Macuxi: "Plano PME", "Trocar de plano", valor e teste; blocos "{em uso} de {contratadas}"', () => {
    const html = renderizar(<CartaoPlano tenant={TENANT} podeTrocar />);
    expect(html).toContain('>Plano PME<');
    expect(html).toContain('data-testid="empresa-plano.trocar"');
    expect(html).toContain('R$ 1.537,00/mês');
    expect(html).toContain('Teste até 27/11/2026');
    expect(html).not.toMatch(/Contratadas|Em uso|Mensal/);
    expect(bloco(html, 'vendedor')).toContain('>14<');
    expect(bloco(html, 'vendedor')).toContain('de 20');
    expect(bloco(html, 'vendedor')).not.toContain('no limite');
    // no limite: só o selo; o número segue igual aos demais (RD-a)
    expect(bloco(html, 'gestor')).toContain('no limite');
    expect(bloco(html, 'promotor')).toContain('Promotor');
    expect(html).not.toContain('empresa-plano.uso-treinamento');
    expect(html).not.toContain('empresa-plano.dialogo');
  });

  it('admin do cliente: só vê, sem "Trocar de plano"', () => {
    const html = renderizar(<CartaoPlano tenant={TENANT} podeTrocar={false} largo />);
    expect(html).toContain('>Plano PME<');
    expect(html).toContain('R$ 1.537,00/mês');
    expect(html).not.toContain('empresa-plano.trocar');
  });
});

describe('aba Empresa (§8)', () => {
  it('time da Macuxi: Plano e Administradores lado a lado; o que vier depois, embaixo', () => {
    const html = renderizar(
      <AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi>
        <p data-testid="extra">extra</p>
      </AbaEmpresa>,
    );
    expect(html).toContain('md:grid-cols-[1.25fr_1fr]');
    expect(html.indexOf('empresa-plano.cartao')).toBeLessThan(html.indexOf('data-testid="empresa-admins"'));
    expect(html.indexOf('data-testid="empresa-admins"')).toBeLessThan(html.indexOf('data-testid="extra"'));
  });
  it('admin do cliente: só o Plano, sem Administradores', () => {
    const html = renderizar(<AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi={false} />);
    expect(html).toContain('empresa-plano.cartao');
    expect(html).not.toContain('empresa-admins');
    expect(html).not.toContain('empresa-plano.trocar');
  });
});

describe('diálogo "Trocar de plano" (§11.4)', () => {
  it('planos com "Atual" no de hoje, adicionais marcados, ciclo e o principal desabilitado sem mudança', () => {
    const html = renderizar(<DialogoTrocarPlano tenant={TENANT} ficha={ficha} aoFechar={() => undefined} aoTrocar={() => undefined} />);
    expect(html).toContain('data-testid="empresa-plano.dialogo"');
    for (const c of ['light', 'pme', 'enterprise', 'corporate']) expect(html).toContain(`data-testid="empresa.plano-${c}"`);
    expect(html.match(/>Atual</g)).toHaveLength(1);
    expect(html).toContain('30 vendedores');
    expect(html).toContain('3 gestores · 5 BKO');
    expect(html.match(/>Quantidade</g)).toHaveLength(1);
    expect(html).toContain('aria-label="Quantidade de Promotor"');
    expect(html).toContain('2 meses grátis');
    expect(html).not.toContain('dias de teste');
    expect(html).toContain('Total: R$ 1.537,00/mês');
    const confirmar = html.slice(html.indexOf('data-testid="empresa-plano.confirmar"'));
    expect(confirmar.slice(0, confirmar.indexOf('</button>'))).toMatch(/disabled=""[^>]*>Trocar de plano$/);
  });
});
