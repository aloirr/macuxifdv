/**
 * Aba "Integração" do portal (spec portal-config-enxuto §10.2), renderizada com `react-dom/server` (lista no cache do React Query) e
 * as rotas atendidas pelo modo falso (`responderFalso`):
 * - dois lados (Conector | API), passos 1 a 3, "Conectores" (conector e arquivo) e "Credenciais" (nuvem);
 * - nova chave e desativar (v1.0.21 S10, confirmação e `corpoDesativar`), "Bases" do Conector (`PATCH { entidades }`) e a credencial
 *   de API com as bases livres e os pedidos (`POST { tipo: 'nuvem', entidades, recebe_pedidos }`);
 * - o caso real: o Conector com todas as bases passa "Formas de pagamento" à credencial de API, sem pedidos.
 */
import { ConectorCriado, ENTIDADES, ORDEM_CARGA_ENTIDADES, type ConectorResumo, type Entidade } from '@macuxi/integracao/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ErroPortal, lerErroDaApi, mensagemDoErro, type OpcoesChamada } from '@/lib/portal-api';
import { responderFalso, zerarModoFalso } from '@/lib/portal-falso';
import { ENCAIXE_API_HUB, ROTAS_PORTAL } from '@/lib/portal-rotas';

import { AbaIntegracao, CartaoGuia, corpoDesativar, criarCredencial, Credencial, DialogoBases, DialogoConector, donosDasBases, entidadesLivres, gravarBases, mensagemSemBases, type Chamar } from './aba-integracao';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const AVISO = 'Copie a chave agora: ela não aparece de novo.';
const SEM_FORMA = ORDEM_CARGA_ENTIDADES.filter((e) => e !== 'forma_pagamento');

