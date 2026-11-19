import { ErroHttpModulo, ErroNaoEncontrado } from '@macuxi/platform-sdk';
import { describe, expect, it } from 'vitest';
import { DocumentoAbrirRespostaSchema, DocumentosRespostaSchema, HistoricoNfRespostaSchema, NotaDetalheSchema } from '../contracts';
import type { DocumentoLinha, ExcecaoDocumento, PermissaoTipoDocumento, TipoDocumento } from '../domain';
import { abrirDocumento, detalheDaNota, gravarExcecaoDocumento, gravarMatrizDocumentos, linhasDoHistorico, listarDocumentos, listarNotas, lerPermissoesDocumentos, type DadosDocumentos, type DadosNotas, type RepositorioDocumentos, type RepositorioNotas } from './cliente360-v2';

const HOJE = '2026-11-19';
const C1 = '0ea00000-0000-4000-8000-000000000001';
const N1 = '0ea00000-0000-4000-8000-0000000000a1';
const N2 = '0ea00000-0000-4000-8000-0000000000a2';
const N3 = '0ea00000-0000-4000-8000-0000000000a3';
const N_ANTIGA = '0ea00000-0000-4000-8000-0000000000a4';
const T_CAD = '0ea00000-0000-4000-8000-0000000000b1';
const T_CTR = '0ea00000-0000-4000-8000-0000000000b2';
const D1 = '0ea00000-0000-4000-8000-0000000000c1';
const D2 = '0ea00000-0000-4000-8000-0000000000c2';
const ARQ = '0ea00000-0000-4000-8000-0000000000d1';

const dadosNotas: DadosNotas = {
  notas: [
    { id: N1, cliente_id: C1, numero: '004655', serie: '1', data: '2026-10-10', total_cents: 128_000, forma_pagamento: 'Boleto 14/21 dias' },
    { id: N2, cliente_id: C1, numero: '004817', serie: '1', data: '2026-11-12', total_cents: 200_000, forma_pagamento: 'Boleto 28 dias' },
    { id: N3, cliente_id: C1, numero: '004702', serie: '1', data: '2026-09-30', total_cents: 50_000, forma_pagamento: null },
    { id: N_ANTIGA, cliente_id: C1, numero: '003000', serie: '1', data: '2026-03-01', total_cents: 10_000, forma_pagamento: 'PIX' },
    { id: '0ea00000-0000-4000-8000-0000000000ff', cliente_id: 'outro', numero: '009999', serie: '1', data: '2026-11-01', total_cents: 1, forma_pagamento: null },
  ],
  devolucoes: [{ cliente_id: C1, nf_original: '004702', total_cents: 20_000, cancelada: false, data: '2026-10-05' }],
  parcelas: [
    { cliente_id: C1, nota_numero: '004655', nota_serie: '1', parcela: '1/2', vencimento: '2026-10-24', valor_cents: 64_000, saldo_cents: 0, situacao: 'liquidado', liquidado_em: '2026-10-23' },
    { cliente_id: C1, nota_numero: '004655', nota_serie: '1', parcela: '2/2', vencimento: '2026-10-31', valor_cents: 64_000, saldo_cents: 64_000, situacao: 'aberto', liquidado_em: null },
    { cliente_id: C1, nota_numero: '004817', nota_serie: '1', parcela: '1/1', vencimento: '2026-12-10', valor_cents: 200_000, saldo_cents: 200_000, situacao: 'aberto', liquidado_em: null },
    { cliente_id: C1, nota_numero: '004702', nota_serie: '1', parcela: '1/1', vencimento: '2026-10-30', valor_cents: 30_000, saldo_cents: 0, situacao: 'liquidado', liquidado_em: '2026-10-29' },
  ],
  itens: { [N1]: [{ produto_codigo: 'P1', produto_nome: 'Arroz 5kg', unidade: 'CX', fator: 6, quantidade: 2, total_cents: 64_500 }] },
  pdfs: { [N1]: ARQ },
};
const repoNotas = (d: DadosNotas = dadosNotas): RepositorioNotas => ({
  notas: async (c, de, ate) => d.notas.filter((n) => n.cliente_id === c && n.data >= de && n.data <= ate),
  nota: async (c, id) => d.notas.find((n) => n.cliente_id === c && n.id === id),
  devolucoes: async (c) => d.devolucoes.filter((x) => x.cliente_id === c),
  parcelas: async (c) => d.parcelas.filter((p) => p.cliente_id === c),
  itens: async (id) => d.itens[id] ?? [],
  pdf: async (id) => d.pdfs[id] ?? null,
});
const q = (o: object = {}) => ({ status: [], forma_pagamento: [], limite: 200, ...o }) as never;

