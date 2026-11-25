/**
 * ADR 0075 e R-20261124-090942 item 04 — cartão "Dados da empresa" da aba Empresa, renderizado com `react-dom/server` e o cadastro
 * no cache do React Query: "Editar" e o modo só leitura (os valores ficam em `lib/portal-cadastro.test.ts`); a gaveta com o CNPJ só
 * leitura, o nome fantasia editável só para o time da Macuxi, as 11 chaves editáveis, "Trazer dados da Receita Federal" e o rodapé Cancelar/Salvar
 * (Salvar só com mudança).
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { DadosCadastraisEmpresa } from '@macuxi/platform-sdk';

import { CAMPOS_CADASTRO } from '@/lib/portal-cadastro';

import { CartaoDadosCadastrais, chaveDoCadastro, GavetaDoCadastro } from './cartao-dados-cadastrais';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const DADOS: DadosCadastraisEmpresa = {
  tenant_id: TENANT,
  cnpj: '11222333000181',
  razao_social: 'Distribuidora Uma Ltda',
  nome_fantasia: 'Uma',
  logradouro: null,
  numero: null,
  complemento: null,
  bairro: null,
  municipio: null,
  uf: null,
  cep: null,
  telefone: '9236330000',
  email: 'financeiro@uma.com.br',
  inscricao_estadual: null,
  atualizado_em: '2026-11-01T12:00:00.000Z',
};

function renderizar(no: ReactNode, dados: DadosCadastraisEmpresa | null = DADOS): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (dados) qc.setQueryData(chaveDoCadastro(TENANT), dados);
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{no}</QueryClientProvider>);
}

describe('CartaoDadosCadastrais', () => {
  it('"Editar" no título; só leitura (sem formulário nem campo), com o endereço numa linha só', () => {
    const html = renderizar(<CartaoDadosCadastrais tenant={TENANT} podeEditarNomeFantasia={false} />);
    expect(html).toContain('>Dados da empresa<');
    expect(html).toContain('data-testid="empresa-cadastro.editar"');
    expect(html).not.toContain('empresa-cadastro.formulario');
    expect(html).not.toMatch(/<input|<select/);
    expect(html).toContain('data-testid="empresa-cadastro.endereco"');
    expect(html).not.toContain('data-testid="empresa-cadastro.logradouro"');
  });

  it('carregando: sem "Editar"', () => {
    expect(renderizar(<CartaoDadosCadastrais tenant={TENANT} podeEditarNomeFantasia />, null)).not.toContain('empresa-cadastro.editar');
  });

  it('gaveta do admin do cliente: CNPJ e nome fantasia desabilitados; as 11 chaves; Receita; Salvar desabilitado sem mudança', () => {
    const html = renderizar(<GavetaDoCadastro tenant={TENANT} dados={DADOS} podeEditarNomeFantasia={false} onFechar={() => undefined} />);
    expect(html).toMatch(/data-testid="empresa-cadastro\.campo-cnpj"[^>]*disabled/);
    expect(html).toMatch(/data-testid="empresa-cadastro\.campo-nome_fantasia"[^>]*disabled/);
    for (const c of CAMPOS_CADASTRO) expect(html).toContain(`data-testid="empresa-cadastro.campo-${c}"`);
    expect(html).toContain('Trazer dados da Receita Federal');
    expect(html).toMatch(/data-testid="empresa-cadastro\.salvar"[^>]*disabled/);
    expect(html).toContain('data-testid="empresa-cadastro.cancelar"');
    // a razão social é o único obrigatório; os outros dizem "(opcional)"
    expect(html.match(/\(opcional\)/g)).toHaveLength(10);
  });

  it('gaveta do time da Macuxi: o nome fantasia editável (opcional), com o valor salvo; o CNPJ segue só leitura', () => {
    const html = renderizar(<GavetaDoCadastro tenant={TENANT} dados={DADOS} podeEditarNomeFantasia onFechar={() => undefined} />);
    const campo = html.match(/<input[^>]*data-testid="empresa-cadastro\.campo-nome_fantasia"[^>]*>/)?.[0] ?? '';
    expect(campo).toContain('value="Uma"');
    // o atributo, não a classe `disabled:opacity-60`
    expect(campo).not.toMatch(/\sdisabled(=""|\s|>|\/)/);
    expect(html).toMatch(/data-testid="empresa-cadastro\.campo-cnpj"[^>]*disabled/);
    expect(html.match(/\(opcional\)/g)).toHaveLength(11);
  });

  it('empresa sem CNPJ: sem o botão da Receita', () => {
    expect(renderizar(<GavetaDoCadastro tenant={TENANT} dados={{ ...DADOS, cnpj: null }} podeEditarNomeFantasia={false} onFechar={() => undefined} />)).not.toContain('Trazer dados da Receita Federal');
  });
});