const conector = (n: number, conector_id: string, x: Partial<ConectorResumo> = {}): ConectorResumo => ({
  id: `7c1d2e3f-4a5b-4c6d-8e9f-0000000000${String(n).padStart(2, '0')}`,
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

function renderizar(no: ReactNode, lista?: ConectorResumo[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  if (lista) qc.setQueryData(['portal', TENANT, 'conectores'], lista);
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{no}</QueryClientProvider>);
}
const aba = (lista: ConectorResumo[]) => renderizar(<AbaIntegracao tenant={TENANT} />, lista);
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

class Memoria {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

/** Modo falso com o registro de cada chamada (caminho, método e corpo), pelo mesmo `Chamar` que a tela usa. */
async function portalFalso() {
  const login = (await (await responderFalso('POST', ROTAS_PORTAL.login, { email: 'admin@uma.com.br', senha: 'certa-123' }, {})).json()) as { token: string };
  const cab = { Authorization: `Bearer ${login.token}`, 'Content-Type': 'application/json', 'x-macuxi-tenant': TENANT };
  const pedidos: { caminho: string; metodo: string; corpo: unknown }[] = [];
  const chamar = (async (caminho: string, o: OpcoesChamada<unknown>) => {
    const metodo = o.metodo ?? 'GET';
    pedidos.push({ caminho, metodo, corpo: o.corpo });
    const r = await responderFalso(metodo, caminho, o.corpo, cab);
    const corpo: unknown = await r.json();
    if (!r.ok) throw lerErroDaApi(r.status, corpo);
    const p = o.schema?.safeParse(corpo);
    if (p && !p.success) throw new Error('formato inesperado');
    return p ? p.data : corpo;
  }) as Chamar;
  const listar = async () => ((await (await responderFalso('GET', ROTAS_PORTAL.conectores, undefined, cab)).json()) as { itens: ConectorResumo[] }).itens;
  return { chamar, pedidos, listar, cab };
}

beforeEach(() => {
  vi.stubGlobal('window', { sessionStorage: new Memoria() });
  zerarModoFalso();
});
afterEach(() => vi.unstubAllGlobals());

describe('aba Integração em dois lados', () => {
  const lista = [conector(1, 'erp'), conector(2, 'implantacao-csv', { tipo: 'arquivo', recebe_pedidos: false, entidades: [] }), conector(3, 'erp-api', { tipo: 'nuvem', recebe_pedidos: false, entidades: [] }), conector(4, 'velho', { ativo: false })];
  const html = aba(lista);
  const t = texto(html);

  it('2 colunas ≥ 768 px com a divisória de 1 px; abaixo, Conector primeiro e a divisória antes da API', () => {
    expect(html).toContain('data-testid="integracao.aba" class="grid md:grid-cols-2"');
    expect(html).toMatch(/aria-labelledby="integracao-conector" class="[^"]*border-b border-line pb-6 md:border-r md:border-b-0 md:pr-6 md:pb-0/);
    expect(html).toMatch(/aria-labelledby="integracao-api" class="[^"]*pt-6 md:pt-0 md:pl-6/);
    expect(t.indexOf('Integração via Conector')).toBeLessThan(t.indexOf('Integração via API'));
  });

  it('Conector: passos 1 a 3 na ordem, botão principal no passo 2 e "Conectores" com o do ERP e o de arquivo', () => {
    const ordem = ['1 Baixar o Conector', '2 Gerar a credencial', '3 Instalar e colar a credencial', 'Conectores'].map((x) => t.indexOf(x));
    expect(ordem.every((i) => i >= 0)).toBe(true);
    expect([...ordem].sort((a, b) => a - b)).toEqual(ordem);
    expect(t).toContain('Instale o Conector no servidor do ERP. Cole o identificador e a chave na configuração. Inicie o serviço.');
    expect(html).toMatch(/class="[^"]*bg-accent text-white[^"]*" data-testid="integracao\.gerar"/);
    const conectores = html.slice(html.indexOf('data-testid="integracao.conectores"'), html.indexOf('integracao-api"'));
    expect(conectores).toContain('>erp<');
    expect(conectores).toContain('>implantacao-csv<');
    expect(conectores).not.toContain('erp-api');
  });

  it('API: bases livres marcadas, "Envia os pedidos" desmarcada, botão neutro, Guia só com o OpenAPI e "Credenciais" com as de tipo nuvem', () => {
    expect(ENCAIXE_API_HUB).toEqual({ guiaPdf: null });
    expect(html).toMatch(/data-testid="integracao\.api-recebe-pedidos"(?![^>]*checked)/);
    expect(html).toMatch(/data-testid="integracao\.recebe-pedidos"[^>]*checked/);
    expect(html).not.toMatch(/bg-accent text-white[^"]*" data-testid="integracao\.api-gerar"/);
    expect(html).toContain('data-testid="integracao.openapi"');
    expect(html).not.toContain('Baixar o guia (PDF)');
    const credenciais = html.slice(html.indexOf('data-testid="integracao.api-credenciais"'));
    expect(credenciais).toContain('>erp-api<');
    expect(credenciais).not.toMatch(/>erp<|velho|implantacao-csv/);
  });

  it('linha ativa: Bases só no Conector do ERP; nova chave fora do de arquivo; desativada sem botões', () => {
    expect(html).toContain('data-testid="integracao.bases-erp"');
    expect(html).not.toContain('data-testid="integracao.bases-erp-api"');
    expect(html).not.toContain('data-testid="integracao.bases-implantacao-csv"');
    expect(html).toContain('data-testid="integracao.nova-chave-erp"');
    expect(html).toContain('data-testid="integracao.nova-chave-erp-api"');
    expect(html).not.toContain('data-testid="integracao.nova-chave-implantacao-csv"');
    expect(html).toContain('data-testid="integracao.desativar-implantacao-csv"');
    expect(html).not.toMatch(/integracao\.(bases|nova-chave|desativar)-velho/);
    expect(html).not.toContain('data-testid="integracao.chave"');
  });

  it('sem a aba Bases e sem o diálogo de passar as bases', () => {
    for (const velho of ['integracao.confirmar', 'Passar as bases', 'chega em breve', 'Gera a chave', 'Vai no arquivo de configuração', 'Carga por arquivo']) expect(html, velho).not.toContain(velho);
  });

  it('Guia: o botão do PDF só quando ele existir', () => {
    expect(renderToStaticMarkup(<CartaoGuia guiaPdf="/guia.pdf" />)).toContain('Baixar o guia (PDF)');
    expect(renderToStaticMarkup(<CartaoGuia guiaPdf={null} />)).not.toContain('Baixar o guia (PDF)');
  });
});

describe('nova chave e desativar (S10)', () => {
  it('gerar nova chave pede confirmação antes', () => {
    const html = renderToStaticMarkup(<DialogoConector alvo={conector(1, 'erp')} acao="chave" enviando={false} aoFechar={() => {}} aoConfirmar={() => {}} />);
    expect(html).toContain('Gerar nova chave para o Conector erp?');
    expect(html).toContain('data-testid="integracao.acao-cancelar"');
    expect(html).toMatch(/data-testid="integracao.acao-confirmar-chave"[^>]*>Gerar nova chave</);
    expect(renderToStaticMarkup(<DialogoConector alvo={null} acao="chave" enviando={false} aoFechar={() => {}} aoConfirmar={() => {}} />)).toBe('');
  });

  it('a chave nova (POST .../chave) aparece uma vez, com Copiar e o aviso; desativado, a nova chave é recusada', async () => {
    const f = await portalFalso();
    const criado = await criarCredencial(TENANT, { conector_id: 'erp-teste', nome: 'ERP', tipo: 'conector', recebe_pedidos: true, entidades: ['produto'] }, f.chamar);
    const r = await responderFalso('POST', ROTAS_PORTAL.chaveConector(criado.conector.id), {}, f.cab);
    expect(r.status).toBe(201);
    const nova = ConectorCriado.shape.chave.parse(await r.json());
    expect(nova.chave).not.toBe(criado.chave.chave);
    const html = renderToStaticMarkup(<Credencial c={nova} aoFechar={() => {}} />);
    expect(html.split(nova.chave)).toHaveLength(2);
    expect(html).toMatch(/data-testid="integracao.copiar"[^>]*>Copiar</);
    expect(html).not.toMatch(/bg-accent text-white[^"]*" data-testid="integracao\.copiar"/);
    expect(html).toContain(AVISO);
    expect(html).not.toContain('Credencial do Conector');
    expect(html).not.toContain('escopo');
    expect(html).not.toContain('prefixo');
    expect(aba([criado.conector])).not.toContain(nova.chave);
    expect((await responderFalso('PATCH', ROTAS_PORTAL.conector(criado.conector.id), { ativo: false }, f.cab)).status).toBe(200);
    expect((await responderFalso('POST', ROTAS_PORTAL.chaveConector(criado.conector.id), {}, f.cab)).status).toBe(409);
  });

  it('desativar pede confirmação, com o texto pelo tipo: bases e pedidos, só as bases, ou a carga por CSV', () => {
    const html = renderToStaticMarkup(<DialogoConector alvo={conector(1, 'erp')} acao="desativar" enviando={false} aoFechar={() => {}} aoConfirmar={() => {}} />);
    expect(html).toContain('Desativar o Conector erp?');
    expect(html).toMatch(/data-testid="integracao.acao-confirmar-desativar"[^>]*>Desativar</);
    expect(html).toContain('Ele para de enviar as bases e de buscar os pedidos.');
    expect(corpoDesativar({ tipo: 'conector', recebe_pedidos: false })).toBe('Ele para de enviar as bases.');
    expect(corpoDesativar({ tipo: 'arquivo', recebe_pedidos: false })).toBe('A carga por CSV deixa de funcionar nesta empresa.');
  });

  it('sem bases livres: a mensagem só com a ação que libera ("Bases" ou desativar; o de arquivo, desativar)', () => {
    const lista = [conector(1, 'erp')];
    const mensagem = 'Todas as bases já vêm de outro Conector ativo. Tire bases dele em "Bases" ou desative-o.';
    expect(mensagemSemBases(false)).toBe(mensagem);
    expect(mensagemSemBases(true)).toBe('Todas as bases já vêm de outro Conector ativo. Desative o Conector de arquivo.');
    const html = aba(lista);
    expect(html).toContain('data-testid="integracao.api-sem-bases"');
    expect(texto(html)).toContain(mensagem.replace(/"/g, '&quot;'));
    expect(html).toMatch(/data-testid="integracao\.api-gerar"[^>]*disabled/);
  });
});

describe('Bases do Conector', () => {
  it('as dele marcadas; as de outro Conector ativo desabilitadas, com o identificador dele; os 16 rótulos sem lista própria', () => {
    const erp = conector(1, 'erp', { entidades: SEM_FORMA });
    const api = conector(2, 'erp-api', { tipo: 'nuvem', recebe_pedidos: false, entidades: ['forma_pagamento'] });
    expect(donosDasBases([erp, api, conector(3, 'velho', { ativo: false })], 'erp')).toEqual({ forma_pagamento: 'erp-api' });
    const html = renderToStaticMarkup(<DialogoBases alvo={erp} todos={[erp, api]} tenant={TENANT} aoFechar={() => {}} aoGravar={() => {}} />);
    expect(html).toContain('Bases do Conector erp');
    for (const e of SEM_FORMA) expect(html).toMatch(new RegExp(`data-testid="integracao\\.bases\\.${e}"[^>]*checked`));
    expect(html).toMatch(/data-testid="integracao\.bases\.forma_pagamento"[^>]*disabled/);
    expect(texto(html)).toContain('Formas de pagamento · erp-api');
    expect(html.match(/type="checkbox"/g)).toHaveLength(ENTIDADES.length);
    expect(html).not.toMatch(/data-testid="integracao\.bases-gravar"[^>]*disabled/);
  });

  it('sem nenhuma base marcada, "Gravar" fica desabilitado', () => {
    const so = conector(1, 'erp', { entidades: ['forma_pagamento'] });
    const outro = conector(2, 'erp-api', { tipo: 'nuvem', entidades: ['forma_pagamento'] });
    const html = renderToStaticMarkup(<DialogoBases alvo={so} todos={[so, outro]} tenant={TENANT} aoFechar={() => {}} aoGravar={() => {}} />);
    expect(html).toMatch(/data-testid="integracao\.bases-gravar"[^>]*disabled/);
  });

  it('409 topologia_conflitante: a tela mostra a mensagem da API', async () => {
    const f = await portalFalso();
    const a = await criarCredencial(TENANT, { conector_id: 'a', nome: 'A', tipo: 'conector', recebe_pedidos: true, entidades: ['produto'] }, f.chamar);
    await criarCredencial(TENANT, { conector_id: 'b', nome: 'B', tipo: 'nuvem', recebe_pedidos: false, entidades: ['cliente'] }, f.chamar);
    const erro = await gravarBases(TENANT, a.conector.id, ['produto', 'cliente'], f.chamar).catch((x: unknown) => x);
    expect(erro).toBeInstanceOf(ErroPortal);
    expect((erro as ErroPortal).codigo).toBe('topologia_conflitante');
    expect(mensagemDoErro(erro)).toBe('A base cliente já vem do Conector b.');
  });
});

describe('caso real: o ERP passa "Formas de pagamento" do Conector à API', () => {
  it('Conector > Bases > desmarca Formas de pagamento > Gravar; API > Gerar a credencial só com ela e sem pedidos', async () => {
    const f = await portalFalso();
    // começo: o Conector com todas as bases e os pedidos (o passo 2 do lado do Conector)
    const erp = await criarCredencial(TENANT, { conector_id: 'erp', nome: 'Conector do ERP', tipo: 'conector', recebe_pedidos: true, entidades: entidadesLivres([]) }, f.chamar);
    expect(erp.conector.entidades).toHaveLength(ENTIDADES.length);
    let lista = await f.listar();
    expect(aba(lista)).toContain('data-testid="integracao.api-sem-bases"');

    // Bases do Conector: desmarca "Formas de pagamento" e grava
    await gravarBases(TENANT, erp.conector.id, SEM_FORMA, f.chamar);
    lista = await f.listar();
    expect(entidadesLivres(lista)).toEqual<Entidade[]>(['forma_pagamento']);

    // lado da API: só "Formas de pagamento", marcada; pedidos desmarcados
    const html = aba(lista);
    expect(html.match(/data-testid="integracao\.api-bases\.[a-z_]+"/g)).toEqual(['data-testid="integracao.api-bases.forma_pagamento"']);
    expect(html).toMatch(/data-testid="integracao\.api-bases\.forma_pagamento"[^>]*checked/);
    expect(html).toMatch(/data-testid="integracao\.api-recebe-pedidos"(?![^>]*checked)/);
    const api = await criarCredencial(TENANT, { conector_id: 'erp-api', nome: 'ERP pela API', tipo: 'nuvem', recebe_pedidos: false, entidades: entidadesLivres(lista) }, f.chamar);
    expect(api.chave.chave).toMatch(/^mx_falso_/);

    // os corpos das duas chamadas
    expect(f.pedidos.slice(1)).toEqual([
      { caminho: `/integracao/conectores/${erp.conector.id}`, metodo: 'PATCH', corpo: { entidades: SEM_FORMA } },
      { caminho: '/integracao/conectores', metodo: 'POST', corpo: { conector_id: 'erp-api', nome: 'ERP pela API', tipo: 'nuvem', recebe_pedidos: false, entidades: ['forma_pagamento'] } },
    ]);

    // as listas no final
    lista = await f.listar();
    expect(lista.map((c) => [c.conector_id, c.tipo, c.recebe_pedidos, c.entidades])).toEqual([
      ['erp', 'conector', true, SEM_FORMA],
      ['erp-api', 'nuvem', false, ['forma_pagamento']],
    ]);
    const fim = aba(lista);
    expect(fim.slice(fim.indexOf('data-testid="integracao.conectores"'), fim.indexOf('integracao-api"'))).toContain('>erp<');
    expect(fim.slice(fim.indexOf('data-testid="integracao.api-credenciais"'))).toContain('>erp-api<');
    expect(texto(fim)).toMatch(/erp-api — Ativo/);
    expect(fim).toContain('data-testid="integracao.api-sem-bases"');
  });
});
