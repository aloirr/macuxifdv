/**
 * Aba "Integração" do portal (spec portal-config-enxuto §10.2 e §10.5), renderizada com `react-dom/server` e a lista no cache:
 * - dois lados (Conector | API) em 2 colunas ≥ 768 px com a divisória de 1 px, passos 1 a 3 e a tabela "Conectores";
 * - lado da API pela mesma rota (`tipo: 'nuvem'`): "Gerar a credencial" neutro, "Guia" (PDF só com `guiaPdf`) e "Credenciais";
 * - filtro por tipo nas duas tabelas; "Gerar nova chave" e "Desativar" só nas linhas ativas;
 * - `gerarNovaChave` (sucesso e rota ausente), `desativarCredencial` (PATCH `{ ativo: false }`) e a rota da chave no modo falso;
 * - sai o que era do CSV (diálogo de passar as bases, Carga por arquivo, textos de CSV).
 */
import { ENTIDADES, type ConectorResumo } from '@macuxi/integracao/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroPortal, TEXTO_INDISPONIVEL, type OpcoesChamada } from '@/lib/portal-api';
import { responderFalso, zerarModoFalso } from '@/lib/portal-falso';
import { ENCAIXE_API_HUB, ROTAS_PORTAL } from '@/lib/portal-rotas';

import { AbaIntegracao, desativarCredencial, gerarNovaChave, LadoApi, ListaCredenciais } from './aba-integracao';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const conector = (n: number, conector_id: string, x: Partial<ConectorResumo> = {}): ConectorResumo => ({
  id: `5d1e2c0a-7b3f-4a51-8c2d-0000000000${String(n).padStart(2, '0')}`,
  conector_id,
  nome: conector_id,
  tipo: 'conector',
  ativo: true,
  recebe_pedidos: true,
  aceita_cancelamento: false,
  entidades: [...ENTIDADES],
  ips_permitidos: [],
  versao_conector: null,
  situacao_versao: 'sem_politica',
  ultimo_sinal_em: null,
  saude: 'nunca_conectou',
  chave: null,
  criado_em: '2026-11-14T12:00:00.000Z',
  ...x,
});

function renderizar(no: ReactNode, cache: [readonly unknown[], unknown][] = []): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  for (const [chave, dado] of cache) qc.setQueryData(chave, dado);
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{no}</QueryClientProvider>);
}

const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

describe('AbaIntegracao', () => {
  const lista = [
    conector(1, 'erp'),
    conector(2, 'implantacao-csv', { tipo: 'arquivo', recebe_pedidos: false }),
    conector(3, 'erp-api', { tipo: 'nuvem', recebe_pedidos: false }),
    conector(4, 'erp-velho', { ativo: false }),
  ];
  const html = renderizar(<AbaIntegracao tenant={TENANT} />, [[['portal', TENANT, 'conectores'], lista]]);
  const t = texto(html);

  it('dois lados com a mesma largura (2 colunas ≥ 768 px) e a divisória de 1 px; abaixo disso, Conector primeiro e a divisória 24 px antes da API', () => {
    expect(html).toContain('data-testid="integracao.aba" class="grid md:grid-cols-2"');
    expect(html).toMatch(/aria-labelledby="integracao-conector" class="[^"]*border-b border-line pb-6 md:border-r md:border-b-0 md:pr-6 md:pb-0/);
    expect(html).toMatch(/aria-labelledby="integracao-api" class="[^"]*pt-6 md:pt-0 md:pl-6/);
    expect(t.indexOf('Integração via Conector')).toBeLessThan(t.indexOf('Integração via API'));
  });

  it('Conector: passos 1 a 3 na ordem, com o botão do link no passo 1, e a tabela "Conectores" só com os do tipo conector', () => {
    const ordem = ['1 Baixar o Conector', 'Gerar o link do Conector', '2 Gerar a credencial', '3 Instalar e colar a credencial', 'Conectores'].map((x) => t.indexOf(x));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(html).toMatch(/rounded-full bg-accent [^"]*text-white">1</);
    expect(t).toContain('Instale o Conector no servidor do ERP. Cole o identificador e a chave na configuração. Inicie o serviço.');
    expect(t).toContain('Identificador Nome');
    expect(t).toContain('Envia os pedidos aprovados ao ERP');
    expect(html).toMatch(/class="[^"]*bg-accent text-white[^"]*" data-testid="integracao\.gerar"/);
    expect(html).toContain('data-testid="integracao.conectores"');
    expect(t).toContain('Identificador Pedidos Situação erp Sim Ativo Gerar nova chave Desativar erp-velho Sim Desativado Integração via API');
    expect(t).not.toContain('implantacao-csv');
  });

  it('"Credenciais" só com as de tipo nuvem; "Conectores" sem elas', () => {
    const conectores = html.slice(html.indexOf('data-testid="integracao.conectores"'), html.indexOf('integracao-api'));
    const credenciais = html.slice(html.indexOf('data-testid="integracao.api-credenciais"'));
    expect(conectores).toContain('>erp<');
    expect(conectores).not.toContain('erp-api');
    expect(credenciais).toContain('>erp-api<');
    expect(credenciais).not.toMatch(/>erp<|erp-velho/);
    expect(t).toContain('Credenciais Identificador Pedidos Situação erp-api — Ativo Gerar nova chave Desativar');
  });

  it('botões por linha só nas ativas, com os testIDs integracao.nova-chave.<id> e integracao.desativar.<id>', () => {
    for (const c of [lista[0], lista[2]]) {
      expect(html).toContain(`data-testid="integracao.nova-chave.${c?.id}"`);
      expect(html).toContain(`data-testid="integracao.desativar.${c?.id}"`);
    }
    expect(html).not.toContain(`integracao.nova-chave.${lista[3]?.id}`);
    expect(html).not.toContain(`integracao.desativar.${lista[3]?.id}`);
    expect(html).not.toContain('Desativar erp'); // o diálogo só abre no clique
  });

  it('API: "Gerar a credencial" neutro, "Guia" com o OpenAPI e sem o botão do PDF enquanto ele não existir', () => {
    expect(ENCAIXE_API_HUB).toEqual({ guiaPdf: null });
    expect(t).toMatch(/Integração via API Gerar a credencial Identificador Nome Envia os pedidos aprovados ao ERP Gerar credencial Guia Documentação \(OpenAPI 3\.1\) Credenciais/);
    expect(html).toContain('data-testid="integracao.openapi"');
    expect(html).not.toContain('integracao.guia');
  });

  it('sai o que era do CSV e do diálogo de passar as bases', () => {
    for (const velho of ['integracao.confirmar', 'integracao.ja-copiei', 'Carga por arquivo', 'CSV', 'Passar as bases', 'chega em breve', 'Gera a chave', 'Vai no arquivo de configuração', 'Credencial do Conector', 'Tipo', 'Bases'])
      expect(html, velho).not.toContain(velho);
  });
});

