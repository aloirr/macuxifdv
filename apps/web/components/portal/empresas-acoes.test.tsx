/**
 * ADR 0052 (spec portal-config-enxuto §15): lista de Empresas com a coluna Backup e o menu "⋯", e os diálogos de Inativar e
 * Excluir, renderizados com `react-dom/server` (lista já no cache do React Query). As listas e o corpo dos diálogos vêm do modo
 * falso (`responderFalso`), nos estados da simulação `depois-02b`, para o teste e a tela lerem os mesmos dados.
 */
import { CODIGOS_ACOES_EMPRESA as C, ListaEmpresasSchema, MENSAGENS_ACOES_EMPRESA, type AcoesDaEmpresa } from '@macuxi/platform-sdk';
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
    ['distribuidora-uma', 'Ativa', null],
    ['atacado-norte', 'Ativa', 'Nenhum'],
    ['comercial-boa-vista', 'Inativa', 'Em andamento'],
    ['RR4410', 'Inativa', null],
    ['AM5173', 'Inativa', null],
    ['AM2290', 'Inativa', null],
  ])('%s: selo e backup, sem motivo embaixo (RD-1205: ele fica só no item Excluir do menu)', (codigo, selo, texto) => {
    const l = linha(renderizarLista(), codigo);
    expect(l).toContain(`>${selo}</span>`);
    if (texto) expect(l).toContain(texto);
    else expect(l).toMatch(/\d{2}\/\d{2}\/\d{4} \d{2}:\d{2}/);
    expect(l).not.toContain('empresas.backup-motivo-');
    expect(l).not.toMatch(/Inative|inative|Vencido|Anterior à/);
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
    expect(vazio).toContain('data-testid="empresa-excluir.senha.olho"');
    expect(vazio).toContain('aria-label="Mostrar senha"');
    expect(vazio).toContain('data-testid="empresa-acao.confirmar" disabled=""');
    const errado = renderToStaticMarkup(<DialogoExcluir empresa={e} aoFechar={() => {}} aoPedir={() => {}} inicial={{ codigo: 'AM229', senha: 'x' }} />);
    expect(errado).toContain('data-testid="empresa-acao.confirmar" disabled=""');
    expect(errado).not.toContain('empresa-acao.erro');
    const certo = renderToStaticMarkup(<DialogoExcluir empresa={e} aoFechar={() => {}} aoPedir={() => {}} inicial={{ codigo: ' am2290 ', senha: 'x' }} />);
    expect(certo).not.toContain('data-testid="empresa-acao.confirmar" disabled=""');
    expect(certo).toContain('>Excluir empresa</button>');
  });
  it('senha errada: a frase da API no erro do `CampoSenha` (sem linha à parte) e o campo marcado', () => {
    const SENHA_INCORRETA = MENSAGENS_ACOES_EMPRESA[C.reautenticacaoFalhou];
    const html = renderToStaticMarkup(
      <DialogoExcluir empresa={porCodigo('AM2290')} aoFechar={() => {}} aoPedir={() => {}} inicial={{ codigo: 'AM2290', erro: { tipo: 'linha', texto: SENHA_INCORRETA, senha: true } }} />,
    );
    expect(html).toMatch(new RegExp(`id="([^"]+)-senha-erro" class="text-\\[12px\\] text-danger">${SENHA_INCORRETA.replace('.', '\\.')}<`));
    expect(html).toMatch(/aria-invalid="true" aria-describedby="[^"]+-senha-erro"/);
    expect(html).not.toContain('role="alert"');
    expect(html).not.toContain('empresa-acao.erro');
  });
  it('outra recusa da API: o `ErrorBlock` com a frase, sem marcar a senha', () => {
    const html = renderToStaticMarkup(
      <DialogoExcluir
        empresa={porCodigo('AM2290')}
        aoFechar={() => {}}
        aoPedir={() => {}}
        inicial={{ codigo: 'AM2290', erro: { tipo: 'linha', texto: 'Frase da API.', senha: false }, mensagem: 'Frase da API.' }}
      />,
    );
    expect(html).toMatch(/data-testid="empresa-acao.erro".*Frase da API\./);
    expect(html).not.toContain('aria-invalid="true"');
  });
});
