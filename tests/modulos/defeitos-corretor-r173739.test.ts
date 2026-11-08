/**
 * Veredito, com teste, dos 3 defeitos possíveis encaminhados pelo corretor-redundancias (R-20261108-173739; relatório
 * docs/qualidade/redundancias/2026-11-08-lote.md §7). Sem banco: roda local e no CI. Matriz em docs/testes/T-0124.md
 * (seção "Defeitos encaminhados pelo corretor").
 *
 * D1 (T-0114, RN-VEN-31 com a exceção de 07/11): `orderActions` libera o cancelamento e o texto manda "cancele no ERP" — CONFIRMADO.
 * D2 (T-0094, RN-CORE-32): 422 sem `faltas` no app × BKO — CONFORME (a API manda a frase da spec; os dois mostram o mesmo texto).
 * D3 (T-0119, RN-CAT-09/12): `catalogo.busca_produtos@1` na API — fora de rota quente hoje (guarda abaixo); código do
 *    concorrente não casa na versão da API, ao contrário do aparelho — defeito latente do contrato.
 *
 * Defeito confirmado fica em `it.fails` (falha hoje pelo motivo descrito; o agente testes volta para `it` no commit da correção).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

import { describe, expect, it } from 'vitest';

import { ErroHttp } from '@macuxi/platform-sdk';
import { ApiRequestError } from '@macuxi/platform-sdk/web';

import { resultadoDoErroDaTroca } from '../../apps/web/lib/ciclo-senha';
import { consultaBuscaProdutos } from '../../modules/catalogo/api/consultas-texto';
import { buscarParaConsulta } from '../../modules/catalogo/domain/busca-consulta';
import { parametrosDoTenant } from '../../modules/catalogo/domain/parametros';
import type { ProdutoCatalogo } from '../../modules/catalogo/domain/vitrine';
import { erroDaTroca } from '../../modules/core/app/lib/senha';
import { validarSenhaNova } from '../../modules/core/domain/acesso-senha';
import { estadoDasAcoes } from '../../modules/vendedor/app/lib/acoes-pedido';
import { MSG_CANCELAR_APOS_ENVIO, orderActions, verificarCancelamento } from '../../modules/vendedor/domain/order';

const RAIZ = join(__dirname, '..', '..');

// ---------- D1 ----------
describe('D1. RN-VEN-31 (exceção T-0114): ação liberada × texto do bloqueio no detalhe do pedido', () => {
  const telaDoDetalhe = (status: Parameters<typeof orderActions>[0], erpAceitaCancelamento: boolean) =>
    estadoDasAcoes({ status, naFila: false, offline: false, v1: true, ehVendedor: true, temItens: true, pode: { editar: true, cancelar: true }, acoes: orderActions(status, { erpAceitaCancelamento }) });

  it('controle: sem o aceite do conector, integrado não cancela e o texto manda cancelar no ERP (regra de sempre)', () => {
    expect(orderActions('integrated', { erpAceitaCancelamento: false })).toMatchObject({ can_cancel: false, locked_reason: MSG_CANCELAR_APOS_ENVIO });
    expect(telaDoDetalhe('integrated', false)).toMatchObject({ podeExcluir: false, motivoBloqueio: MSG_CANCELAR_APOS_ENVIO });
  });

  it('controle: faturado nunca cancela no Macuxi, mesmo com o aceite; o texto "cancele no ERP" é coerente', () => {
    expect(verificarCancelamento('invoiced', { erpAceitaCancelamento: true }).ok).toBe(false);
    expect(telaDoDetalhe('invoiced', true)).toMatchObject({ podeExcluir: false, motivoBloqueio: MSG_CANCELAR_APOS_ENVIO });
  });

  it.fails('com o aceite do conector, integrado/enviado cancela no Macuxi e o texto NÃO pode mandar cancelar no ERP — hoje mostra "Pedido já enviado ao ERP — cancele no ERP" ao lado do Excluir', () => {
    for (const st of ['sent_to_erp', 'integrated'] as const) {
      const acoes = orderActions(st, { erpAceitaCancelamento: true });
      expect(acoes.can_cancel).toBe(true);
      expect(acoes.can_edit).toBe(false);
      expect(acoes.locked_reason).not.toMatch(/cancele no ERP/i);
      const tela = telaDoDetalhe(st, true);
      expect(tela.podeExcluir).toBe(true);
      expect(tela.motivoBloqueio).not.toMatch(/cancele no ERP/i);
    }
  });
});

// ---------- D2 ----------
describe('D2. RN-CORE-32 na "Crie sua senha": app × BKO com a resposta real da API (spec docs/design/ciclo-de-senha.md §2)', () => {
  const EMAIL = 'ana@exemplo.com.br';
  /** Corpo que a API manda (modules/core/api/autenticacao.ts: erroHttp(422, codigo, mensagem, { faltas })). */
  const respostaDaApi = (nova: string) => {
    const r = validarSenhaNova(nova, EMAIL, false);
    if (!r || r.codigo !== 'RN-CORE-32') throw new Error(`senha "${nova}" não cai na RN-CORE-32`);
    return { codigo: r.codigo, mensagem: r.mensagem, detalhes: { faltas: r.faltas } };
  };
  const noApp = (nova: string) => {
    const b = respostaDaApi(nova);
    return erroDaTroca(new ErroHttp(422, b.codigo, b.mensagem, b.detalhes));
  };
  const noBko = (nova: string) => {
    const b = respostaDaApi(nova);
    return resultadoDoErroDaTroca(new ApiRequestError(422, b.codigo, b.mensagem, b.detalhes), nova);
  };

  it('senha igual ao e-mail (a API manda faltas vazia): app e BKO mostram "A senha não pode ser igual ao e-mail." e destacam', () => {
    // e-mail que cumpre a política (letra, número, especial, ≥ 8) para cair só no "≠ e-mail"
    const email = 'ana1@exemplo.com.br';
    const r = validarSenhaNova(email, email, false);
    expect(r).toMatchObject({ codigo: 'RN-CORE-32', faltas: [], mensagem: 'A senha não pode ser igual ao e-mail.' });
    const corpo = { codigo: 'RN-CORE-32', mensagem: r!.mensagem, detalhes: { faltas: [] } };
    const app = erroDaTroca(new ErroHttp(422, corpo.codigo, corpo.mensagem, corpo.detalhes));
    const bko = resultadoDoErroDaTroca(new ApiRequestError(422, corpo.codigo, corpo.mensagem, corpo.detalhes), email);
    expect(app).toEqual({ texto: 'A senha não pode ser igual ao e-mail.', acao: 'destacar' });
    expect(bko).toEqual({ mensagem: 'A senha não pode ser igual ao e-mail.', acao: 'destacar' });
  });

  it.each(['abc', 'abcdefgh', 'Abcdefg1', 'abcdefg#'])('senha fraca "%s": app e BKO mostram a mesma frase de mensagemDaSenha(faltas)', (nova) => {
    expect(noApp(nova).texto).toBe(noBko(nova).mensagem);
    expect(noApp(nova).acao).toBe('destacar');
    expect(noBko(nova).acao).toBe('destacar');
  });
});

