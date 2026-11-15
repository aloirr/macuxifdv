/**
 * T-0181 (spec docs/design/carga-aviso-frases/spec.md §3): Portal › Frases da carga. Regras puras da tela, a tabela renderizada
 * (react-dom/server, lista no cache do React Query) e o modo falso com as mesmas regras da API (só super-admin, sem excluir,
 * incluída nasce ativa, 90 caracteres, repetida recusada).
 */
import { FRASES_CARGA_INICIAIS, FraseCargaSchema, FrasesCargaListaSchema, SessaoPortalSchema, type FraseCarga } from '@macuxi/platform-sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { itemAtivoDoMenu, MENU_TIME_MACUXI } from '@/components/portal/base';

import {
  acaoDaSituacao,
  contadorDaFrase,
  cortarFrase,
  erroDoCampo,
  erroDoFormulario,
  situacaoDaFrase,
  TEXTOS_PORTAL_FRASES,
  tituloDoDialogoFrase,
} from '@/lib/portal-frases-carga';
import { TEXTOS_PORTAL_DIAGNOSTICOS } from '@/lib/portal-diagnosticos';
import { responderFalso, zerarModoFalso } from '@/lib/portal-falso';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';

const sessaoSim = vi.hoisted(() => ({ tipo: 'super_admin' as 'super_admin' | 'admin_cliente' }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: () => undefined, push: () => undefined }), usePathname: () => '/frases-carga' }));
vi.mock('@/components/portal/base', async (original) => {
  const real = await original<typeof import('@/components/portal/base')>();
  return {
    ...real,
    useSessaoPortal: () => ({ tipo: sessaoSim.tipo, empresa: null, empresas: [] }),
    MolduraPortal: ({ children, titulo }: { children: React.ReactNode; titulo?: React.ReactNode }) => (
      <div>
        {titulo}
        {children}
      </div>
    ),
  };
});
const { TelaFrasesCarga } = await import('@/components/portal/tela-frases-carga');

const frase = (numero: number, ativa = true, texto = `Frase ${numero}.`): FraseCarga => ({
  id: `00000000-0000-4000-8000-${String(numero).padStart(12, '0')}`,
  numero,
  texto,
  ativa,
  ordem: numero,
});

describe('regras da tela', () => {
  it('menu: "Frases da carga" depois de "Diagnósticos"; item ativo pelo caminho', () => {
    expect(MENU_TIME_MACUXI.map((i) => i.rotulo)).toEqual(['Empresas', 'Diagnósticos', 'Frases da carga']);
    expect(itemAtivoDoMenu('/frases-carga')).toBe('/frases-carga');
    expect(itemAtivoDoMenu('/config/frases-carga')).toBe('/frases-carga');
  });

  it('selo e link da situação', () => {
    expect(situacaoDaFrase(true)).toEqual({ rotulo: 'Ativa', tom: 'success' });
    expect(situacaoDaFrase(false)).toEqual({ rotulo: 'Inativa', tom: 'neutral' });
    expect(acaoDaSituacao(true)).toBe('Desativar');
    expect(acaoDaSituacao(false)).toBe('Ativar');
    expect(tituloDoDialogoFrase(null)).toBe('Incluir frase');
    expect(tituloDoDialogoFrase(9)).toBe('Editar frase 9');
  });

  it('campo para em 90 e o contador mostra "n de 90"', () => {
    const longa = 'á'.repeat(95);
    expect(Array.from(cortarFrase(longa))).toHaveLength(90);
    expect(cortarFrase('curta')).toBe('curta');
    expect(contadorDaFrase('Com 2.734,9 m, o Monte Roraima é o 7º ponto mais alto do Brasil.')).toBe('64 de 90');
    expect(contadorDaFrase('')).toBe('0 de 90');
  });

  it('contador e corte contam do mesmo jeito (o texto do campo, com os espaços das pontas): "90 de 90" quando o campo para', () => {
    const comEspacos = `  ${'a'.repeat(95)}  `;
    const cortado = cortarFrase(comEspacos);
    expect(contadorDaFrase(cortado)).toBe('90 de 90');
    expect(contadorDaFrase('  Uma frase.  ')).toBe('14 de 90');
  });

  it('erros na linha do campo: "Escreva a frase." e "Essa frase já está na lista."', () => {
    const lista = [frase(1, true, 'O lavrado é a savana de Roraima.')];
    expect(erroDoFormulario('   ', lista)).toBe('Escreva a frase.');
    expect(erroDoFormulario('o LAVRADO é a savana de Roraima. ', lista)).toBe('Essa frase já está na lista.');
    // a própria frase, na edição, não conta como repetida
    expect(erroDoFormulario('O lavrado é a savana de Roraima.', lista, lista[0]?.id)).toBeNull();
    expect(erroDoCampo('FRASE_DUPLICADA')).toBe('Essa frase já está na lista.');
    expect(erroDoCampo('FRASE_VAZIA')).toBe('Escreva a frase.');
    expect(erroDoCampo('http_500')).toBeNull();
  });
});

function renderizar(lista: FraseCarga[]): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity } } });
  qc.setQueryData(['portal', 'frases-carga'], lista);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <TelaFrasesCarga />
    </QueryClientProvider>,
  );
}
const texto = (html: string) => html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