describe('T-0186 / P17: Histórico de NF e consulta online da NF', () => {
  it('RN-CORE-40: lista dos últimos 90 dias da mais recente à mais antiga, com status calculado no domain', async () => {
    const r = await listarNotas(repoNotas(), { clienteId: C1, query: q(), hoje: HOJE, podeVerHistorico: true });
    expect(HistoricoNfRespostaSchema.parse(r).itens.map((i) => [i.numero_nf, i.status])).toEqual([['004817', 'em_aberto'], ['004655', 'em_atraso'], ['004702', 'devolvido_parcial']]);
    expect(r).toMatchObject({ de: '2026-08-21', ate: HOJE, cortadas: 0 });
    expect(r.itens[2]).toMatchObject({ devolvido_cents: 20_000 });
  });
  it('R-20261119-0530: o status "Em atraso" não leva data em nenhum campo da linha', async () => {
    const r = await listarNotas(repoNotas(), { clienteId: C1, query: q({ status: ['em_atraso'] }), hoje: HOJE, podeVerHistorico: true });
    expect(r.itens).toHaveLength(1);
    expect(Object.keys(r.itens[0]!).sort()).toEqual(['data', 'devolvido_cents', 'forma_pagamento', 'id', 'numero_nf', 'status', 'valor_cents']);
  });
  it('P17: período de 12 meses consulta o servidor (acha a nota antiga) e as formas de pagamento do período saem para o filtro', async () => {
    const r = await listarNotas(repoNotas(), { clienteId: C1, query: q({ de: '2025-11-19' }), hoje: HOJE, podeVerHistorico: true });
    expect(r.itens.map((i) => i.numero_nf)).toContain('003000');
    expect(r.formas_pagamento).toEqual(['Boleto 14/21 dias', 'Boleto 28 dias', 'PIX']);
  });
  it('P14: filtra por Nº da NF e por forma de pagamento', async () => {
    const a = await listarNotas(repoNotas(), { clienteId: C1, query: q({ numero_nf: '4655' }), hoje: HOJE, podeVerHistorico: true });
    expect(a.itens.map((i) => i.numero_nf)).toEqual(['004655']);
    const b = await listarNotas(repoNotas(), { clienteId: C1, query: q({ forma_pagamento: ['Boleto 28 dias'] }), hoje: HOJE, podeVerHistorico: true });
    expect(b.itens.map((i) => i.numero_nf)).toEqual(['004817']);
  });
  it('limite corta a lista e informa quantas notas ficaram de fora', async () => {
    const r = await listarNotas(repoNotas(), { clienteId: C1, query: q({ limite: 1 }), hoje: HOJE, podeVerHistorico: true });
    expect(r).toMatchObject({ cortadas: 2 });
    expect(r.itens).toHaveLength(1);
  });
  it('período invertido ou maior que 12 meses = 422 PERIODO_INVALIDO em português', async () => {
    await expect(listarNotas(repoNotas(), { clienteId: C1, query: q({ de: '2026-11-01', ate: '2026-10-01' }), hoje: HOJE, podeVerHistorico: true })).rejects.toMatchObject({ status: 422, codigo: 'PERIODO_INVALIDO' });
    await expect(listarNotas(repoNotas(), { clienteId: C1, query: q({ de: '2024-01-01' }), hoje: HOJE, podeVerHistorico: true })).rejects.toMatchObject({ status: 422, codigo: 'PERIODO_INVALIDO' });
  });
  it('P12: promotor sem promotor_ve_pedidos = 403 na lista e no detalhe, e nada é lido', async () => {
    let leu = false;
    const repo = { ...repoNotas(), notas: async () => { leu = true; return []; }, nota: async () => { leu = true; return undefined; } };
    await expect(listarNotas(repo, { clienteId: C1, query: q(), hoje: HOJE, podeVerHistorico: false })).rejects.toMatchObject({ status: 403, codigo: 'HISTORICO_SEM_ACESSO' });
    await expect(detalheDaNota(repo, { clienteId: C1, notaId: N1, hoje: HOJE, podeVerHistorico: false })).rejects.toMatchObject({ status: 403, codigo: 'HISTORICO_SEM_ACESSO' });
    expect(leu).toBe(false);
  });
  it('P17: detalhe da NF traz parcelas, itens e PDF; parcela vencida em atraso sem data de atraso', async () => {
    const d = NotaDetalheSchema.parse(await detalheDaNota(repoNotas(), { clienteId: C1, notaId: N1, hoje: HOJE, podeVerHistorico: true }));
    expect(d).toMatchObject({ numero_nf: '004655', status: 'em_atraso', em_atraso: true, valor_final_cents: 128_000, pdf_arquivo_id: ARQ });
    expect(d.parcelas.map((p) => [p.parcela, p.em_atraso])).toEqual([['1/2', false], ['2/2', true]]);
    expect(d.itens).toHaveLength(1);
  });
  it('P4: detalhe da NF com devolução mostra devolvido, data e valor final', async () => {
    const d = await detalheDaNota(repoNotas(), { clienteId: C1, notaId: N3, hoje: HOJE, podeVerHistorico: true });
    expect(d).toMatchObject({ status: 'devolvido_parcial', devolvido_cents: 20_000, devolvido_em: '2026-10-05', valor_final_cents: 30_000 });
  });
  it('RN-CORE-04: nota de outro cliente ou inexistente = 404, sem revelar', async () => {
    await expect(detalheDaNota(repoNotas(), { clienteId: C1, notaId: '0ea00000-0000-4000-8000-0000000000ff', hoje: HOJE, podeVerHistorico: true })).rejects.toBeInstanceOf(ErroNaoEncontrado);
  });
  it('as linhas de 90 dias que vão no Cliente 360 usam o mesmo cálculo da lista', async () => {
    expect((await linhasDoHistorico(repoNotas(), C1, HOJE)).map((l) => l.numero_nf)).toEqual(['004817', '004655', '004702']);
  });
});

