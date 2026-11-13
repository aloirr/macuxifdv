/**
 * Metas e RV › Produtividade (T-0170; RN-CORE-45; desenho `docs/desenho/performance-produtividade.md` §6.2 a §6.5), com a API
 * simulada nas rotas e contratos da N-A: máscara de cada unidade, meta por empresa, equipe ou usuário com "Vale hoje" e a
 * origem, "voltar a herdar" (apaga a linha própria) e o erro 422 `META_PRODUTIVIDADE_INVALIDA` no campo.
 */
import { createElement } from 'react';
import { describe, expect, it } from 'vitest';
import { LIMITE_DESCONTO_PADRAO } from '../../../contracts';
import { INDICADORES_PRODUTIVIDADE, MetasProdutividadePutSchema, type MetaProdutividade } from '../../../contracts/performance';
import { criarApiSimulada, erro422, novoQueryClient, renderizar, trecho } from '../tarefas/api-simulada';
import { CHAVE_CONSULTORES_METAS, CHAVE_EQUIPES, CHAVE_METAS_PRODUTIVIDADE, criarApiMetasProdutividade } from './api';
import { metasProdutividadeVigentes } from '../../../domain/performance/metas-produtividade';
import { errosDaApi, formatarMeta, lerMeta, linhasDoAlvo, mudancas, rotuloOrigem, textoDoCampo, textosDasLinhas } from './formato';
import { MetasProdutividadePanel, TabelaMetasProdutividade } from './metas-produtividade-panel';

const HOJE = '2026-11-13';
const NORTE = '6b1c2d3e-4f50-4a6b-8c7d-0000000000e1';
const NORTE_1 = '6b1c2d3e-4f50-4a6b-8c7d-0000000000e2';
const ANA = '6b1c2d3e-4f50-4a6b-8c7d-0000000000a1';
const linha = (n: number, patch: Partial<MetaProdutividade>): MetaProdutividade => ({
  id: `6b1c2d3e-4f50-4a6b-8c7d-0000000000${String(n).padStart(2, '0')}`,
  escopo: 'tenant',
  equipe_id: null,
  usuario_id: null,
  indicador: 'tma',
  valor: 30,
  vigencia_inicio: '2026-11',
  updated_at: '2026-11-01T12:00:00Z',
  deleted_at: null,
  ...patch,
});

const LINHAS = [
  linha(1, { escopo: 'tenant', indicador: 'tma', valor: 35 }),
  linha(2, { escopo: 'equipe', equipe_id: NORTE, indicador: 'tma', valor: 28 }),
  linha(3, { escopo: 'usuario', usuario_id: ANA, indicador: 'primeiro_checkin', valor: 450 }),
  linha(4, { escopo: 'equipe', equipe_id: NORTE_1, indicador: 'visitas_dia', valor: 120, vigencia_inicio: '2026-12' }),
];
const EQUIPES = [
  { id: NORTE, nome: 'Equipe Norte', equipe_pai_id: null, responsavel_id: null, responsavel_nome: null, superior_id: null, superior_nome: null },
  { id: NORTE_1, nome: 'Norte 1', equipe_pai_id: NORTE, responsavel_id: null, responsavel_nome: null, superior_id: null, superior_nome: null },
];
const usuario = { ...LIMITE_DESCONTO_PADRAO, id: ANA, nome: 'Ana Vendedora', nome_curto: null, email: 'ana@exemplo.com.br', perfil: 'vendedor', perfis: [], equipe_id: NORTE_1, equipe_nome: 'Norte 1', superior_id: null, superior_nome: null, ativo: true, external_id: null, ultimo_login_em: null, trocar_senha: false, senha_expira_em: null, sem_senha: false };

function simulada(extra: Record<string, unknown> = {}) {
  const sim = criarApiSimulada({
    'GET /core/metas-produtividade': { itens: LINHAS },
    'GET /core/equipes': { itens: EQUIPES },
    'GET /core/usuarios': { itens: [usuario, { ...usuario, id: NORTE, nome: 'Sílvio Supervisor', perfil: 'supervisor' }] },
    ...extra,
  });
  return { sim, api: criarApiMetasProdutividade(sim.chamar) };
}

