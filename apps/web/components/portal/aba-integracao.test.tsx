/**
 * Aba "Integração automática" do portal: nova chave e desativação de um Conector da lista, renderizadas com `react-dom/server`
 * (lista no cache do React Query) e as rotas atendidas pelo modo falso (`responderFalso`).
 */
import { ConectorCriado, ENTIDADES, type ConectorResumo } from '@macuxi/integracao/contracts';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { responderFalso } from '@/lib/portal-falso';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

import { AbaIntegracao, basesDoDialogo, corpoDaCredencial, Credencial, DialogoBases, DialogoConector, DialogoReativar, entidadesLivres, mensagemSemBases, outroRecebePedidos, reativarConector, rotaChaveDoConector, rotaDoConector } from './aba-integracao';
import { ErroPortal, type chamarPortal } from '@/lib/portal-api';

const TENANT = '0b6f1a52-5c1e-4c4e-9a43-000000000001';
const AVISO = 'Copie a chave agora: ela não aparece de novo.';
let token = '';
const chamar = (metodo: string, caminho: string, corpo?: unknown) =>
  responderFalso(metodo, caminho, corpo, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', 'x-macuxi-tenant': TENANT });

const conector = (x: Partial<ConectorResumo>): ConectorResumo =>
  ({ id: '7c1d2e3f-4a5b-4c6d-8e9f-000000000001', conector_id: 'thathyany-conector', nome: 'Conector', tipo: 'conector', recebe_pedidos: true, entidades: [...ENTIDADES], ativo: true, ...x }) as ConectorResumo;

function renderizar(lista: ConectorResumo[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['portal', TENANT, 'conectores'], lista);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <AbaIntegracao tenant={TENANT} />
    </QueryClientProvider>,
  );
}

beforeAll(async () => {
  const guardado = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    sessionStorage: { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) },
  };
  const login = (await (await responderFalso('POST', '/plataforma/auth/login', { email: 'admin@uma.com.br', senha: 'certa-123' }, {})).json()) as { token: string };
  token = login.token;
});

