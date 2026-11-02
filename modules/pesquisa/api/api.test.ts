import { criarRelogio } from '@macuxi/comum/relogio';
import { criarPermissoes, verificarAcao, verificarAcesso, type ItemPush, type Perfil } from '@macuxi/platform-sdk';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  ExportacaoResponse,
  ListaQuestionarios,
  PublicarResponse,
  QuestionarioDetalhe,
  QuestionarioVersaoSync,
  RespostaPesquisaSync,
  RespostaRegistradaV1,
  ResultadoResponse,
  type RespostaEnvio,
} from '../contracts';
import manifest from '../manifest';
import { criarAmbienteDeTeste, TENANT_B, uu } from './apoio-teste';
import { moduloApi } from './index';

const relogio = criarRelogio();
const agora = () => relogio.agora();
const iso = (d: Date) => d.toISOString();

const ANALISTA = uu(1);
const VENDEDOR = uu(31);
const VENDEDOR_2 = uu(32);
const SUPERVISOR = uu(21);
const CLIENTE = uu(51);
const CLIENTE_FORA = uu(59);
const Q = uu(800);
const P1 = uu(101);
const P2 = uu(102);
const P3 = uu(103);
const OP_A = uu(201);
const OP_B = uu(202);

const perguntas = [
  { id: P1, tipo: 'sim_nao', enunciado: 'Tem ponto extra?', obrigatoria: true },
  { id: P2, tipo: 'unica', enunciado: 'Qual marca lidera?', obrigatoria: false, opcoes: [{ id: OP_A, rotulo: 'Nossa' }, { id: OP_B, rotulo: 'Concorrente' }] },
  { id: P3, tipo: 'foto', enunciado: 'Foto da gôndola', obrigatoria: false, min_fotos: 1, max_fotos: 2 },
];

let amb: ReturnType<typeof criarAmbienteDeTeste>;
const ctx = (id: string, perfil: Perfil, extra: Partial<Parameters<typeof amb.contexto>[0]> = {}) => amb.contexto({ id, perfil, agora, ...extra });

/** Cria, preenche e publica a v1 (vigência começando ontem). */
async function publicarV1(modo: 'avulsa' | 'checkout_obrigatoria' = 'avulsa') {
  const a = ctx(ANALISTA, 'analista');
  await amb.chamar(a, 'POST', 'questionarios', { corpo: { id: Q, titulo: 'Gôndola do mês' } });
  await amb.chamar(a, 'PUT', 'questionarios/:id/rascunho', { params: { id: Q }, corpo: { perguntas, modo, vigencia: { inicio: iso(relogio.relativo({ dias: -1 })), fim: null } } });
  return PublicarResponse.parse(await amb.chamar(a, 'POST', 'questionarios/:id/publicar', { params: { id: Q } }));
}

const envio = (versao_id: string, extra: Partial<RespostaEnvio> = {}): RespostaEnvio => ({
  id: uu(5000),
  questionario_id: Q,
  versao_id,
  cliente_id: CLIENTE,
  visita_id: uu(61),
  respondida_em: iso(relogio.relativo({ minutos: -10 })),
  itens: [
    { pergunta_id: P1, tipo: 'sim_nao', valor: true },
    { pergunta_id: P3, tipo: 'foto', fotos: [{ id: uu(7001), referencia: uu(7001), capturada_em: iso(relogio.relativo({ minutos: -11 })) }] },
  ],
  ...extra,
});
const item = (e: RespostaEnvio): ItemPush => ({ entidade: 'resposta_pesquisa', id: e.id, operacao: 'upsert', payload: e });
const horizonte = () => iso(relogio.relativo({ minutos: 5 }));

beforeEach(() => {
  amb = criarAmbienteDeTeste();
});