describe('LadoApi', () => {
  const q = (data: ConectorResumo[]) => ({ isPending: false, isError: false, error: null, data, refetch: () => undefined });
  const guiaPdf = '/api-proxy/_publico/integracao/v1/guia.pdf';

  it('"Gerar a credencial" com os mesmos campos e o botão neutro; "Guia" com o PDF e o OpenAPI; "Credenciais" vazia', () => {
    const html = renderizar(<LadoApi tenant={TENANT} q={q([])} todos={[]} guiaPdf={guiaPdf} aoMudar={() => undefined} />);
    const t = texto(html);
    expect(t).toMatch(/^\s*Gerar a credencial Identificador Nome Envia os pedidos aprovados ao ERP Gerar credencial Guia Baixar o guia \(PDF\) Documentação \(OpenAPI 3\.1\) Credenciais Nenhuma credencial\.\s*$/);
    expect(html).toContain('placeholder="ex.: erp-api"');
    expect(html).toContain('placeholder="ex.: ERP do cliente"');
    expect(html).toMatch(/data-testid="integracao\.api-gerar"[^>]*disabled/);
    expect(html).not.toMatch(/bg-accent text-white[^"]*" data-testid="integracao\.api-gerar"/);
    expect(html).toContain('data-testid="integracao.guia"');
  });

  it('sem o PDF, o "Guia" fica só com o link do OpenAPI', () => {
    const html = renderizar(<LadoApi tenant={TENANT} q={q([])} todos={[]} guiaPdf={null} aoMudar={() => undefined} />);
    expect(html).not.toContain('Baixar o guia (PDF)');
    expect(html).toContain('Documentação (OpenAPI 3.1)');
  });
});

describe('Gerar nova chave e Desativar', () => {
  type Pedido = { caminho: string; o: OpcoesChamada<unknown> };
  const falsa = (resposta: () => unknown) => {
    const pedidos: Pedido[] = [];
    const chamar = (async (caminho: string, o: OpcoesChamada<unknown>) => {
      pedidos.push({ caminho, o });
      return resposta();
    }) as <T>(caminho: string, o: OpcoesChamada<T>) => Promise<T>;
    return { pedidos, chamar };
  };
  const ID = '5d1e2c0a-7b3f-4a51-8c2d-000000000003';
  const criado = { conector: conector(3, 'erp-api', { tipo: 'nuvem' }), chave: { conector_id: 'erp-api', escopo: 'integracao.v1', chave: 'mx_teste_0123456789abcdef0123456789abcdef', prefixo: 'mx_teste', criada_em: '2026-11-22T12:00:00.000Z', anterior_valida_ate: null } };

  it('nova chave: POST na rota da chave, com o tenant; devolve a chave para mostrar uma vez', async () => {
    const f = falsa(() => criado);
    expect(ROTAS_PORTAL.chaveConector(ID)).toBe(`/integracao/conectores/${ID}/chave`);
    expect(await gerarNovaChave(TENANT, ID, f.chamar)).toEqual({ criado });
    expect(f.pedidos).toMatchObject([{ caminho: `/integracao/conectores/${ID}/chave`, o: { metodo: 'POST', tenant: TENANT } }]);
  });

  it('nova chave: 404 de rota ausente vira o texto de indisponível; outro erro, a mensagem da API', async () => {
    const ausente = falsa(() => {
      throw new ErroPortal(404, 'NAO_ENCONTRADO', 'Rota não encontrada.');
    });
    expect(await gerarNovaChave(TENANT, ID, ausente.chamar)).toEqual({ erro: TEXTO_INDISPONIVEL });
    const outro = falsa(() => {
      throw new ErroPortal(409, 'conector_inativo', 'Este Conector está desativado.');
    });
    expect(await gerarNovaChave(TENANT, ID, outro.chamar)).toEqual({ erro: 'Este Conector está desativado.' });
  });

  it('desativar: PATCH { ativo: false } na rota do Conector; erro vira a frase da tela', async () => {
    const f = falsa(() => ({ ...criado.conector, ativo: false }));
    expect(await desativarCredencial(TENANT, ID, f.chamar)).toBeNull();
    expect(f.pedidos).toMatchObject([{ caminho: `/integracao/conectores/${ID}`, o: { metodo: 'PATCH', tenant: TENANT, corpo: { ativo: false } } }]);
    const r = falsa(() => {
      throw new ErroPortal(404, 'CONECTOR_NAO_ENCONTRADO', 'Conector não encontrado.');
    });
    expect(await desativarCredencial(TENANT, ID, r.chamar)).toBe('Conector não encontrado.');
  });

  it('a confirmação do Desativar é um diálogo que só abre no clique (fechado, nada no HTML)', () => {
    const html = renderizar(<ListaCredenciais itens={[conector(3, 'erp-api', { tipo: 'nuvem' })]} vazio="Nenhuma credencial." testId="x" tenant={TENANT} aoMudar={() => undefined} />);
    expect(html).toContain(`data-testid="integracao.desativar.${ID}"`);
    expect(html).not.toContain('integracao.desativar-confirmar');
    expect(html).not.toContain('A chave deixa de valer.');
  });
});

describe('modo falso: credencial de API (tipo nuvem), nova chave e desativar', () => {
  class Memoria {
    private m = new Map<string, string>();
    getItem(k: string) {
      return this.m.get(k) ?? null;
    }
    setItem(k: string, v: string) {
      this.m.set(k, v);
    }
    removeItem(k: string) {
      this.m.delete(k);
    }
  }
  beforeEach(() => {
    vi.stubGlobal('window', { sessionStorage: new Memoria() });
    zerarModoFalso();
  });
  afterEach(() => vi.unstubAllGlobals());

  it('cria e lista a de tipo nuvem; gera nova chave; desativada, a nova chave é recusada', async () => {
    const login = (await (await responderFalso('POST', ROTAS_PORTAL.login, { email: 'time@macuxi.com.br', senha: 'Senha#Forte2026' }, {})).json()) as { token: string };
    const cab = { Authorization: `Bearer ${login.token}`, 'x-macuxi-tenant': TENANT, 'Content-Type': 'application/json' };
    const r = await responderFalso('POST', ROTAS_PORTAL.conectores, { conector_id: 'erp-api', nome: 'ERP do cliente', tipo: 'nuvem', recebe_pedidos: false }, cab);
    expect(r.status).toBe(201);
    const { conector: c } = (await r.json()) as { conector: ConectorResumo };
    const lista = (await (await responderFalso('GET', ROTAS_PORTAL.conectores, undefined, cab)).json()) as { itens: ConectorResumo[] };
    expect(lista.itens.map((x) => [x.conector_id, x.tipo])).toEqual([['erp-api', 'nuvem']]);
    const k = await responderFalso('POST', ROTAS_PORTAL.chaveConector(c.id), undefined, cab);
    expect(k.status).toBe(201);
    expect(((await k.json()) as { chave: { chave: string } }).chave.chave).toMatch(/^mx_falso_/);
    expect((await responderFalso('PATCH', ROTAS_PORTAL.conector(c.id), { ativo: false }, cab)).status).toBe(200);
    expect((await responderFalso('POST', ROTAS_PORTAL.chaveConector(c.id), undefined, cab)).status).toBe(409);
  });
});

describe('ListaCredenciais', () => {
  it('vazia: só o texto; com itens: Identificador · Pedidos · Situação', () => {
    expect(renderToStaticMarkup(<ListaCredenciais itens={[]} vazio="Nenhum Conector." testId="x" />)).toBe('<span class="text-[13px] text-ink-2">Nenhum Conector.</span>');
    const t = texto(renderToStaticMarkup(<ListaCredenciais itens={[conector(3, 'erp-api', { tipo: 'nuvem', recebe_pedidos: false, ativo: false })]} vazio="Nenhuma credencial." testId="x" />));
    expect(t).toContain('Identificador Pedidos Situação erp-api — Desativado');
  });
});
