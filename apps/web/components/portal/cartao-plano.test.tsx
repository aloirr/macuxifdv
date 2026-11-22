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
import { PassoEmpresa } from './passo-empresa-legado';
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
    // o "Acrescentar módulos" fica dentro do cartão "Módulos licenciados", antes da coluna da direita (RD-2613)
    expect(html.indexOf('data-testid="so-sem-plano"')).toBeGreaterThan(html.indexOf('data-testid="empresa-pagina.modulos"'));
    expect(html.indexOf('data-testid="so-sem-plano"')).toBeLessThan(html.indexOf('data-testid="empresa-pagina.coluna-direita"'));
    // nome do mapa único do kit, sem Core e Integração (RD-2617)
    expect(html).not.toContain('>Core<');
    expect(html).not.toContain('Integração com o ERP');
  });
  it('empresa sem plano, passo antigo: só as caixas dos módulos não licenciados e "Acrescentar módulos" (RD-2613)', () => {
    const existente = { id: TENANT, codigo: 'am2808', razao_social: 'Distribuidora Dois', cnpj: '11222333000181', fuso: 'America/Manaus', modulos: [...MODULOS, { modulo: 'catalogo' as const, licencas: null }] };
    const html = renderizar(<AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi modulos={existente.modulos} semPlano={<PassoEmpresa existente={existente} />} />, { erroFicha: SEM_ASSINATURA });
    for (const m of ['gestor', 'pesquisa', 'promotor', 'treinamento']) expect(html).toContain(`data-testid="empresa.modulo-${m}"`);
    // o Catálogo já licenciado aparece no cartão e não se acrescenta de novo; Core e Integração nunca aparecem (RD-2617)
    for (const m of ['vendedor', 'core', 'catalogo', 'integracao']) expect(html).not.toContain(`data-testid="empresa.modulo-${m}"`);
    expect(html).toContain('>Catálogo<');
    for (const t of ['empresa.razao-social', 'empresa.cnpj', 'empresa.codigo', 'empresa.fuso', 'empresa.admin', 'empresa.conferir']) expect(html).not.toContain(`data-testid="${t}"`);
    expect(html).not.toMatch(/Módulos e licenças|Administrador da empresa|Conferir sem gravar/);
    expect(html).toContain('>Acrescentar módulos<');
    expect(html.match(/>Vendedor/g)).toHaveLength(1);
  });
  it('empresa sem plano e sem o Catálogo: o Catálogo entra no "Acrescentar módulos", desmarcado (RD-2617)', () => {
    const existente = { id: TENANT, codigo: 'am2808', razao_social: 'Distribuidora Dois', cnpj: '11222333000181', fuso: 'America/Manaus', modulos: MODULOS };
    const html = renderizar(<AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi modulos={MODULOS} semPlano={<PassoEmpresa existente={existente} />} />, { erroFicha: SEM_ASSINATURA });
    expect(html).toMatch(/<input type="checkbox" data-testid="empresa\.modulo-catalogo"(?![^>]*checked)/);
    for (const m of ['core', 'integracao']) expect(html).not.toContain(`data-testid="empresa.modulo-${m}"`);
  });
  it('empresa sem plano com tudo licenciado: só os selos, sem o formulário', () => {
    const todos = (['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao'] as const).map((modulo) => ({ modulo, licencas: null }));
    const existente = { id: TENANT, codigo: 'am2808', razao_social: 'Distribuidora Dois', cnpj: null, fuso: 'America/Manaus', modulos: todos };
    const html = renderizar(<AbaEmpresa tenant={TENANT} fuso="America/Manaus" timeMacuxi modulos={todos} semPlano={<PassoEmpresa existente={existente} />} />, { erroFicha: SEM_ASSINATURA });
    expect(html).not.toContain('empresa.form');
    expect(html).toContain('>Treinamento<');
    expect(html).toContain('>Catálogo<');
    expect(html).not.toContain('>Core<');
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
    // empresa nova: Empresa, Administrador (o bloco comum, RD-2620), módulos sem os nativos e o "Conferir sem gravar"
    for (const t of ['empresa.razao-social', 'empresa.admin', 'empresa.admin-senha', 'empresa.conferir']) expect(html).toContain(`data-testid="${t}"`);
    // só Core e Integração ficam fora; o Catálogo é opcional e vem desmarcado (RD-2617)
    for (const m of ['core', 'integracao']) expect(html).not.toContain(`data-testid="empresa.modulo-${m}"`);
    expect(html).toMatch(/<input type="checkbox" data-testid="empresa\.modulo-catalogo"(?![^>]*checked)/);
    expect(html).toContain('>Criar empresa<');
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

  it('Dialog extra-larga (880 px) com os 4 planos numa linha a partir de 768 px e 2 × 2 abaixo (RD-2616)', () => {
    const html = renderizar(<DialogoTrocarPlano tenant={TENANT} ficha={ficha} aoFechar={() => undefined} aoTrocar={() => undefined} />);
    expect(html).toContain('sm:max-w-[880px]');
    expect(html).toContain('class="grid grid-cols-2 gap-3 md:grid-cols-4"');
  });

  it('principal desabilitado só com o desabilitado do kit (Névoa e texto de apoio), sem classe própria do portal', () => {
    const html = renderizar(<DialogoTrocarPlano tenant={TENANT} ficha={ficha} aoFechar={() => undefined} aoTrocar={() => undefined} />);
    const confirmar = html.slice(html.lastIndexOf('<button', html.indexOf('data-testid="empresa-plano.confirmar"')));
    const tag = confirmar.slice(0, confirmar.indexOf('>'));
    expect(tag).toContain('disabled:bg-neutral-soft');
    expect(tag).toContain('disabled:text-texto-apoio');
    expect(tag).not.toContain('!');
  });
});