describe('regra 6: permissões das rotas da Pesquisa (ADR 0004, doc 03 §2)', () => {
  const perm = criarPermissoes([manifest]);
  const usuario = (perfil: Perfil, modulos: readonly ('core' | 'pesquisa')[] = ['core', 'pesquisa']) => ({ id: 'u', tenant_id: 't', perfil, modulos });

  it('a API é válida para o SDK: 10 rotas e os provedores de questionario_versao e resposta_pesquisa', () => {
    expect(moduloApi.rotas).toHaveLength(10);
    expect(moduloApi.sync?.map((s) => s.entidade.nome)).toEqual(['questionario_versao', 'resposta_pesquisa']);
    for (const r of moduloApi.rotas ?? []) if (r.metodo !== 'GET') expect(r.acao, `${r.metodo} ${r.caminho}`).toBeTruthy();
  });

  it('doc 03 §2: criar, editar, publicar e arquivar só analista e admin (403 PERFIL_SEM_ACESSO para os demais)', () => {
    const escrita = (moduloApi.rotas ?? []).filter((r) => r.metodo !== 'GET');
    expect(escrita.map((r) => r.acao).sort()).toEqual(['questionario.arquivar', 'questionario.criar', 'questionario.editar', 'questionario.publicar']);
    for (const r of escrita) {
      for (const p of ['analista', 'admin'] as const) expect(verificarAcao(usuario(p), perm, r.acao!)).toMatchObject({ ok: true });
      for (const p of ['vendedor', 'promotor', 'supervisor', 'gerente', 'assistente'] as const) expect(verificarAcao(usuario(p), perm, r.acao!)).toMatchObject({ ok: false, status: 403, codigo: 'PERFIL_SEM_ACESSO' });
    }
  });

  it('RF-PES-06: resultados e exportação para supervisor, gerente, analista e admin; vendedor e promotor recebem 403', () => {
    for (const caminho of ['questionarios/:id/resultado', 'questionarios/:id/respostas', 'questionarios/:id/galeria', 'questionarios/:id/exportar']) {
      const r = amb.rota('GET', caminho);
      for (const p of ['supervisor', 'gerente', 'analista', 'admin'] as const) expect(verificarAcao(usuario(p), perm, r.acao!), `${caminho} ${p}`).toMatchObject({ ok: true });
      for (const p of ['vendedor', 'promotor', 'assistente'] as const) expect(verificarAcao(usuario(p), perm, r.acao!), `${caminho} ${p}`).toMatchObject({ ok: false, status: 403 });
    }
  });

  it('lista e detalhe dos questionários: gestão e BKO; vendedor e promotor recebem 403 (lêem pelo sync)', () => {
    for (const caminho of ['questionarios', 'questionarios/:id']) {
      const r = amb.rota('GET', caminho);
      for (const p of ['supervisor', 'gerente', 'analista', 'admin'] as const) expect(verificarAcesso(usuario(p), { modulo: 'pesquisa', perfis: r.perfis! })).toEqual({ ok: true });
      for (const p of ['vendedor', 'promotor', 'assistente'] as const) expect(verificarAcesso(usuario(p), { modulo: 'pesquisa', perfis: r.perfis! })).toMatchObject({ ok: false, status: 403 });
    }
  });

  it('RN-CORE-02: com o módulo desativado toda rota responde 403 MODULO_INATIVO', () => {
    for (const r of moduloApi.rotas ?? []) {
      expect(verificarAcesso(usuario('admin', ['core']), { modulo: 'pesquisa', ...(r.acao ? { acao: r.acao, permissoes: perm } : { perfis: r.perfis! }) } as never)).toMatchObject({ ok: false, status: 403, codigo: 'MODULO_INATIVO' });
    }
  });
});

