/**
 * Spec docs/design/telas/portal-config-enxuto.md §8 e §11.4 — cartão "Plano {nome}" e a aba Empresa, renderizados com
 * `react-dom/server` e os dados já no cache do React Query (Distribuidora Uma, PME em teste, Promotor 3 e Pesquisa 10):
 * - time da Macuxi: "Trocar de plano" ao lado do título; valor e teste logo abaixo; blocos "{em uso} de {contratadas}"; "no limite"
 *   só com o selo; Plano e Administradores lado a lado;
 * - admin do cliente: só o Plano, sem "Trocar de plano" e sem Administradores;
 * - diálogo: os planos com "Atual", adicionais com um cabeçalho só, ciclo e o rodapé com Total, "Cancelar" e o principal;
 * - empresa sem plano (ficha 404 `SEM_ASSINATURA`, caso AM2808) e servidor sem planos (404 de rota, `MACUXI_PLANOS` desligado):
 *   "Módulos licenciados", sem "Trocar de plano"; a Nova empresa sem catálogo segue pelo passo antigo.
 */
import { QueryClient, QueryClientProvider, type QueryKey } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ErroPortal } from '@/lib/portal-api';
import type { EmpresaResumo } from '@/lib/portal-empresa-acoes';
import { fichaExemplo, PLANOS_EXEMPLO } from '@/lib/portal-planos.fixture';

import { AbaEmpresa } from './aba-empresa';
import { CartaoPlano, chaveDaFicha, DialogoTrocarPlano } from './cartao-plano';
import { NovaEmpresa } from './passo-empresa';
import { CHAVE_PLANOS } from './seletor-plano';

vi.mock('next/navigation', () => ({ useRouter: () => ({ push: () => undefined, replace: () => undefined }) }));

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const ficha = fichaExemplo({ tenant_id: TENANT });

const MODULOS: EmpresaResumo['modulos'] = [
  { modulo: 'core', licencas: null },
  { modulo: 'vendedor', licencas: 12 },
];

/** Query já em erro no cache (sem nova busca na montagem). */
function comErro(qc: QueryClient, chave: QueryKey, erro: Error) {
  qc.getQueryCache().build(qc, { queryKey: chave }).setState({ status: 'error', error: erro, fetchStatus: 'idle' });
}

const SEM_ASSINATURA = new ErroPortal(404, 'SEM_ASSINATURA', 'Esta empresa ainda não tem plano.');
const ROTA_AUSENTE = new ErroPortal(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');

function renderizar(no: ReactNode, { erroFicha, erroPlanos }: { erroFicha?: Error; erroPlanos?: Error } = {}): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, retryOnMount: false, staleTime: Infinity } } });
  if (erroFicha) comErro(qc, chaveDaFicha(TENANT), erroFicha);
  else qc.setQueryData(chaveDaFicha(TENANT), ficha);
  if (erroPlanos) comErro(qc, CHAVE_PLANOS, erroPlanos);
  else qc.setQueryData(CHAVE_PLANOS, PLANOS_EXEMPLO);
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
    expect(bloco(html, 'promotor')).toContain('Promotor Avulso');
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

describe('aba Empresa (planos-assinatura 03 e 04)', () => {
  it('time da Macuxi: Plano e, à direita, Administradores com os cartões da coluna direita embaixo', () => {
    const html = renderizar(
      <AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi modulos={MODULOS} colunaDireita={<p data-testid="extra">extra</p>} semPlano={<p data-testid="so-sem-plano" />} />,
    );
    expect(html).toContain('md:grid-cols-[1.25fr_1fr]');
    const direita = html.slice(html.indexOf('data-testid="empresa-pagina.coluna-direita"'));
    expect(html.indexOf('empresa-plano.cartao')).toBeLessThan(html.indexOf('data-testid="empresa-pagina.coluna-direita"'));
    expect(direita.indexOf('data-testid="empresa-admins"')).toBeGreaterThan(-1);
    expect(direita.indexOf('data-testid="empresa-admins"')).toBeLessThan(direita.indexOf('data-testid="extra"'));
    expect(html).toContain('data-testid="empresa-plano.trocar"');
    expect(html).not.toContain('empresa-pagina.modulos');
    expect(html).not.toContain('so-sem-plano');
  });
  it('admin do cliente: só o Plano, sem Administradores', () => {
    const html = renderizar(<AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi={false} modulos={MODULOS} />);
    expect(html).toContain('empresa-plano.cartao');
    expect(html).not.toContain('empresa-admins');
    expect(html).not.toContain('empresa-plano.trocar');
  });
  it('empresa sem plano (GET assinatura 404 SEM_ASSINATURA): "Módulos licenciados", sem "Trocar de plano"', () => {
    const html = renderizar(<AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi modulos={MODULOS} semPlano={<p data-testid="so-sem-plano" />} />, {
      erroFicha: SEM_ASSINATURA,
    });
    expect(html).toContain('Módulos licenciados');
    expect(html).toContain('data-testid="empresa-pagina.modulos"');
    expect(html).toContain('Vendedor · 12 licenças');
    expect(html).not.toContain('empresa-plano.trocar');
    expect(html).not.toContain('empresa-plano.cartao');
    expect(html).toContain('data-testid="empresa-admins"');
    expect(html).toContain('data-testid="so-sem-plano"');
  });
  it('servidor sem planos (MACUXI_PLANOS desligado, 404 de rota): o mesmo cartão, também para o admin do cliente', () => {
    for (const timeMacuxi of [true, false]) {
      const html = renderizar(<AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi={timeMacuxi} modulos={MODULOS} />, { erroFicha: ROTA_AUSENTE });
      expect(html).toContain('Módulos licenciados');
      expect(html).not.toContain('empresa-plano.trocar');
      expect(html).not.toContain('Ainda não disponível');
    }
  });
  it('outro erro da ficha: o erro com "Tentar de novo", não os Módulos licenciados', () => {
    const html = renderizar(<AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi modulos={MODULOS} />, { erroFicha: new ErroPortal(500, 'ERRO', 'Falhou.') });
    expect(html).not.toContain('empresa-pagina.modulos');
    expect(html).toContain('empresa-plano.cartao');
  });
});

describe('Nova empresa sem planos', () => {
  it('catálogo 404 (MACUXI_PLANOS desligado): o passo antigo, módulo por módulo', () => {
    const html = renderizar(<NovaEmpresa />, { erroPlanos: ROTA_AUSENTE });
    expect(html).not.toContain('empresa.plano-');
    expect(html).not.toContain('empresa.cnpj-estado');
    expect(html).toContain('data-testid="empresa.modulo-vendedor"');
  });
  it('com o catálogo: Plano, Adicionais e Ciclo', () => {
    const html = renderizar(<NovaEmpresa />);
    expect(html).toContain('data-testid="empresa.plano-pme"');
    expect(html).not.toContain('data-testid="empresa.modulo-vendedor"');
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
    expect(html).toContain('aria-label="Quantidade de Promotor Avulso"');
    expect(html).toContain('R$ 80,00 por licença/mês');
    expect(html).not.toMatch(/avulsa/);
    expect(html).toContain('2 meses grátis');
    expect(html).not.toContain('dias de teste');
    expect(html).toContain('Total: R$ 1.537,00/mês');
    const confirmar = html.slice(html.indexOf('data-testid="empresa-plano.confirmar"'));
    expect(confirmar.slice(0, confirmar.indexOf('</button>'))).toMatch(/disabled=""[^>]*>Trocar de plano$/);
  });
});