const tipos: TipoDocumento[] = [
  { id: T_CAD, nome: 'Alvará', grupo: 'Cadastro', ordem: 1, permite_envio: false, ativo: true },
  { id: T_CTR, nome: 'Contrato social', grupo: 'Contratos', ordem: 2, permite_envio: false, ativo: true },
];
function memoria(): { repo: RepositorioDocumentos; estado: DadosDocumentos } {
  const estado: DadosDocumentos = {
    tipos,
    documentos: [
      { id: D1, cliente_id: C1, tipo_id: T_CAD, nome: 'Alvará 2026', formato: 'PDF', data: '2026-10-01', validade: '2026-10-31', arquivo_id: ARQ },
      { id: D2, cliente_id: C1, tipo_id: T_CTR, nome: 'Contrato social', formato: 'PDF', data: '2026-09-01', validade: null, arquivo_id: ARQ },
    ] as Array<DocumentoLinha & { cliente_id: string; arquivo_id: string }>,
    matriz: [
      { tipo_id: T_CAD, perfil: 'vendedor', nivel: 've' },
      { tipo_id: T_CAD, perfil: 'supervisor', nivel: 've' },
      { tipo_id: T_CTR, perfil: 'supervisor', nivel: 've' },
    ] as PermissaoTipoDocumento[],
    excecoes: [] as ExcecaoDocumento[],
    clientes: { [C1]: 'Mercado Bom Preço' },
  };
  const repo: RepositorioDocumentos = {
    tipos: async () => estado.tipos,
    documentosDoCliente: async (c) => estado.documentos.filter((d) => d.cliente_id === c),
    documento: async (c, id) => estado.documentos.find((d) => d.cliente_id === c && d.id === id),
    matriz: async () => estado.matriz,
    excecoes: async () => estado.excecoes,
    substituirMatriz: async (m) => { estado.matriz = [...m]; },
    substituirExcecao: async (docId, perfis) => { estado.excecoes = [...estado.excecoes.filter((e) => e.documento_id !== docId), ...perfis.map((perfil) => ({ documento_id: docId, perfil }))]; },
    documentoPorId: async (id) => estado.documentos.find((d) => d.id === id),
    nomesDeDocumentoECliente: async (ids) => ids.map((id) => ({ documento_id: id, documento_nome: estado.documentos.find((d) => d.id === id)?.nome ?? '?', cliente_id: C1, cliente_nome: estado.clientes[C1] ?? '?' })),
  };
  return { repo, estado };
}

describe('T-0186 / P15: Documentação, só visualizar, com a permissão revalidada na API', () => {
  it('P10: o vendedor não vê o tipo sem permissão; vencido sai na linha (P16)', async () => {
    const { repo } = memoria();
    const r = DocumentosRespostaSchema.parse(await listarDocumentos(repo, { perfil: 'vendedor', clienteId: C1, hoje: HOJE }));
    expect(r.itens.map((i) => [i.nome, i.validade_situacao, i.acesso])).toEqual([['Alvará 2026', 'vencido', 'abrir']]);
  });
  it('a lista nunca leva o id do arquivo (só a abertura devolve)', async () => {
    const { repo } = memoria();
    const r = await listarDocumentos(repo, { perfil: 'supervisor', clienteId: C1, hoje: HOJE });
    expect(JSON.stringify(r)).not.toContain(ARQ);
  });
  it('P10/P11: exceção por documento deixa o cadeado na lista e recusa abrir com 403', async () => {
    const { repo, estado } = memoria();
    estado.excecoes = [{ documento_id: D1, perfil: 'vendedor' }];
    expect((await listarDocumentos(repo, { perfil: 'vendedor', clienteId: C1, hoje: HOJE })).itens[0]).toMatchObject({ acesso: 'bloqueado' });
    await expect(abrirDocumento(repo, { perfil: 'vendedor', clienteId: C1, documentoId: D1 })).rejects.toMatchObject({ status: 403, codigo: 'DOCUMENTO_SEM_PERMISSAO' });
  });
  it('P10: tipo que o perfil não vê abre como 404 (não revela que existe)', async () => {
    const { repo } = memoria();
    await expect(abrirDocumento(repo, { perfil: 'vendedor', clienteId: C1, documentoId: D2 })).rejects.toBeInstanceOf(ErroNaoEncontrado);
  });
  it('abrir com permissão devolve o arquivo para o visualizador (sem baixar)', async () => {
    const { repo } = memoria();
    expect(DocumentoAbrirRespostaSchema.parse(await abrirDocumento(repo, { perfil: 'supervisor', clienteId: C1, documentoId: D2 }))).toMatchObject({ id: D2, arquivo_id: ARQ });
  });
  it('documento de outro cliente = 404', async () => {
    const { repo } = memoria();
    await expect(abrirDocumento(repo, { perfil: 'supervisor', clienteId: '0ea00000-0000-4000-8000-0000000000ee', documentoId: D2 })).rejects.toBeInstanceOf(ErroNaoEncontrado);
  });
});

