/**
 * "Zerar dados" (ADR 0068; RN-PLA-12): item no menu "⋯" ao lado do Excluir e o diálogo (prévia por grupo, código e senha, bloqueio,
 * andamento), renderizados com `react-dom/server` e o cache do React Query semeado com as respostas do modo falso.
 */
import { CODIGOS_ZERAR_EMPRESA as Z, ListaEmpresasSchema, PreviaZerarEmpresaSchema, mensagemDoZerar, type AcoesDaEmpresa, type PreviaZerarEmpresa, type ZerarEmpresa } from '@macuxi/platform-sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { responderFalso } from '@/lib/portal-falso';
import type { EmpresaResumo } from '@/lib/portal-empresa-acoes';

import { chavePreviaZerar, chaveZerar, DialogoZerar } from './dialogo-zerar';

type Empresa = EmpresaResumo & { acoes: AcoesDaEmpresa };
let token = '';
let lista: Empresa[] = [];
const chamar = (metodo: string, caminho: string, corpo?: unknown) =>
  responderFalso(metodo, caminho, corpo, { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' });

beforeAll(async () => {
  const guardado = new Map<string, string>();
  (globalThis as { window?: unknown }).window = {
    sessionStorage: { getItem: (k: string) => guardado.get(k) ?? null, setItem: (k: string, v: string) => void guardado.set(k, v) },
  };
  const login = (await (await responderFalso('POST', '/plataforma/auth/login', { email: 'time@macuxi.com.br', senha: 'certa-123' }, {})).json()) as { token: string };
  token = login.token;
  const r = ListaEmpresasSchema.parse(await (await chamar('GET', '/plataforma/empresas')).json());
  lista = r.itens.map((e) => ({ ...e, acoes: e.acoes as AcoesDaEmpresa }));
});

const porCodigo = (c: string) => {
  const e = lista.find((x) => x.codigo === c);
  if (!e) throw new Error(`sem ${c}`);
  return e;
};
const previaFalsa = async (e: Empresa) => PreviaZerarEmpresaSchema.parse(await (await chamar('GET', `/plataforma/empresas/${e.id}/zerar/previa`)).json());

function com(cache: { previa?: PreviaZerarEmpresa; zerar?: ZerarEmpresa; tenant: string }, filho: ReactNode): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
  if (cache.previa) qc.setQueryData(chavePreviaZerar(cache.tenant), cache.previa);
  if (cache.zerar) qc.setQueryData(chaveZerar(cache.tenant), cache.zerar);
  return renderToStaticMarkup(<QueryClientProvider client={qc}>{filho}</QueryClientProvider>);
}

describe('diálogo Zerar dados', () => {
  it('prévia por grupo (rótulos do SDK, números pt-BR), o que fica, código e senha; botão desligado até conferir', async () => {
    const e = porCodigo('AM2290');
    const previa = await previaFalsa(e);
    const html = com({ previa, tenant: e.id }, <DialogoZerar empresa={e} aoFechar={() => {}} aoTerminar={() => {}} />);
    expect(html).toContain('Zerar dados de Mercantil Rio Branco Ltda?');
    expect(html).toContain('>Apaga:</p>');
    expect(html).toMatch(/empresa-zerar\.grupo-cadastros.*<dt[^>]*>Cadastros<\/dt><dd[^>]*>7\.530<\/dd>/);
    expect(html).toMatch(/empresa-zerar\.grupo-pedidos.*>Pedidos<\/dt><dd[^>]*>2\.792</);
    expect(html).toContain('Mantém: empresa, plano, usuários, perfis, parâmetros e conectores.');
    expect(html).toContain('>Cancelar</button>');
    expect(html).toContain('<span class="font-mono font-medium">AM2290</span> para confirmar');
    expect(html).toContain('data-testid="empresa-zerar.senha.olho"');
    expect(html).toContain('data-testid="empresa-acao.confirmar" disabled=""');
    const certo = com({ previa, tenant: e.id }, <DialogoZerar empresa={e} aoFechar={() => {}} aoTerminar={() => {}} inicial={{ codigo: ' am2290 ', senha: 'x' }} />);
    expect(certo).not.toContain('disabled=""');
    expect(certo).toContain('>Zerar dados</button>');
  });
  it('bloqueio da prévia: só a frase do SDK em aviso, sem prévia, "Mantém", campos nem confirmar; botão "Fechar"', async () => {
    const e = porCodigo('AM2290');
    const previa = { ...(await previaFalsa(e)), bloqueio: Z.backupEmAndamento };
    const html = com({ previa, tenant: e.id }, <DialogoZerar empresa={e} aoFechar={() => {}} aoTerminar={() => {}} />);
    expect(html).toContain(`data-testid="empresa-zerar.bloqueio"`);
    expect(html).toContain(mensagemDoZerar(Z.backupEmAndamento) ?? '?');
    expect(html).toContain('role="alert"');
    expect(html).not.toContain('empresa-zerar.previa');
    expect(html).not.toContain('Mantém:');
    expect(html).not.toContain('empresa-zerar.codigo');
    expect(html).not.toContain('empresa-acao.confirmar');
    expect(html).toContain('>Fechar</button>');
    expect(html).not.toContain('>Cancelar</button>');
  });
  it('sem dados: uma linha e só "Fechar"; o vazio vence o bloqueio', async () => {
    const e = porCodigo('atacado-norte');
    const html = com({ previa: await previaFalsa(e), tenant: e.id }, <DialogoZerar empresa={e} aoFechar={() => {}} aoTerminar={() => {}} />);
    expect(html).toContain('Não há dados para zerar.');
    expect(html).not.toContain('empresa-zerar.previa');
    expect(html).not.toContain('empresa-acao.confirmar');
    expect(html).toContain('>Fechar</button>');
    const vazioBloqueado = com(
      { previa: { ...(await previaFalsa(e)), bloqueio: Z.backupEmAndamento }, tenant: e.id },
      <DialogoZerar empresa={e} aoFechar={() => {}} aoTerminar={() => {}} />,
    );
    expect(vazioBloqueado).toContain('Não há dados para zerar.');
    expect(vazioBloqueado).not.toContain('empresa-zerar.bloqueio');
  });
  it('senha errada: a frase no campo senha, sem bloco à parte', async () => {
    const e = porCodigo('AM2290');
    const texto = mensagemDoZerar(Z.reautenticacaoFalhou) ?? '?';
    const html = com({ previa: await previaFalsa(e), tenant: e.id }, <DialogoZerar empresa={e} aoFechar={() => {}} aoTerminar={() => {}} inicial={{ codigo: 'AM2290', erro: { texto, senha: true } }} />);
    expect(html).toMatch(/aria-invalid="true"/);
    expect(html).toContain(texto);
    expect(html).not.toContain('empresa-acao.erro');
  });
  it('andamento: título sem "?", giro e "Fechar"; concluído com as linhas apagadas; falha com a frase do worker', () => {
    const e = porCodigo('AM2290');
    const base: ZerarEmpresa = {
      id: '7c0d5e1a-2b4f-4c6d-8e9f-000000000009',
      tenant_id: e.id,
      codigo: e.codigo,
      origem: 'portal',
      situacao: 'em_andamento',
      pedido_em: '2026-11-23T12:00:00.000Z',
      concluido_em: null,
      linhas_apagadas: null,
      contagem: null,
      copia_expira_em: null,
      erro_codigo: null,
    };
    const rodando = com({ zerar: base, tenant: e.id }, <DialogoZerar empresa={e} aoFechar={() => {}} aoTerminar={() => {}} inicial={{ fase: 'andamento' }} />);
    expect(rodando).toContain('Em andamento…');
    expect(rodando).toContain('Zerar dados de Mercantil Rio Branco Ltda<');
    expect(rodando).not.toContain('Mercantil Rio Branco Ltda?');
    expect(rodando).toContain('>Fechar</button>');
    expect(rodando).not.toContain('empresa-acao.confirmar');
    const fim = { ...base, situacao: 'concluido' as const, concluido_em: '2026-11-23T12:01:00.000Z', linhas_apagadas: 19019, contagem: { 'core.cliente': 19019 }, copia_expira_em: '2026-11-30T12:01:00.000Z' };
    expect(com({ zerar: fim, tenant: e.id }, <DialogoZerar empresa={e} aoFechar={() => {}} aoTerminar={() => {}} inicial={{ fase: 'andamento' }} />)).toContain('>19.019 linhas apagadas.<');
    const falhou = { ...base, situacao: 'falhou' as const, erro_codigo: 'ZERAR_FALHOU' };
    expect(com({ zerar: falhou, tenant: e.id }, <DialogoZerar empresa={e} aoFechar={() => {}} aoTerminar={() => {}} inicial={{ fase: 'andamento' }} />)).toContain(
      'Não foi possível zerar e nada foi apagado. Avise o suporte da Macuxi.',
    );
  });
});

describe('menu "⋯": "Zerar dados" ao lado do "Excluir"', () => {
  it('o item vem antes do Excluir, os dois de perigo', async () => {
    const { useAcoesDasEmpresas } = await import('./empresas-acoes');
    let ids: string[] = [];
    function Sonda() {
      ids = useAcoesDasEmpresas(['x']).menu(porCodigo('AM2290')).map((a) => `${a.id}${a.perigo ? '!' : ''}${a.desligada ? '-' : ''}`);
      return null;
    }
    com({ tenant: 'x' }, <Sonda />);
    expect(ids.slice(-2)).toEqual(['zerar!', 'excluir!']);
    const comBackupRodando = porCodigo('comercial-boa-vista');
    function Sonda2() {
      ids = useAcoesDasEmpresas(['x']).menu(comBackupRodando).map((a) => `${a.id}${a.desligada ? '-' : ''}`);
      return null;
    }
    com({ tenant: 'x' }, <Sonda2 />);
    expect(ids).toContain('zerar-');
  });
});