describe('RF-PES-01/05, RN-PES-01: construtor no BKO de ponta a ponta', () => {
  it('RF-PES-01: cria com a v1 em rascunho, salva perguntas, publica, audita e congela', async () => {
    const pub = await publicarV1();
    expect(pub.versao).toMatchObject({ numero: 1, status: 'publicada', publicada_por: ANALISTA });
    expect(amb.efeitos.auditorias.map((a) => a.acao)).toEqual(['questionario.criar', 'questionario.publicar']);
    expect(amb.efeitos.auditorias[1]).toMatchObject({ entidade: 'questionario_versao', antes: { status: 'rascunho' }, depois: { status: 'publicada', numero: 1 } });
    const d = QuestionarioDetalhe.parse(await amb.chamar(ctx(ANALISTA, 'analista'), 'GET', 'questionarios/:id', { params: { id: Q } }));
    expect(d.versoes.map((v) => [v.numero, v.status])).toEqual([[1, 'publicada']]);
    expect(d.validacao_rascunho).toBeNull();
  });

  it('RF-PES-01: criar de novo com o mesmo id devolve o mesmo questionário (idempotente)', async () => {
    const a = ctx(ANALISTA, 'analista');
    await amb.chamar(a, 'POST', 'questionarios', { corpo: { id: Q, titulo: 'A' } });
    const d = QuestionarioDetalhe.parse(await amb.chamar(a, 'POST', 'questionarios', { corpo: { id: Q, titulo: 'B' } }));
    expect(d.versoes).toHaveLength(1);
    expect(d.versoes[0]!.titulo).toBe('A');
  });

  it('RF-PES-01: publicar sem perguntas é recusado (422 VERSAO_INVALIDA com os problemas)', async () => {
    const a = ctx(ANALISTA, 'analista');
    await amb.chamar(a, 'POST', 'questionarios', { corpo: { id: Q, titulo: 'Vazio' } });
    await expect(amb.chamar(a, 'POST', 'questionarios/:id/publicar', { params: { id: Q } })).rejects.toMatchObject({ status: 422, codigo: 'VERSAO_INVALIDA', detalhes: { problemas: [expect.objectContaining({ codigo: 'SEM_PERGUNTAS' })] } });
  });

  it('RN-PES-07: limite de perguntas vem dos parâmetros do tenant', async () => {
    const a = amb.contexto({ id: ANALISTA, perfil: 'analista', agora, parametros: { max_perguntas: 2 } });
    await amb.chamar(a, 'POST', 'questionarios', { corpo: { id: Q, titulo: 'Grande' } });
    await amb.chamar(a, 'PUT', 'questionarios/:id/rascunho', { params: { id: Q }, corpo: { perguntas } });
    await expect(amb.chamar(a, 'POST', 'questionarios/:id/publicar', { params: { id: Q } })).rejects.toMatchObject({ codigo: 'VERSAO_INVALIDA', detalhes: { problemas: [expect.objectContaining({ codigo: 'LIMITE_PERGUNTAS' })] } });
  });

  it('RN-PES-01: editar uma versão publicada abre a v2 em rascunho com os mesmos ids; a v1 não muda', async () => {
    await publicarV1();
    const a = ctx(ANALISTA, 'analista');
    const d = QuestionarioDetalhe.parse(await amb.chamar(a, 'PUT', 'questionarios/:id/rascunho', { params: { id: Q }, corpo: { titulo: 'Gôndola v2' } }));
    expect(d.versoes.map((v) => [v.numero, v.status, v.titulo])).toEqual([
      [1, 'publicada', 'Gôndola do mês'],
      [2, 'rascunho', 'Gôndola v2'],
    ]);
    expect(d.versoes[1]!.perguntas.map((p) => p.id)).toEqual([P1, P2, P3]);
    expect(d.validacao_rascunho?.erros).toEqual([]);
    const pub2 = PublicarResponse.parse(await amb.chamar(a, 'POST', 'questionarios/:id/publicar', { params: { id: Q } }));
    expect(pub2.versao.numero).toBe(2);
    await expect(amb.chamar(a, 'POST', 'questionarios/:id/publicar', { params: { id: Q } })).rejects.toMatchObject({ status: 409, codigo: 'SEM_RASCUNHO' });
  });

  it('RF-PES-01: rascunho com pergunta repetida é recusado na forma (422 RASCUNHO_INVALIDO)', async () => {
    const a = ctx(ANALISTA, 'analista');
    await amb.chamar(a, 'POST', 'questionarios', { corpo: { id: Q, titulo: 'X' } });
    await expect(amb.chamar(a, 'PUT', 'questionarios/:id/rascunho', { params: { id: Q }, corpo: { perguntas: [perguntas[0], perguntas[0]] } })).rejects.toMatchObject({ status: 422, codigo: 'RASCUNHO_INVALIDO' });
  });

  it('RF-PES-05: arquivar audita uma vez, bloqueia edição e aparece na lista como arquivado', async () => {
    await publicarV1();
    const a = ctx(ANALISTA, 'analista');
    await amb.chamar(a, 'POST', 'questionarios/:id/arquivar', { params: { id: Q } });
    await amb.chamar(a, 'POST', 'questionarios/:id/arquivar', { params: { id: Q } });
    expect(amb.efeitos.auditorias.filter((x) => x.acao === 'questionario.arquivar')).toHaveLength(1);
    await expect(amb.chamar(a, 'PUT', 'questionarios/:id/rascunho', { params: { id: Q }, corpo: { titulo: 'Z' } })).rejects.toMatchObject({ codigo: 'QUESTIONARIO_ARQUIVADO' });
    const l = ListaQuestionarios.parse(await amb.chamar(a, 'GET', 'questionarios', { query: { situacao: 'arquivado' } }));
    expect(l.itens.map((i) => i.id)).toEqual([Q]);
  });

  it('questionário inexistente responde 404 sem revelar nada', async () => {
    await expect(amb.chamar(ctx(ANALISTA, 'analista'), 'GET', 'questionarios/:id', { params: { id: uu(1234) } })).rejects.toMatchObject({ status: 404, codigo: 'QUESTIONARIO_NAO_ENCONTRADO' });
  });
});

