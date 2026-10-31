import { describe, expect, it } from 'vitest';
import { criarPrimeiraVersao, editarRascunho, iniciarEdicao, podeAlterarVersao, publicarVersao, validarVersao, versaoDaResposta, versaoVigente } from './questionario';
import { PARAMETROS_PADRAO } from './parametros';
import { QUEST, TENANT, envio, escala, foto, item, multipla, publicada, regra, sim_nao, texto, u, unica, versao } from './util-teste';
import type { Questionario } from '../contracts';

const AGORA = '2026-10-31T13:00:00Z';
const q: Questionario = { id: QUEST, tenant_id: TENANT, criado_em: '2026-10-01T00:00:00Z', arquivado_em: null };
const codigos = (xs: { codigo: string }[]) => xs.map((x) => x.codigo);

describe('RN-PES-01 / RF-PES-05: ciclo de vida da versão', () => {
  it('RF-PES-05: o questionário nasce como rascunho da versão 1, vazio e editável', () => {
    const v = criarPrimeiraVersao({ id: u(1), questionario_id: QUEST, tenant_id: TENANT, titulo: 'Satisfação', agora: AGORA });
    expect(v).toMatchObject({ numero: 1, status: 'rascunho', perguntas: [], regras: [], publicada_em: null, publicada_por: null, vigencia: { inicio: AGORA, fim: null } });
  });

  it('RF-PES-01: rascunho é editável', () => {
    const r = editarRascunho(versao(), { titulo: 'Novo título', perguntas: [sim_nao(1), texto(2)] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.valor).toMatchObject({ titulo: 'Novo título', numero: 1, status: 'rascunho' });
  });

  it('RN-PES-01: publicar congela a versão (data, autor e objeto imutável)', () => {
    const r = publicarVersao(versao({ perguntas: [sim_nao(1)] }), { agora: AGORA, publicado_por: u(1000) });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor).toMatchObject({ status: 'publicada', publicada_em: AGORA, publicada_por: u(1000) });
    expect(Object.isFrozen(r.valor)).toBe(true);
    expect(Object.isFrozen(r.valor.perguntas[0])).toBe(true);
    expect(() => {
      (r.valor as { titulo: string }).titulo = 'trocado';
    }).toThrow();
  });

  it('RN-PES-01: versão publicada NÃO pode ser editada (VERSAO_PUBLICADA_IMUTAVEL)', () => {
    const r = editarRascunho(publicada(), { titulo: 'Outro' });
    expect(r).toMatchObject({ ok: false, codigo: 'VERSAO_PUBLICADA_IMUTAVEL' });
    if (!r.ok) expect(r.mensagem).toMatch(/nova versão/);
    expect(podeAlterarVersao(publicada())).toMatchObject({ ok: false, codigo: 'VERSAO_PUBLICADA_IMUTAVEL' });
    expect(podeAlterarVersao(versao()).ok).toBe(true);
  });

  it('RN-PES-01: publicar duas vezes a mesma versão é recusado', () => {
    expect(publicarVersao(publicada(), { agora: AGORA, publicado_por: u(1000) })).toMatchObject({ ok: false, codigo: 'VERSAO_PUBLICADA_IMUTAVEL' });
  });

  it('RF-PES-05: editar uma versão publicada cria a versão 2 em rascunho, copiando o conteúdo', () => {
    const v1 = publicada({ perguntas: [sim_nao(1), texto(2)] });
    const r = iniciarEdicao([v1], { novo_id: u(701), agora: AGORA });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.valor.criada).toBe(true);
    expect(r.valor.versao).toMatchObject({ id: u(701), numero: 2, status: 'rascunho', publicada_em: null, titulo: v1.titulo });
    expect(r.valor.versao.perguntas.map((p) => p.id)).toEqual([u(1), u(2)]);
    expect(Object.isFrozen(r.valor.versao)).toBe(false);
    expect(v1.status).toBe('publicada');
  });

  it('RF-PES-05: a edição copia, não compartilha — mexer no rascunho não altera a publicada', () => {
    const v1 = publicada({ perguntas: [texto(2)] });
    const r = iniciarEdicao([v1], { novo_id: u(701), agora: AGORA });
    if (!r.ok) throw new Error('esperado ok');
    expect(r.valor.versao.perguntas).not.toBe(v1.perguntas);
    expect(r.valor.versao.perguntas[0]).not.toBe(v1.perguntas[0]);
  });

  it('RF-PES-05: já existindo um rascunho, continua nele (só um rascunho por vez)', () => {
    const v1 = publicada();
    const rascunho = versao({ id: u(701), numero: 2 });
    const r = iniciarEdicao([v1, rascunho], { novo_id: u(702), agora: AGORA });
    expect(r).toMatchObject({ ok: true, valor: { criada: false, versao: { id: u(701) } } });
  });

  it('RF-PES-05: a numeração segue a maior versão (3 depois de 2 publicada)', () => {
    const r = iniciarEdicao([publicada({ numero: 1 }), publicada({ id: u(701), numero: 2 })], { novo_id: u(702), agora: AGORA });
    expect(r).toMatchObject({ ok: true, valor: { versao: { numero: 3 } } });
  });

  it('RF-PES-05: sem versão nenhuma não há o que editar', () => {
    expect(iniciarEdicao([], { novo_id: u(1), agora: AGORA })).toMatchObject({ ok: false, codigo: 'SEM_VERSAO' });
  });

  it('RN-PES-01: a versão vigente é a publicada de maior número; rascunho nunca é oferecido', () => {
    const v1 = publicada({ numero: 1 });
    const v2 = publicada({ id: u(701), numero: 2 });
    const v3 = versao({ id: u(702), numero: 3 });
    expect(versaoVigente(q, [v1, v3, v2])!.id).toBe(u(701));
    expect(versaoVigente(q, [v3])).toBeNull();
  });

  it('RN-PES-01: questionário arquivado não tem versão vigente', () => {
    expect(versaoVigente({ ...q, arquivado_em: AGORA }, [publicada()])).toBeNull();
  });

  it('RN-PES-01: publicar versão mais antiga que uma já publicada é recusado', () => {
    const nova = versao({ id: u(701), numero: 1, perguntas: [sim_nao(1)] });
    const r = publicarVersao(nova, { agora: AGORA, publicado_por: u(1000), outras_versoes: [publicada({ numero: 2 })] });
    expect(r).toMatchObject({ ok: false, codigo: 'VERSAO_ANTIGA' });
  });

  it('RN-PES-01: respostas guardam a versão — a resposta aponta a versão pelo id, mesmo havendo uma mais nova', () => {
    const v1 = publicada({ numero: 1 });
    const v2 = publicada({ id: u(701), numero: 2 });
    expect(versaoDaResposta([v1, v2], envio([item.simNao(1, true)]))).toMatchObject({ ok: true, valor: { numero: 1 } });
    expect(versaoDaResposta([v1, v2], envio([item.simNao(1, true)], { versao_id: u(701) }))).toMatchObject({ ok: true, valor: { numero: 2 } });
  });

  it('RN-PES-01: resposta para versão que não existe ou de outro questionário é recusada', () => {
    expect(versaoDaResposta([publicada()], envio([item.simNao(1, true)], { versao_id: u(555) }))).toMatchObject({ ok: false, codigo: 'VERSAO_INEXISTENTE' });
    expect(versaoDaResposta([publicada()], envio([item.simNao(1, true)], { questionario_id: u(556) }))).toMatchObject({ ok: false, codigo: 'VERSAO_INEXISTENTE' });
  });

  it('RN-PES-01: resposta para rascunho é recusada (VERSAO_NAO_PUBLICADA)', () => {
    expect(versaoDaResposta([versao()], envio([item.simNao(1, true)]))).toMatchObject({ ok: false, codigo: 'VERSAO_NAO_PUBLICADA' });
  });
});