describe('máscara por unidade (§1.5)', () => {
  it('lê o que se digita e mostra de volta na mesma unidade', () => {
    const casos: Array<[Parameters<typeof lerMeta>[0], string, number, string]> = [
      ['primeiro_checkin', '07:30', 450, '07:30'],
      ['tma', '30', 30, '30 min'],
      ['fora_rota', '10', 1000, '10%'],
      ['cobertura_rota', '92,5', 9250, '92,5%'],
      ['visitas_dia', '11', 110, '11,0'],
      ['raio_checkin', '100', 100, '100 m'],
      ['km_dia', '120', 120_000, '120 km'],
      ['km_cliente', '12,5', 12_500, '12,5 km'],
    ];
    for (const [i, texto, valor, exibido] of casos) {
      expect(lerMeta(i, texto), i).toEqual({ ok: true, valor });
      expect(formatarMeta(i, valor), i).toBe(exibido);
    }
    expect(textoDoCampo('ultimo_checkin', 1020)).toBe('17:00');
  });

  it('vazio herda; texto que não é número ou horário dá erro no campo', () => {
    expect(lerMeta('tma', '  ')).toEqual({ ok: true, valor: null });
    expect(lerMeta('primeiro_checkin', '7h30')).toEqual({ ok: false, erro: 'Use o horário em hh:mm.' });
    expect(lerMeta('primeiro_checkin', '24:00')).toEqual({ ok: false, erro: 'Use o horário em hh:mm.' });
    expect(lerMeta('tma', '12,5')).toEqual({ ok: false, erro: 'Use um número inteiro.' });
    expect(lerMeta('km_dia', 'abc')).toEqual({ ok: false, erro: 'Use um número.' });
  });
});

describe('linha própria do alvo e o Salvar', () => {
  const equipe = { escopo: 'equipe', equipe_id: NORTE, usuario_id: null } as const;

  it('o campo mostra só a linha do próprio alvo; o resto fica vazio (herda)', () => {
    const textos = textosDasLinhas(linhasDoAlvo(LINHAS, equipe, '2026-11'));
    expect(textos.tma).toBe('28');
    expect(INDICADORES_PRODUTIVIDADE.filter((i) => textos[i] !== '')).toEqual(['tma']);
  });

  it('Salvar: um PUT só com as alteradas (no contrato) e o "voltar a herdar" das esvaziadas', () => {
    const proprias = linhasDoAlvo(LINHAS, equipe, '2026-11');
    const textos = { ...textosDasLinhas(proprias), tma: '', tmd: '20', almoco: '60' };
    const m = mudancas(textos, proprias, equipe, '2026-11');
    expect(m).toEqual({
      ok: true,
      put: { escopo: 'equipe', equipe_id: NORTE, usuario_id: null, vigencia_inicio: '2026-11', metas: [{ indicador: 'tmd', valor: 20 }, { indicador: 'almoco', valor: 60 }] },
      herdar: [LINHAS[1]!.id],
    });
    if (m.ok && m.put) expect(MetasProdutividadePutSchema.parse(m.put)).toEqual(m.put);
  });

  it('valor igual ao gravado não vai no PUT; erro de máscara segura o Salvar no campo', () => {
    const proprias = linhasDoAlvo(LINHAS, equipe, '2026-11');
    expect(mudancas(textosDasLinhas(proprias), proprias, equipe, '2026-11')).toEqual({ ok: true, put: null, herdar: [] });
    expect(mudancas({ ...textosDasLinhas(proprias), primeiro_checkin: '8h' }, proprias, equipe, '2026-11')).toEqual({ ok: false, erros: { primeiro_checkin: 'Use o horário em hh:mm.' } });
  });

  it('PUT e DELETE vão nas rotas da N-A', async () => {
    const { sim, api } = simulada({ 'PUT /core/metas-produtividade': { ok: true }, [`DELETE /core/metas-produtividade/${LINHAS[1]!.id}`]: { ok: true } });
    await api.salvar({ escopo: 'tenant', equipe_id: null, usuario_id: null, vigencia_inicio: '2026-12', metas: [{ indicador: 'tma', valor: 25 }] });
    await api.herdar(LINHAS[1]!.id);
    expect(sim.chamadas.map((c) => [c.metodo, c.caminho])).toEqual([
      ['PUT', '/core/metas-produtividade'],
      ['DELETE', `/core/metas-produtividade/${LINHAS[1]!.id}`],
    ]);
  });
});

describe('"Vale hoje" e a origem (§6.2)', () => {
  it('usuário da Norte 1: a própria (1º check-in), a da equipe-mãe Norte (TMA) e o padrão; a de dezembro ainda não vale', () => {
    const arvore = EQUIPES.map((e) => ({ id: e.id, equipe_pai_id: e.equipe_pai_id, nome: e.nome }));
    const v = metasProdutividadeVigentes({ linhas: LINHAS, equipes: arvore, alvo: { usuario_id: ANA, equipe_id: NORTE_1 }, mes: '2026-11' });
    const origem = (i: keyof typeof v) => rotuloOrigem(v[i].origem, { indicador: i, equipeDoAlvo: NORTE_1, linhas: LINHAS, equipes: arvore, mes: '2026-11' });
    expect([v.primeiro_checkin.valor, origem('primeiro_checkin')]).toEqual([450, 'Usuário']);
    expect([v.tma.valor, origem('tma')]).toEqual([28, 'Equipe Norte']);
    expect([v.visitas_dia.valor, origem('visitas_dia')]).toEqual([110, 'Padrão do FDV']);
  });
});