describe('multi-tenant: um tenant nunca vê o questionário nem as respostas de outro', () => {
  it('tenant B não acha o questionário do A (404), a lista vem vazia e o pull não traz nada', async () => {
    await publicarV1();
    const b = amb.contexto({ id: uu(2), perfil: 'analista', tenant: TENANT_B, agora });
    await expect(amb.chamar(b, 'GET', 'questionarios/:id', { params: { id: Q } })).rejects.toMatchObject({ status: 404 });
    expect(ListaQuestionarios.parse(await amb.chamar(b, 'GET', 'questionarios')).itens).toEqual([]);
    const vendedorB = amb.contexto({ id: VENDEDOR, perfil: 'vendedor', tenant: TENANT_B, agora });
    expect(await amb.pull(vendedorB, 'questionario_versao', horizonte())).toEqual([]);
  });

  it('push no tenant B para o questionário do A é rejeitado (QUESTIONARIO_INEXISTENTE) e nada é gravado no A', async () => {
    const pub = await publicarV1();
    const vendedorB = amb.contexto({ id: VENDEDOR, perfil: 'vendedor', tenant: TENANT_B, agora });
    const [r] = await amb.push(vendedorB, [item(envio(pub.versao.id))]);
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'QUESTIONARIO_INEXISTENTE' });
    expect(await amb.pull(ctx(VENDEDOR, 'vendedor'), 'resposta_pesquisa', horizonte())).toEqual([]);
  });
});

