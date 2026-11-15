/**
 * ADR 0052 (spec portal-config-enxuto §15): lista de Empresas com a coluna Backup e o menu "⋯", e os diálogos de Inativar e
 * Excluir, renderizados com `react-dom/server` (lista já no cache do React Query). As listas e o corpo dos diálogos vêm do modo
 * falso (`responderFalso`), nos estados da simulação `depois-02b`, para o teste e a tela lerem os mesmos dados.
 */
import { CODIGOS_ACOES_EMPRESA as C, ListaEmpresasSchema, type AcoesDaEmpresa } from '@macuxi/platform-sdk';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderToStaticMarkup } from 'react-dom/server';
import { beforeAll, describe, expect, it } from 'vitest';

import { responderFalso } from '@/lib/portal-falso';
import type { EmpresaResumo } from '@/lib/portal-empresa-acoes';

import { DialogoExcluir, DialogoInativar } from './empresas-acoes';
import { CHAVE_EMPRESAS, ListaEmpresas } from './tela-empresas';

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

function renderizarLista(): string {
  const qc = new QueryClient({ defaultOptions: { queries: { retry: false, staleTime: Infinity, refetchInterval: false } } });
  qc.setQueryData(CHAVE_EMPRESAS, lista);
  return renderToStaticMarkup(
    <QueryClientProvider client={qc}>
      <ListaEmpresas />
    </QueryClientProvider>,
  );
}

const linha = (html: string, codigo: string) => {
  const i = html.indexOf(`data-testid="empresas.linha-${codigo}"`);
  if (i < 0) throw new Error(`sem a linha ${codigo}`);
  return html.slice(i, html.indexOf('</tr>', i));
};

describe('modo falso: estados da simulação depois-02b (a liberação vem da `conferirExclusao` do SDK)', () => {
  it.each([
    ['distribuidora-uma', 'ativo', C.exclusaoEmpresaAtiva],
    ['atacado-norte', 'ativo', C.exclusaoEmpresaAtiva],
    ['comercial-boa-vista', 'suspenso', C.exclusaoSemBackup],
    ['RR4410', 'suspenso', C.exclusaoBackupAntesDaInativacao],
    ['AM5173', 'suspenso', C.exclusaoBackupVencido],
    ['AM2290', 'suspenso', null],
  ])('%s', (codigo, status, bloqueio) => {
    const e = porCodigo(codigo);
    expect([e.status, e.acoes.exclusao_bloqueada]).toEqual([status, bloqueio]);
  });
  it('Excluir: senha errada 403, código errado 422; com tudo certo, 202 e a empresa sai da lista quando termina', async () => {
    const e = porCodigo('AM2290');
    const corpo = { id: crypto.randomUUID(), backup_id: e.acoes.ultimo_backup?.id, codigo_confirmacao: 'am2290 ', senha: 'errada' };
    expect((await (await chamar('POST', `/plataforma/empresas/${e.id}/exclusao`, corpo)).json()).codigo).toBe(C.reautenticacaoFalhou);
    expect((await (await chamar('POST', `/plataforma/empresas/${e.id}/exclusao`, { ...corpo, senha: 'boa', codigo_confirmacao: 'AM2291' })).json()).codigo).toBe(C.exclusaoCodigoNaoConfere);
    const ok = await chamar('POST', `/plataforma/empresas/${e.id}/exclusao`, { ...corpo, senha: 'boa' });
    expect(ok.status).toBe(202);
    const r = await chamar('POST', `/plataforma/empresas/${porCodigo('RR4410').id}/exclusao`, { ...corpo, backup_id: porCodigo('RR4410').acoes.ultimo_backup?.id, codigo_confirmacao: 'RR4410', senha: 'boa' });
    expect([r.status, ((await r.json()) as { codigo: string }).codigo]).toEqual([422, C.exclusaoBackupAntesDaInativacao]);
  });
});