describe('RF-PES-01: validação do questionário para publicar', () => {
  it('RF-PES-01: questionário válido não tem erro', () => {
    expect(validarVersao(versao({ perguntas: [sim_nao(1), texto(2)] }), PARAMETROS_PADRAO).erros).toEqual([]);
  });

  it('RF-PES-01: sem pergunta não publica (SEM_PERGUNTAS)', () => {
    const r = publicarVersao(versao({ perguntas: [] }), { agora: AGORA, publicado_por: u(1000) });
    expect(r).toMatchObject({ ok: false, codigo: 'VERSAO_INVALIDA' });
    if (!r.ok) expect(codigos([...(r.detalhes ?? [])])).toContain('SEM_PERGUNTAS');
  });

  it('RF-PES-01: ids de pergunta e de opção repetidos são recusados', () => {
    const v = versao({ perguntas: [sim_nao(1), sim_nao(1)] });
    expect(codigos(validarVersao(v, PARAMETROS_PADRAO).erros)).toContain('IDS_REPETIDOS');
    const w = versao({ perguntas: [unica(1, [101, 101])] });
    expect(codigos(validarVersao(w, PARAMETROS_PADRAO).erros)).toContain('IDS_REPETIDOS');
  });

  it('RN-PES-07: limite de perguntas e de opções vem dos parâmetros do tenant', () => {
    const muitas = Array.from({ length: 51 }, (_, i) => sim_nao(i + 1));
    expect(codigos(validarVersao(versao({ perguntas: muitas }), PARAMETROS_PADRAO).erros)).toContain('LIMITE_PERGUNTAS');
    const opcoes = Array.from({ length: 21 }, (_, i) => 100 + i);
    expect(codigos(validarVersao(versao({ perguntas: [unica(1, opcoes)] }), PARAMETROS_PADRAO).erros)).toContain('LIMITE_OPCOES');
    expect(codigos(validarVersao(versao({ perguntas: [unica(1, opcoes)] }), { ...PARAMETROS_PADRAO, max_opcoes_por_pergunta: 25 }).erros)).not.toContain('LIMITE_OPCOES');
  });

  it('RN-PES-07: escala com amplitude acima do limite e foto com mais fotos que o tenant permite são recusadas', () => {
    expect(codigos(validarVersao(versao({ perguntas: [escala(1, { minimo: 0, maximo: 11 })] }), PARAMETROS_PADRAO).erros)).toContain('ESCALA_AMPLITUDE');
    expect(codigos(validarVersao(versao({ perguntas: [escala(1, { minimo: 0, maximo: 10 })] }), PARAMETROS_PADRAO).erros)).not.toContain('ESCALA_AMPLITUDE');
    expect(codigos(validarVersao(versao({ perguntas: [foto(1, { max_fotos: 11 })] }), PARAMETROS_PADRAO).erros)).toContain('FOTOS_ACIMA_DO_LIMITE');
  });

  it('RF-PES-01: múltipla com mínimo maior que as opções ou máximo menor que o mínimo é recusada', () => {
    const p = multipla(1, [201, 202], { min_selecoes: 3 });
    expect(codigos(validarVersao(versao({ perguntas: [p] }), PARAMETROS_PADRAO).erros)).toContain('SELECOES_INVALIDAS');
  });

  it('RF-PES-02: vigência com fim antes do início é recusada', () => {
    const v = versao({ perguntas: [sim_nao(1)], vigencia: { inicio: '2026-11-10T00:00:00Z', fim: '2026-11-01T00:00:00Z' } });
    expect(codigos(validarVersao(v, PARAMETROS_PADRAO).erros)).toContain('VIGENCIA_INVALIDA');
  });

  it('RF-PES-02: publicar com a vigência já encerrada é recusado (VIGENCIA_ENCERRADA)', () => {
    const v = versao({ perguntas: [sim_nao(1)], vigencia: { inicio: '2026-09-01T00:00:00Z', fim: '2026-10-01T00:00:00Z' } });
    const r = publicarVersao(v, { agora: AGORA, publicado_por: u(1000) });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(codigos([...(r.detalhes ?? [])])).toContain('VIGENCIA_ENCERRADA');
  });

  it('RF-PES-01: regra com ciclo ou referência a pergunta posterior impede a publicação; inalcançável só avisa', () => {
    const ps = [sim_nao(1), sim_nao(2)];
    const ruim = versao({ perguntas: ps, regras: [regra(10, 1, 2, 'igual', true)] });
    expect(publicarVersao(ruim, { agora: AGORA, publicado_por: u(1000) })).toMatchObject({ ok: false, codigo: 'VERSAO_INVALIDA' });
    const aviso = versao({ perguntas: [escala(1), sim_nao(2)], regras: [regra(10, 2, 1, 'igual', 9)] });
    const v = validarVersao(aviso, PARAMETROS_PADRAO);
    expect(v.erros).toEqual([]);
    expect(codigos(v.avisos)).toContain('PERGUNTA_INALCANCAVEL');
    expect(publicarVersao(aviso, { agora: AGORA, publicado_por: u(1000) }).ok).toBe(true);
  });

  it('RF-PES-02: público vazio avisa que vale para todo o tenant; rótulos repetidos de opção avisam', () => {
    const v = validarVersao(versao({ perguntas: [sim_nao(1)] }), PARAMETROS_PADRAO);
    expect(codigos(v.avisos)).toContain('PUBLICO_ABERTO');
    const p = unica(1, [101, 102]);
    if (p.tipo === 'unica') p.opcoes[1]!.rotulo = p.opcoes[0]!.rotulo;
    expect(codigos(validarVersao(versao({ perguntas: [p] }), PARAMETROS_PADRAO).avisos)).toContain('ROTULOS_REPETIDOS');
  });
});