describe('RF-PES-03/04: sync — o aparelho baixa as publicadas e envia respostas offline', () => {
  it('RN-PES-01: o pull de questionario_versao traz só publicadas; rascunho nunca desce', async () => {
    const pub = await publicarV1();
    await amb.chamar(ctx(ANALISTA, 'analista'), 'PUT', 'questionarios/:id/rascunho', { params: { id: Q }, corpo: { titulo: 'Rascunho v2' } });
    const linhas = (await amb.pull(ctx(VENDEDOR, 'vendedor'), 'questionario_versao', horizonte())).map((l) => QuestionarioVersaoSync.parse(l));
    expect(linhas.map((l) => [l.id, l.status, l.arquivado_em])).toEqual([[pub.versao.id, 'publicada', null]]);
  });

  it('RF-PES-05: arquivar faz a versão descer de novo com arquivado_em (cursor anda)', async () => {
    await publicarV1();
    const [primeira] = await amb.pull(ctx(VENDEDOR, 'vendedor'), 'questionario_versao', horizonte());
    relogio.avancar({ minutos: 1 });
    await amb.chamar(ctx(ANALISTA, 'analista'), 'POST', 'questionarios/:id/arquivar', { params: { id: Q } });
    const depois = await amb.pull(ctx(VENDEDOR, 'vendedor'), 'questionario_versao', horizonte(), { updated_at: primeira!.updated_at, id: primeira!.id });
    expect(depois.map((l) => QuestionarioVersaoSync.parse(l).arquivado_em)).toEqual([expect.any(String)]);
  });

  it('RF-PES-04: resposta aceita grava, liga a foto (ADR 0010) e publica pesquisa.resposta.registrada@1 uma vez', async () => {
    const pub = await publicarV1();
    const e = envio(pub.versao.id);
    const v = ctx(VENDEDOR, 'vendedor', { carteira: new Set([CLIENTE]) });
    expect(await amb.push(v, [item(e)])).toEqual([{ id: e.id, status: 'aceito', em: expect.any(String) }]);
    expect(amb.efeitos.arquivos).toEqual([{ id: uu(7001), finalidade: 'pesquisa_foto', entidade: 'resposta_pesquisa', entidade_id: e.id, cliente_id: CLIENTE, tipo: 'image/jpeg' }]);
    expect(amb.efeitos.eventos).toHaveLength(1);
    expect(amb.efeitos.eventos[0]!.nome).toBe('pesquisa.resposta.registrada@1');
    expect(RespostaRegistradaV1.parse(amb.efeitos.eventos[0]!.payload)).toMatchObject({ resposta_id: e.id, usuario_id: VENDEDOR, cliente_id: CLIENTE, total_itens: 2, suspeita: false });
    // reenvio do mesmo lote: aceito de novo, sem evento novo
    expect(await amb.push(v, [item(e)])).toEqual([{ id: e.id, status: 'aceito', em: expect.any(String) }]);
    expect(amb.efeitos.eventos).toHaveLength(1);
  });

  it('RF-PES-04: o mesmo id com outro conteúdo é conflito e não sobrescreve', async () => {
    const pub = await publicarV1();
    const v = ctx(VENDEDOR, 'vendedor');
    await amb.push(v, [item(envio(pub.versao.id))]);
    const outro = envio(pub.versao.id, { itens: [{ pergunta_id: P1, tipo: 'sim_nao', valor: false }] });
    expect(await amb.push(v, [item(outro)])).toEqual([{ id: outro.id, status: 'conflito', mensagem: expect.stringMatching(/não podem ser alteradas/) }]);
  });

  it('RN-CORE-04: resposta ligada a cliente fora da carteira é rejeitada (FORA_DA_CARTEIRA)', async () => {
    const pub = await publicarV1();
    const [r] = await amb.push(ctx(VENDEDOR, 'vendedor', { carteira: new Set([CLIENTE]) }), [item(envio(pub.versao.id, { cliente_id: CLIENTE_FORA }))]);
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'FORA_DA_CARTEIRA' });
    expect(amb.efeitos.eventos).toEqual([]);
  });

  it('doc 03 §2: analista não responde pesquisa (PERFIL_SEM_ACESSO); remover resposta é recusado', async () => {
    const pub = await publicarV1();
    const e = envio(pub.versao.id);
    expect((await amb.push(ctx(ANALISTA, 'analista'), [item(e)]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'PERFIL_SEM_ACESSO' });
    expect((await amb.push(ctx(VENDEDOR, 'vendedor'), [{ ...item(e), operacao: 'remover' }]))[0]).toMatchObject({ status: 'rejeitado', codigo: 'SOMENTE_INSERCAO' });
  });

  it('RF-PES-01: resposta sem a obrigatória é rejeitada com o código do domain', async () => {
    const pub = await publicarV1();
    const [r] = await amb.push(ctx(VENDEDOR, 'vendedor'), [item(envio(pub.versao.id, { itens: [{ pergunta_id: P2, tipo: 'unica', opcao_id: OP_A }] }))]);
    expect(r).toMatchObject({ status: 'rejeitado', codigo: 'RESPOSTA_INVALIDA' });
  });

  it('RN-PES-04: relógio do aparelho adiantado mais de 24 h é aceito e sinalizado', async () => {
    const pub = await publicarV1();
    await amb.push(ctx(VENDEDOR, 'vendedor'), [item(envio(pub.versao.id, { respondida_em: iso(relogio.relativo({ horas: 30 })) }))]);
    expect(RespostaRegistradaV1.parse(amb.efeitos.eventos[0]!.payload).suspeita).toBe(true);
  });

  it('RN-PES-02 / RN-CORE-04: o pull de respostas traz as próprias e as dos clientes da carteira, sem o conteúdo', async () => {
    const pub = await publicarV1();
    await amb.push(ctx(VENDEDOR_2, 'vendedor'), [item(envio(pub.versao.id, { id: uu(5001) }))]);
    await amb.push(ctx(VENDEDOR_2, 'vendedor'), [item(envio(pub.versao.id, { id: uu(5002), cliente_id: CLIENTE_FORA }))]);
    const linhas = (await amb.pull(ctx(VENDEDOR, 'vendedor', { carteira: new Set([CLIENTE]) }), 'resposta_pesquisa', horizonte())).map((l) => RespostaPesquisaSync.parse(l));
    expect(linhas.map((l) => l.id)).toEqual([uu(5001)]);
    expect(linhas[0]).not.toHaveProperty('itens');
  });
});