describe('lista de Empresas com as ações (§15.1)', () => {
  it('coluna Backup e a das ações (sem título visível, `aria-label` "Ações")', () => {
    const html = renderizarLista();
    expect(html).toContain('>Backup</th>');
    expect(html).toContain('aria-label="Ações"');
  });
  it.each([
    ['distribuidora-uma', 'Ativa', null, 'Inative para excluir'],
    ['atacado-norte', 'Ativa', 'Nenhum', 'Inative para excluir'],
    ['comercial-boa-vista', 'Inativa', 'Em andamento', null],
    ['RR4410', 'Inativa', null, 'Anterior à inativação'],
    ['AM5173', 'Inativa', null, 'Vencido (mais de 7 dias)'],
    ['AM2290', 'Inativa', null, null],
  ])('%s: selo, backup e motivo', (codigo, selo, texto, motivo) => {
    const l = linha(renderizarLista(), codigo);
    expect(l).toContain(`>${selo}</span>`);
    if (texto) expect(l).toContain(texto);
    else expect(l).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    if (motivo) expect(l).toContain(`data-testid="empresas.backup-motivo-${codigo}"`);
    if (motivo) expect(l).toContain(motivo);
    else expect(l).not.toContain('empresas.backup-motivo-');
    expect(l).toContain(`data-testid="empresas.acoes-${codigo}"`);
  });
});

describe('diálogos (§15.2)', () => {
  it('Inativar: título com o nome, uma linha de corpo, "Cancelar" e "Inativar"', () => {
    const html = renderToStaticMarkup(<DialogoInativar empresa={porCodigo('distribuidora-uma')} aoFechar={() => {}} aoInativar={() => {}} />);
    expect(html).toContain('Inativar Distribuidora Uma Ltda?');
    expect(html).toContain('Todos os acessos ficam bloqueados.');
    expect(html).toContain('data-testid="empresa-acao.cancelar"');
    expect(html).toMatch(/data-testid="empresa-acao.confirmar"[^>]*>Inativar</);
  });
  it('Excluir: backup usado, sem volta, código e senha; botão desabilitado até o código conferir e a senha existir', () => {
    const e = porCodigo('AM2290');
    const vazio = renderToStaticMarkup(<DialogoExcluir empresa={e} aoFechar={() => {}} aoPedir={() => {}} />);
    expect(vazio).toContain('Excluir Mercantil Rio Branco Ltda?');
    expect(vazio).toContain('Backup usado:');
    expect(vazio).toContain('Não dá para desfazer.');
    expect(vazio).toContain('<span class="font-mono font-medium">AM2290</span> para confirmar');
    expect(vazio).toContain('type="password"');
    expect(vazio).toContain('autoComplete="current-password"');
    expect(vazio).toContain('data-testid="empresa-acao.confirmar" disabled=""');
    const errado = renderToStaticMarkup(<DialogoExcluir empresa={e} aoFechar={() => {}} aoPedir={() => {}} inicial={{ codigo: 'AM229', senha: 'x' }} />);
    expect(errado).toContain('data-testid="empresa-acao.confirmar" disabled=""');
    expect(errado).not.toContain('empresa-acao.erro');
    const certo = renderToStaticMarkup(<DialogoExcluir empresa={e} aoFechar={() => {}} aoPedir={() => {}} inicial={{ codigo: ' am2290 ', senha: 'x' }} />);
    expect(certo).not.toContain('data-testid="empresa-acao.confirmar" disabled=""');
    expect(certo).toContain('>Excluir empresa</button>');
  });
  it('senha errada: "Senha incorreta." numa linha com `role="alert"` e o campo marcado', () => {
    const html = renderToStaticMarkup(
      <DialogoExcluir empresa={porCodigo('AM2290')} aoFechar={() => {}} aoPedir={() => {}} inicial={{ codigo: 'AM2290', erro: { tipo: 'linha', texto: 'Senha incorreta.', senha: true } }} />,
    );
    expect(html).toMatch(/role="alert" data-testid="empresa-acao.erro"[^>]*>Senha incorreta\.</);
    expect(html).toMatch(/aria-invalid="true"[^>]*data-testid="empresa-excluir.senha"/);
  });
});