describe('erro 422 no campo', () => {
  it('detalhes.erros com o campo do indicador vai para o campo; detalhes.campo também', () => {
    const lista = erro422('META_PRODUTIVIDADE_INVALIDA', 'Meta inválida.', { erros: [{ campo: 'tma', mensagem: 'Meta fora da faixa aceita: de 1 a 480 min.' }, { campo: 'vigencia_inicio', mensagem: 'Escolha o mês de hoje ou um mês seguinte.' }] });
    expect(errosDaApi(lista)).toEqual({ campos: { tma: 'Meta fora da faixa aceita: de 1 a 480 min.', vigencia_inicio: 'Escolha o mês de hoje ou um mês seguinte.' }, soltos: [] });
    expect(errosDaApi(erro422('META_PRODUTIVIDADE_INVALIDA', 'O último check-in não pode vir antes do 1º.', { campo: 'ultimo_checkin' }))).toEqual({
      campos: { ultimo_checkin: 'O último check-in não pode vir antes do 1º.' },
      soltos: [],
    });
    expect(errosDaApi(erro422('META_PRODUTIVIDADE_INVALIDA', 'Fora do escopo.', { campo: 'usuario_id' }))).toEqual({ campos: { alvo: 'Fora do escopo.' }, soltos: [] });
  });

  it('a tabela mostra o erro junto do campo, ligado por aria-describedby', () => {
    const vale = Object.fromEntries(INDICADORES_PRODUTIVIDADE.map((i) => [i, { texto: '—', origem: 'Padrão do FDV' }])) as Parameters<typeof TabelaMetasProdutividade>[0]['vale'];
    const textos = Object.fromEntries(INDICADORES_PRODUTIVIDADE.map((i) => [i, ''])) as Parameters<typeof TabelaMetasProdutividade>[0]['textos'];
    const html = renderizar(createElement(TabelaMetasProdutividade, { textos: { ...textos, tma: '600' }, erros: { tma: 'Meta fora da faixa aceita: de 1 a 480 min.' }, vale, podeEditar: true, onChange: () => {} }), []);
    const tma = trecho(html, 'metas-prod.linha.tma');
    expect(tma).toContain('aria-invalid="true"');
    expect(tma).toContain('aria-describedby="metas-prod.tma.erro"');
    expect(tma).toContain('Meta fora da faixa aceita: de 1 a 480 min.');
    expect(trecho(html, 'metas-prod.linha.tmd')).not.toContain('aria-invalid');
  });
});

describe('painel com a API simulada', () => {
  async function tela(acoes: string[]) {
    const { api } = simulada();
    const qc = novoQueryClient();
    await qc.prefetchQuery({ queryKey: CHAVE_METAS_PRODUTIVIDADE, queryFn: api.listar });
    await qc.prefetchQuery({ queryKey: CHAVE_EQUIPES, queryFn: api.equipes });
    await qc.prefetchQuery({ queryKey: CHAVE_CONSULTORES_METAS, queryFn: api.consultores });
    return renderizar(createElement(MetasProdutividadePanel, { cliente: api, hoje: HOJE }), acoes, qc);
  }

  it('empresa: 12 linhas com a regra; "Vale hoje" da empresa ou do padrão do FDV', async () => {
    const html = await tela(['meta_produtividade.editar']);
    for (const i of INDICADORES_PRODUTIVIDADE) expect(html).toContain(`data-testid="metas-prod.linha.${i}"`);
    expect(trecho(html, 'metas-prod.linha.ultimo_checkin')).toContain('a partir de');
    expect(trecho(html, 'metas-prod.vale.tma', '</td>')).toContain('35 min');
    expect(trecho(html, 'metas-prod.vale.tma', '</td>')).toContain('Empresa');
    expect(trecho(html, 'metas-prod.vale.tmd', '</td>')).toContain('25 min');
    expect(trecho(html, 'metas-prod.vale.tmd', '</td>')).toContain('Padrão do FDV');
    expect(trecho(html, 'metas-prod.campo.tma', '/>')).toContain('value="35"');
    expect(html).toContain('data-testid="metas-prod.herdar.tma"');
    expect(html).not.toContain('data-testid="metas-prod.herdar.tmd"');
  });

  it('Empresa, Equipe e Usuário (só vendedor e promotor na lista); o mês começa no de hoje', async () => {
    const html = await tela(['meta_produtividade.editar']);
    for (const e of ['tenant', 'equipe', 'usuario']) expect(html).toContain(`data-testid="metas-prod.escopo.${e}"`);
    expect(trecho(html, 'metas-prod.vigencia', '/>')).toContain('value="2026-11"');
  });

  it('só meta.ver: lê sem editar (campos desligados, sem Salvar nem Voltar a herdar)', async () => {
    const html = await tela(['meta.ver']);
    expect(html).toContain('data-testid="metas-prod.painel"');
    expect(html).not.toContain('metas-prod.salvar');
    expect(html).not.toContain('metas-prod.herdar.');
    expect(await tela([])).toBe('');
  });
});