describe('RF-PES-06: resultados, galeria e exportação no escopo do perfil', () => {
  async function comRespostas() {
    const pub = await publicarV1();
    await amb.push(ctx(VENDEDOR, 'vendedor'), [item(envio(pub.versao.id, { id: uu(5001) }))]);
    await amb.push(ctx(VENDEDOR_2, 'vendedor'), [item(envio(pub.versao.id, { id: uu(5002), itens: [{ pergunta_id: P1, tipo: 'sim_nao', valor: false }, { pergunta_id: P2, tipo: 'unica', opcao_id: OP_B }] }))]);
    return pub;
  }

  it('RF-PES-06: analista vê o consolidado do tenant com a contagem por opção', async () => {
    await comRespostas();
    const r = ResultadoResponse.parse(await amb.chamar(ctx(ANALISTA, 'analista'), 'GET', 'questionarios/:id/resultado', { params: { id: Q } }));
    if (r.tipo !== 'consolidado') throw new Error('esperava consolidado');
    expect(r.resultado.versoes).toEqual([expect.objectContaining({ numero: 1, respostas: 2 })]);
    const p1 = r.resultado.por_versao[0]!.perguntas.find((p) => p.pergunta_id === P1)!;
    expect(p1).toMatchObject({ tipo: 'sim_nao', respondentes: 2, opcoes: [expect.objectContaining({ opcao_id: 'sim', contagem: 1 }), expect.objectContaining({ opcao_id: 'nao', contagem: 1 })] });
  });

  it('RN-CORE-04: supervisor vê só as respostas dos usuários visíveis (a equipe dele)', async () => {
    const pub = await comRespostas();
    const sup = ctx(SUPERVISOR, 'supervisor', { visiveis: new Set([SUPERVISOR, VENDEDOR]) });
    const r = ResultadoResponse.parse(await amb.chamar(sup, 'GET', 'questionarios/:id/resultado', { params: { id: Q }, query: { versao: pub.versao.id } }));
    if (r.tipo !== 'versao') throw new Error('esperava versão');
    expect(r.resultado.total_respostas).toBe(1);
    const lista = (await amb.chamar<{ itens: { usuario_id: string }[] }>(sup, 'GET', 'questionarios/:id/respostas', { params: { id: Q } })).itens;
    expect(lista.map((x) => x.usuario_id)).toEqual([VENDEDOR]);
  });

  it('RF-PES-06: galeria lista as fotos com a pergunta; exportação devolve CSV com BOM e uma linha por resposta', async () => {
    await comRespostas();
    const a = ctx(ANALISTA, 'analista');
    const g = await amb.chamar<{ itens: { foto_id: string; enunciado: string }[] }>(a, 'GET', 'questionarios/:id/galeria', { params: { id: Q } });
    expect(g.itens).toEqual([expect.objectContaining({ foto_id: uu(7001), enunciado: 'Foto da gôndola' })]);
    const x = ExportacaoResponse.parse(await amb.chamar(a, 'GET', 'questionarios/:id/exportar', { params: { id: Q } }));
    expect(x.nome_arquivo).toMatch(/^pesquisa-gondola-do-mes-\d{4}-\d{2}-\d{2}\.csv$/);
    expect(x.conteudo.startsWith('\uFEFF')).toBe(true);
    expect(x.conteudo.trimEnd().split('\r\n')).toHaveLength(3);
  });

  it('RF-PES-06: filtro por versão inexistente responde 422 com a ação seguinte', async () => {
    await comRespostas();
    await expect(amb.chamar(ctx(ANALISTA, 'analista'), 'GET', 'questionarios/:id/resultado', { params: { id: Q }, query: { versao: uu(4321) } })).rejects.toMatchObject({ status: 422, codigo: 'VERSAO_INEXISTENTE' });
  });

  it('RF-PES-06: filtro de período em dia civil do fuso do tenant (dia seguinte fica vazio)', async () => {
    await comRespostas();
    const amanha = relogio.dia(1);
    const r = ResultadoResponse.parse(await amb.chamar(ctx(ANALISTA, 'analista'), 'GET', 'questionarios/:id/resultado', { params: { id: Q }, query: { de: amanha, ate: amanha } }));
    expect(r.tipo === 'consolidado' && r.resultado.versoes[0]!.respostas).toBe(0);
  });
});