// ---------- D3 ----------
function arquivosTs(dir: string): string[] {
  const fora = new Set(['node_modules', '.next', 'dist', '.turbo']);
  const saida: string[] = [];
  for (const nome of readdirSync(dir)) {
    if (fora.has(nome)) continue;
    const p = join(dir, nome);
    if (statSync(p).isDirectory()) saida.push(...arquivosTs(p));
    else if (/\.tsx?$/.test(nome) && !/\.test\.tsx?$/.test(nome)) saida.push(p);
  }
  return saida;
}

describe('D3. catalogo.busca_produtos@1 na API (T-0119; RN-CAT-09/12)', () => {
  it('guarda de rota quente: nenhum código do servidor (apps/api, modules/*/api) chama a consulta; só o Catálogo a implementa. Quem ligar precisa da T-0119 (índice + cache, p95 < 300 ms com 20 mil)', () => {
    const servidor = [join(RAIZ, 'apps', 'api', 'src'), ...readdirSync(join(RAIZ, 'modules')).map((m) => join(RAIZ, 'modules', m, 'api'))].filter((d) => {
      try {
        return statSync(d).isDirectory();
      } catch {
        return false;
      }
    });
    const usos = servidor
      .flatMap(arquivosTs)
      .filter((f) => /CONSULTA_BUSCA_PRODUTOS|catalogo\.busca_produtos@1/.test(readFileSync(f, 'utf8')))
      .map((f) => relative(RAIZ, f).split(sep).join('/'));
    expect(usos).toEqual(['modules/catalogo/api/consultas-texto.ts']);
  });

  // fixture: 1 produto com a referência cruzada "MANN W 712/75" (RN-CAT-09: busca ignora espaço, barra e maiúsculas)
  const PROD = '00000000-0000-4000-8000-000000000001';
  const MARCA = '00000000-0000-4000-8000-000000000002';
  const linhaBusca = { produto_id: PROD, sku: 'FO-100', ean: null, nome: 'Filtro de óleo', marca: 'Tecfil', categoria: 'Filtros', atributos: null, aplicacao: 'Gol 1.0', ativo: true };
  const referencia = { produto_id: PROD, marca_id: MARCA, marca_nome: 'Mann', codigo: 'W 712/75' };

  it('controle: o núcleo puro do Catálogo (o mesmo do aparelho) acha o produto pelo código do concorrente', () => {
    const p: ProdutoCatalogo = { id: PROD, sku: 'FO-100', ean: null, nome: 'Filtro de óleo', marca: 'Tecfil', categoria: 'Filtros', unidade: 'UN', ativo: true, atributos: [], aplicacao: 'Gol 1.0', referencias: [{ marca_id: MARCA, marca_nome: 'Mann', codigo: 'W 712/75' }], thumbnail_url: null, campanha: false, vendas: 0 };
    const itens = buscarParaConsulta({ produtos: [p], q: 'w71275', limite: 100, sinonimos: [], parametros: parametrosDoTenant({}), anoAtual: 2026 });
    expect(itens.map((i) => i.produto_id)).toEqual([PROD]);
  });

  const db = {
    query: async (sql: string) => {
      if (/produto_busca/.test(sql)) return { rows: [linhaBusca] };
      if (/produto_referencia/.test(sql)) return { rows: [referencia] };
      return { rows: [] };
    },
  };
  const ctx = { db, parametros: () => ({}), agora: () => new Date('2026-11-10T13:00:00Z'), fuso: () => 'America/Manaus' };
  const impl = consultaBuscaProdutos as unknown as { executar: (e: unknown, c: unknown) => Promise<{ itens: Array<{ produto_id: string }> }> };

  it('controle: a versão da API roda com este contexto e acha o produto pelo nome', async () => {
    const r = await impl.executar({ q: 'filtro', limite: 100 }, ctx);
    expect(r.itens.map((i) => i.produto_id)).toEqual([PROD]);
  });

  it.fails('a versão da API acha pelo código do concorrente como o aparelho e a vitrine (RN-CAT-09) — hoje monta `referencias: []` e não acha', async () => {
    const r = await impl.executar({ q: 'w71275', limite: 100 }, ctx);
    expect(r.itens.map((i) => i.produto_id)).toEqual([PROD]);
  });
});