describe('T-0186 / P5, P11: BKO › Parâmetros › Documentos (auditado)', () => {
  const auditoria = () => { const regs: Array<{ acao: string; antes: unknown; depois: unknown }> = []; return { regs, auditar: async (r: { acao: string; antes: unknown; depois: unknown }) => { regs.push(r); } }; };
  it('lê a matriz e as exceções com o nome do documento e do cliente', async () => {
    const { repo, estado } = memoria();
    estado.excecoes = [{ documento_id: D1, perfil: 'vendedor' }, { documento_id: D1, perfil: 'promotor' }];
    const r = await lerPermissoesDocumentos(repo);
    expect(r.excecoes).toEqual([{ documento_id: D1, documento_nome: 'Alvará 2026', cliente_id: C1, cliente_nome: 'Mercado Bom Preço', perfis: ['promotor', 'vendedor'] }]);
  });
  it('grava a matriz e audita antes e depois (RN-AUD-01)', async () => {
    const { repo, estado } = memoria();
    const a = auditoria();
    await gravarMatrizDocumentos(repo, [{ tipo_id: T_CTR, perfil: 'gerente', nivel: 've' }], a.auditar);
    expect(estado.matriz).toEqual([{ tipo_id: T_CTR, perfil: 'gerente', nivel: 've' }]);
    expect(a.regs).toHaveLength(1);
    expect(a.regs[0]).toMatchObject({ acao: 'documento.permissoes' });
  });
  it('matriz inválida (Vê e envia em tipo sem envio) = 422 e nada é gravado nem auditado', async () => {
    const { repo, estado } = memoria();
    const a = auditoria();
    const antes = [...estado.matriz];
    await expect(gravarMatrizDocumentos(repo, [{ tipo_id: T_CAD, perfil: 'vendedor', nivel: 've_e_envia' }], a.auditar)).rejects.toMatchObject({ status: 422, codigo: 'DOCUMENTO_NIVEL_INVALIDO' });
    expect(estado.matriz).toEqual(antes);
    expect(a.regs).toEqual([]);
  });
  it('P11: exceção só tira acesso: perfil que o tipo não libera é recusado; admin e analista nunca recebem exceção', async () => {
    const { repo, estado } = memoria();
    const a = auditoria();
    await expect(gravarExcecaoDocumento(repo, { documento_id: D2, perfis: ['vendedor'] }, a.auditar)).rejects.toMatchObject({ status: 422, codigo: 'DOCUMENTO_EXCECAO_SEM_ACESSO' });
    await expect(gravarExcecaoDocumento(repo, { documento_id: D1, perfis: ['admin'] }, a.auditar)).rejects.toMatchObject({ status: 422, codigo: 'DOCUMENTO_PERFIL_FIXO' });
    await gravarExcecaoDocumento(repo, { documento_id: D1, perfis: ['vendedor'] }, a.auditar);
    expect(estado.excecoes).toEqual([{ documento_id: D1, perfil: 'vendedor' }]);
    await gravarExcecaoDocumento(repo, { documento_id: D1, perfis: [] }, a.auditar);
    expect(estado.excecoes).toEqual([]);
    expect(a.regs.map((r) => r.acao)).toEqual(['documento.excecao', 'documento.excecao']);
  });
  it('documento inexistente na exceção = 404', async () => {
    const { repo } = memoria();
    await expect(gravarExcecaoDocumento(repo, { documento_id: '0ea00000-0000-4000-8000-0000000000ee', perfis: ['vendedor'] }, async () => {})).rejects.toBeInstanceOf(ErroHttpModulo);
  });
});