describe('tela', () => {
  beforeEach(() => {
    sessaoSim.tipo = 'super_admin';
  });

  it('título, "Incluir frase" e a tabela Nº · Frase · Situação com "Editar" e "Desativar"/"Ativar"; sem excluir e sem "Para"', () => {
    const html = renderizar([frase(2, false), frase(1)]);
    const t = texto(html);
    expect(t).toContain('Frases da carga');
    expect(html).toContain('data-testid="frases.incluir"');
    expect(t).toMatch(/Nº Frase Situação/);
    expect(html.indexOf('frases.linha-1')).toBeLessThan(html.indexOf('frases.linha-2'));
    expect(t).toContain('1 Frase 1. Ativa Editar Desativar');
    expect(t).toContain('2 Frase 2. Inativa Editar Ativar');
    expect(t).not.toMatch(/Excluir|Para\b/);
  });

  it('links Editar, Desativar e Ativar na cor de link do kit (sem grafite por cima; MC-0087)', () => {
    const html = renderizar([frase(2, false), frase(1)]);
    const links = [...html.matchAll(/<button[^>]*>(Editar|Desativar|Ativar)<\/button>/g)].map((m) => m[0]);
    expect(links).toHaveLength(4);
    for (const l of links) {
      expect(l).toContain('text-accent-ink');
      expect(l).not.toMatch(/\btext-ink\b/);
    }
  });

  it('admin do cliente vê o mesmo texto das outras áreas do time Macuxi', () => {
    expect(TEXTOS_PORTAL_FRASES.semAcesso).toBe(TEXTOS_PORTAL_DIAGNOSTICOS.semAcesso);
    expect(TEXTOS_PORTAL_FRASES.semAcesso).toBe('Esta área é só do time Macuxi.');
  });

  it('admin do cliente: "Esta área é só do time Macuxi.", sem a lista', () => {
    sessaoSim.tipo = 'admin_cliente';
    const html = renderizar([frase(1)]);
    expect(html).toContain('frases.sem-acesso');
    expect(html).not.toContain('frases.lista');
    expect(html).not.toContain('frases.incluir');
  });
});

class Memoria {
  private m = new Map<string, string>();
  get length() {
    return this.m.size;
  }
  clear() {
    this.m.clear();
  }
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  key(i: number) {
    return [...this.m.keys()][i] ?? null;
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
}

describe('modo falso (mesmas regras da API)', () => {
  beforeEach(() => {
    vi.stubGlobal('window', { sessionStorage: new Memoria() });
    zerarModoFalso();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const entrar = async (email: string) => SessaoPortalSchema.parse(await (await responderFalso('POST', ROTAS_PORTAL.login, { email, senha: 'Senha#Forte2026' }, {})).json());
  const com = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('time da Macuxi: lista as 30, inclui (nasce ativa), recusa repetida e vazia, edita, desativa; sem DELETE', async () => {
    const s = await entrar('time@macuxi.com.br');
    const lista = FrasesCargaListaSchema.parse(await (await responderFalso('GET', ROTAS_PORTAL.frasesCarga, undefined, com(s.token))).json()).itens;
    expect(lista.map((f) => f.id)).toEqual(FRASES_CARGA_INICIAIS.map((f) => f.id));

    const id = crypto.randomUUID();
    const r = await responderFalso('POST', ROTAS_PORTAL.frasesCarga, { id, texto: '  Uma frase nova.  ' }, com(s.token));
    expect(r.status).toBe(201);
    expect(FraseCargaSchema.parse(await r.json())).toMatchObject({ id, numero: 31, texto: 'Uma frase nova.', ativa: true });

    const repetida = await responderFalso('POST', ROTAS_PORTAL.frasesCarga, { texto: 'uma FRASE nova.' }, com(s.token));
    expect([repetida.status, ((await repetida.json()) as { codigo: string }).codigo]).toEqual([422, 'FRASE_DUPLICADA']);
    const vazia = await responderFalso('POST', ROTAS_PORTAL.frasesCarga, { texto: ' ' }, com(s.token));
    expect(((await vazia.json()) as { mensagem: string }).mensagem).toBe('Escreva a frase.');

    const off = await responderFalso('PATCH', ROTAS_PORTAL.fraseCarga(id), { ativa: false }, com(s.token));
    expect(FraseCargaSchema.parse(await off.json()).ativa).toBe(false);
    const ed = await responderFalso('PATCH', ROTAS_PORTAL.fraseCarga(id), { texto: 'Outra frase.' }, com(s.token));
    expect(FraseCargaSchema.parse(await ed.json())).toMatchObject({ texto: 'Outra frase.', ativa: false });

    expect((await responderFalso('DELETE', ROTAS_PORTAL.fraseCarga(id), undefined, com(s.token))).status).toBe(404);
    const depois = FrasesCargaListaSchema.parse(await (await responderFalso('GET', ROTAS_PORTAL.frasesCarga, undefined, com(s.token))).json()).itens;
    expect(depois.at(-1)).toMatchObject({ id, ativa: false });
  });

  it('admin do cliente: 403 com a mesma mensagem da API', async () => {
    const s = await entrar('admin@uma.com.br');
    const r = await responderFalso('GET', ROTAS_PORTAL.frasesCarga, undefined, com(s.token));
    expect(r.status).toBe(403);
    expect(((await r.json()) as { mensagem: string }).mensagem).toBe('Só o time da Macuxi cuida das frases da carga.');
  });
});