describe('aba Integração: nova chave e desativar', () => {
  it('cada Conector ativo tem "Gerar nova chave" e "Desativar"; o de arquivo e os desativados não ganham nova chave', () => {
    const html = renderizar([conector({}), conector({ id: '7c1d2e3f-4a5b-4c6d-8e9f-000000000002', conector_id: 'portal-arquivo', tipo: 'arquivo', entidades: [] }), conector({ id: '7c1d2e3f-4a5b-4c6d-8e9f-000000000003', conector_id: 'velho', ativo: false })]);
    expect(html).toContain('data-testid="integracao.nova-chave-thathyany-conector"');
    expect(html).toContain('data-testid="integracao.desativar-thathyany-conector"');
    expect(html).not.toContain('data-testid="integracao.nova-chave-portal-arquivo"');
    expect(html).toContain('data-testid="integracao.desativar-portal-arquivo"');
    expect(html).not.toContain('integracao.nova-chave-velho');
    expect(html).not.toContain('integracao.desativar-velho');
    expect(html).not.toContain('data-testid="integracao.chave"');
  });

  it('gerar nova chave pede confirmação antes', () => {
    const html = renderToStaticMarkup(<DialogoConector alvo={conector({})} acao="chave" enviando={false} aoFechar={() => {}} aoConfirmar={() => {}} />);
    expect(html).toContain('Gerar nova chave para o Conector thathyany-conector?');
    expect(html).toContain('data-testid="integracao.acao-cancelar"');
    expect(html).toMatch(/data-testid="integracao.acao-confirmar-chave"[^>]*>Gerar nova chave</);
    expect(renderToStaticMarkup(<DialogoConector alvo={null} acao="chave" enviando={false} aoFechar={() => {}} aoConfirmar={() => {}} />)).toBe('');
  });

  it('a chave nova (POST .../chave com corpo vazio) aparece uma vez, com Copiar e o aviso; fechada, a aba não a mostra', async () => {
    const criado = ConectorCriado.parse(await (await chamar('POST', ROTAS_PORTAL.conectores, { conector_id: 'erp-teste', nome: 'ERP', tipo: 'conector', recebe_pedidos: true, entidades: ['produto'] })).json());
    const r = await chamar('POST', rotaChaveDoConector(criado.conector.id), {});
    expect(r.status).toBe(201);
    const nova = ConectorCriado.shape.chave.parse(await r.json());
    expect(nova.chave).not.toBe(criado.chave.chave);
    const html = renderToStaticMarkup(<Credencial c={nova} aoFechar={() => {}} />);
    expect(html.split(nova.chave)).toHaveLength(2);
    expect(html).toMatch(/data-testid="integracao.copiar"[^>]*>Copiar</);
    expect(html).toContain(AVISO);
    expect(html).toContain('data-testid="integracao.ja-copiei"');
    expect(renderizar([criado.conector])).not.toContain(nova.chave);
  });

  it('desativar pede confirmação e usa o PATCH { ativo: false }', async () => {
    const html = renderToStaticMarkup(<DialogoConector alvo={conector({})} acao="desativar" enviando={false} aoFechar={() => {}} aoConfirmar={() => {}} />);
    expect(html).toContain('Desativar o Conector thathyany-conector?');
    expect(html).toMatch(/data-testid="integracao.acao-confirmar-desativar"[^>]*>Desativar</);
    const criado = ConectorCriado.parse(await (await chamar('POST', ROTAS_PORTAL.conectores, { conector_id: 'erp-desativar', nome: 'ERP', tipo: 'conector', recebe_pedidos: false, entidades: ['cliente'] })).json());
    const r = await chamar('PATCH', rotaDoConector(criado.conector.id), { ativo: false });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ativo: boolean }).ativo).toBe(false);
  });

  it('sem bases livres: a mensagem cita o Conector quando não há Conector de arquivo, e mantém a original quando há', () => {
    const lista = [conector({})];
    expect(mensagemSemBases(lista, false)).toBe('Todas as bases já vêm do Conector thathyany-conector. Gere uma nova chave para ele ou desative-o.');
    expect(mensagemSemBases(lista, true)).toBe('Todas as bases já vêm de outro Conector ativo. Desative o Conector de arquivo para passar as bases ao ERP.');
  });

  it('Bases: botão nos Conectores ativos não de arquivo; o diálogo marca as do Conector e bloqueia as de outro Conector ativo', () => {
    const thathyany = conector({});
    const outro = conector({ id: '7c1d2e3f-4a5b-4c6d-8e9f-000000000004', conector_id: 'erp-nuvem', tipo: 'nuvem', entidades: ['forma_pagamento'] });
    const html = renderizar([thathyany, conector({ id: '7c1d2e3f-4a5b-4c6d-8e9f-000000000002', conector_id: 'portal-arquivo', tipo: 'arquivo', entidades: [] })]);
    expect(html).toMatch(/data-testid="integracao.bases-thathyany-conector"[^>]*>Bases</);
    expect(html).not.toContain('integracao.bases-portal-arquivo');
    const bases = basesDoDialogo([thathyany, outro], { ...thathyany, entidades: ENTIDADES.filter((e) => e !== 'forma_pagamento') });
    expect(bases.find((b) => b.entidade === 'forma_pagamento')).toEqual({ entidade: 'forma_pagamento', marcada: false, bloqueada: true });
    expect(bases.filter((b) => b.bloqueada)).toHaveLength(1);
    const dialogo = renderToStaticMarkup(<DialogoBases alvo={thathyany} conectores={[thathyany]} enviando={false} erro={null} aoFechar={() => {}} aoGravar={() => {}} />);
    expect(dialogo).toContain('Bases do Conector thathyany-conector');
    expect(dialogo).toMatch(/data-testid="integracao.bases-gravar"[^>]*>Gravar</);
    expect(dialogo).toMatch(/<input type="checkbox" data-testid="integracao.dialogo-recebe-pedidos"[^>]*checked=""[^>]*\/>Recebe pedidos/);
    const semPedidos = renderToStaticMarkup(<DialogoBases alvo={{ ...outro, recebe_pedidos: false }} conectores={[thathyany, outro]} enviando={false} erro={null} aoFechar={() => {}} aoGravar={() => {}} />);
    expect(semPedidos).toMatch(/data-testid="integracao.dialogo-recebe-pedidos"[^>]*disabled=""/);
  });

  describe('Reativar', () => {
    // caso da thathyany: macuxierp (nuvem) fica só com forma_pagamento e sem pedidos; o kit desativado volta com as outras bases
    const erp = conector({ id: '7c1d2e3f-4a5b-4c6d-8e9f-000000000005', conector_id: 'macuxierp', tipo: 'nuvem', recebe_pedidos: false, entidades: ['forma_pagamento'] });
    const kit = conector({ ativo: false, recebe_pedidos: true });

    it('botão "Reativar" só nos Conectores desativados que não são de arquivo', () => {
      const html = renderizar([erp, kit, conector({ id: '7c1d2e3f-4a5b-4c6d-8e9f-000000000002', conector_id: 'portal-arquivo', tipo: 'arquivo', ativo: false, entidades: [] })]);
      expect(html).toMatch(/data-testid="integracao.reativar-thathyany-conector"[^>]*>Reativar</);
      expect(html).not.toContain('integracao.reativar-macuxierp');
      expect(html).not.toContain('integracao.reativar-portal-arquivo');
    });

    it('livres ignoram os Conectores inativos; outro ativo com pedidos bloqueia a caixa', () => {
      expect(entidadesLivres([erp, kit], kit.conector_id)).toEqual(ENTIDADES.filter((e) => e !== 'forma_pagamento'));
      expect(outroRecebePedidos([erp, kit], kit.conector_id)).toBe(false);
      expect(outroRecebePedidos([{ ...erp, recebe_pedidos: true }, kit], kit.conector_id)).toBe(true);
      expect(outroRecebePedidos([{ ...erp, recebe_pedidos: true, ativo: false }, kit], kit.conector_id)).toBe(false);
    });

    it('diálogo: bases livres marcadas, "Recebe pedidos" conforme o Conector; bloqueada quando outro ativo recebe', () => {
      const html = renderToStaticMarkup(<DialogoReativar alvo={kit} conectores={[erp, kit]} enviando={false} erro={null} aoFechar={() => {}} aoReativar={() => {}} />);
      expect(html).toContain('Reativar o Conector thathyany-conector?');
      expect(html).not.toContain('integracao.reativar-base-forma_pagamento');
      expect(html.match(/data-testid="integracao.reativar-base-[a-z_]+"[^>]*checked=""/g)).toHaveLength(ENTIDADES.length - 1);
      expect(html).toMatch(/data-testid="integracao.dialogo-recebe-pedidos"[^>]*checked=""/);
      expect(html).toMatch(/data-testid="integracao.reativar-confirmar"[^>]*>Reativar</);
      const bloqueado = renderToStaticMarkup(<DialogoReativar alvo={kit} conectores={[{ ...erp, recebe_pedidos: true }, kit]} enviando={false} erro="Conflito" aoFechar={() => {}} aoReativar={() => {}} />);
      expect(bloqueado).toMatch(/data-testid="integracao.dialogo-recebe-pedidos"[^>]*disabled=""/);
      expect(bloqueado).not.toMatch(/data-testid="integracao.dialogo-recebe-pedidos"[^>]*checked=""/);
      expect(bloqueado).toContain('data-testid="integracao.reativar-erro"');
      const semLivres = renderToStaticMarkup(<DialogoReativar alvo={kit} conectores={[conector({ ...erp, entidades: [...ENTIDADES] }), kit]} enviando={false} erro={null} aoFechar={() => {}} aoReativar={() => {}} />);
      expect(semLivres).toMatch(/data-testid="integracao.reativar-confirmar"[^>]*disabled=""/);
    });

    it('fluxo: PATCH { ativo: true, entidades, recebe_pedidos } e depois POST da chave; 409 não gera chave', async () => {
      const chamadas: [string, unknown][] = [];
      const nova = { conector_id: kit.conector_id, escopo: 'integracao.v1', chave: 'mx_nova', prefixo: 'mx_nova', criada_em: '2026-11-22T12:00:00.000Z', anterior_valida_ate: null };
      const ok = (async (caminho: string, o?: { metodo?: string; corpo?: unknown }) => {
        chamadas.push([`${o?.metodo} ${caminho}`, o?.corpo]);
        return caminho.endsWith('/chave') ? nova : {};
      }) as typeof chamarPortal;
      const corpo = { entidades: ['produto' as const], recebe_pedidos: true };
      expect(await reativarConector(kit.id, corpo, TENANT, ok)).toBe(nova);
      expect(chamadas).toEqual([
        [`PATCH ${rotaDoConector(kit.id)}`, { ativo: true, entidades: ['produto'], recebe_pedidos: true }],
        [`POST ${rotaChaveDoConector(kit.id)}`, {}],
      ]);
      chamadas.length = 0;
      const conflito = (async (caminho: string, o?: { metodo?: string }) => {
        chamadas.push([`${o?.metodo} ${caminho}`, undefined]);
        throw new ErroPortal(409, 'topologia_conflitante', 'Outro Conector ativo já recebe os pedidos.');
      }) as typeof chamarPortal;
      await expect(reativarConector(kit.id, corpo, TENANT, conflito)).rejects.toThrow('Outro Conector ativo já recebe os pedidos.');
      expect(chamadas).toHaveLength(1);
    });
  });

  it('credencial: Tipo e bases no corpo; sem base marcada não envia', () => {
    expect(corpoDaCredencial({ identificador: ' erp-fp ', nome: 'ERP ', tipo: 'nuvem', recebePedidos: false, entidades: ['forma_pagamento'] })).toEqual({ conector_id: 'erp-fp', nome: 'ERP', tipo: 'nuvem', recebe_pedidos: false, entidades: ['forma_pagamento'] });
    expect(corpoDaCredencial({ identificador: 'erp', nome: 'ERP', tipo: 'conector', recebePedidos: true, entidades: [] })).toBeNull();
    const html = renderizar([]);
    expect(html).toContain('data-testid="integracao.tipo"');
    expect(html).toContain('Integração em nuvem');
    expect(html).toContain('data-testid="integracao.nova-base-forma_pagamento"');
  });
});
