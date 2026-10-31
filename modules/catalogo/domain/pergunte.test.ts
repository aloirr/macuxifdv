import { describe, expect, it } from 'vitest';
import { RespostaCatalogo, type FonteCatalogo } from '../contracts';
import { PARAMETROS_PADRAO, resolverParametros } from './parametros';
import { INSTRUCAO_PERGUNTE, montarContextoPergunte, montarMensagemPergunte, NAO_ENCONTREI, validarRespostaPergunte } from './pergunte';

const fonte = (o: Partial<FonteCatalogo> & { id: string }): FonteCatalogo => ({
  tenant_id: 't1',
  type: 'faq',
  product_id: 'p1',
  title: 'Título',
  text: 'Texto',
  updated_at: null,
  ...o,
});
const FONTES: FonteCatalogo[] = [
  fonte({ id: 'f-validade', type: 'faq', product_id: 'p1', title: 'Qual a validade?', text: 'O detergente dura 24 meses fechado.' }),
  fonte({ id: 'f-ficha', type: 'ficha', product_id: 'p1', title: 'Ficha técnica', text: 'Detergente neutro 5 litros, biodegradável.' }),
  fonte({ id: 'f-outro', type: 'faq', product_id: 'p2', title: 'Diluição do amaciante', text: 'Dilua 1 para 3 em água.' }),
  fonte({ id: 'f-manual', type: 'documento', product_id: null, title: 'Manual de armazenagem', text: 'Armazene longe do sol, em local arejado.' }),
  fonte({ id: 'f-t2', tenant_id: 't2', type: 'faq', product_id: 'p1', title: 'Validade (outro tenant)', text: 'O detergente dura 99 meses.' }),
];
const montar = (pergunta: string, extra: Partial<Parameters<typeof montarContextoPergunte>[0]> = {}) =>
  montarContextoPergunte({ tenant_id: 't1', pergunta, fontes: FONTES, parametros: PARAMETROS_PADRAO, ...extra });

describe('RN-CAT-02: contexto do "Pergunte ao catálogo"', () => {
  it('RN-CAT-02: o contexto só tem fontes do tenant — fonte de outro tenant nunca entra, e a descarte é contado', () => {
    const c = montar('Quanto tempo dura o detergente?');
    expect(c.fontes.map((f) => f.id)).not.toContain('f-t2');
    expect(c.fontes.map((f) => f.id)).toContain('f-validade');
    expect(c.descartadas_outro_tenant).toBe(1);
  });

  it('RN-CAT-02: perguntas sobre um produto usam só o conteúdo desse produto', () => {
    const c = montar('Como diluir?', { produto_id: 'p1' });
    expect(c.fontes.map((f) => f.id).sort()).toEqual(['f-ficha', 'f-validade']);
    expect(c.vazio).toBe(false);
  });

  it('RN-CAT-02: para um produto a pergunta pode usar palavras diferentes das da ficha (a seleção não depende só de palavras iguais)', () => {
    const c = montar('Qual o prazo?', { produto_id: 'p1' });
    expect(c.fontes.length).toBe(2);
  });

  it('RN-CAT-02: sem produto, escolhe pelas palavras da pergunta (o manual geral entra, o resto não)', () => {
    const c = montar('Onde armazenar o produto?');
    expect(c.fontes.map((f) => f.id)).toEqual(['f-manual']);
  });

  it('RN-CAT-02: sem nenhuma fonte relevante o contexto fica vazio (a API não chama o LLM)', () => {
    expect(montar('Quantos gols o Brasil fez?').vazio).toBe(true);
    expect(montar('Qual a validade?', { produto_id: 'sem-conteudo' }).vazio).toBe(true);
    expect(montar('Como?').vazio).toBe(true);
  });

  it('RN-CAT-02: nota semântica (embeddings) pode trazer fonte sem palavra em comum', () => {
    const c = montar('Quanto tempo posso guardar?', { semantica: new Map([['f-validade', 0.8]]) });
    expect(c.fontes.map((f) => f.id)).toContain('f-validade');
  });

  it('RN-CAT-02: cada fonte recebe uma referência curta (F1, F2…) e o texto original', () => {
    const c = montar('Quanto tempo dura o detergente?', { produto_id: 'p1' });
    expect(c.fontes.map((f) => f.ref)).toEqual(['F1', 'F2']);
    expect(c.fontes[0]!.text.length).toBeGreaterThan(0);
  });

  it('RN-CAT-02: respeita o máximo de fontes e o orçamento de caracteres do tenant', () => {
    const muitas = Array.from({ length: 20 }, (_, i) => fonte({ id: `x${i}`, title: 'Detergente', text: `Detergente ${'a'.repeat(100)} ${i}` }));
    const c = montarContextoPergunte({ tenant_id: 't1', pergunta: 'detergente', fontes: muitas, parametros: resolverParametros({ pergunte_max_fontes: 3 }) });
    expect(c.fontes).toHaveLength(3);
    const pequeno = montarContextoPergunte({ tenant_id: 't1', pergunta: 'detergente', fontes: muitas, parametros: resolverParametros({ pergunte_max_caracteres: 250 }) });
    expect(pequeno.fontes.reduce((n, f) => n + f.text.length, 0)).toBeLessThanOrEqual(250);
    expect(pequeno.fontes.length).toBeGreaterThan(0);
  });

  it('RN-CAT-02: ordem determinística (mais relevante, depois ficha antes de FAQ e documento, depois id)', () => {
    const a = montar('detergente validade', { produto_id: 'p1' });
    const b = montarContextoPergunte({ tenant_id: 't1', pergunta: 'detergente validade', produto_id: 'p1', fontes: [...FONTES].reverse(), parametros: PARAMETROS_PADRAO });
    expect(a.fontes.map((f) => f.id)).toEqual(b.fontes.map((f) => f.id));
  });

  it('RN-CAT-02: a instrução manda responder só com as fontes, citar e dizer "não encontrei" quando faltar base', () => {
    expect(INSTRUCAO_PERGUNTE).toMatch(/somente/i);
    expect(INSTRUCAO_PERGUNTE).toMatch(/\[F1\]/);
    expect(INSTRUCAO_PERGUNTE).toMatch(/não encontrei/i);
  });

  it('a mensagem para o LLM traz as fontes numeradas e a pergunta', () => {
    const c = montar('Como diluir?', { produto_id: 'p1' });
    const m = montarMensagemPergunte(c, 'Como diluir?');
    expect(m).toContain('[F1]');
    expect(m).toContain('Pergunta: Como diluir?');
    expect(m).toContain('Ficha técnica');
  });
});

describe('RN-CAT-02: validação da resposta do LLM', () => {
  const ctx = () => montar('Quanto tempo dura o detergente?', { produto_id: 'p1' });
  const validar = (bruto: unknown, extra: Partial<Parameters<typeof validarRespostaPergunte>[0]> = {}) =>
    validarRespostaPergunte({ tenant_id: 't1', contexto: ctx(), bruto, fontesConhecidas: FONTES, ...extra });

  it('RN-CAT-02: resposta com fonte do contexto é aceita e devolve as fontes citadas (sem o texto completo)', () => {
    const r = validar({ resposta: 'Dura 24 meses fechado [F1].', fontes: ['f-validade'] });
    expect(r.ok).toBe(true);
    expect(r.resposta).toMatchObject({ found: true, answer: 'Dura 24 meses fechado [F1].' });
    expect(r.resposta.sources).toEqual([{ id: 'f-validade', type: 'faq', title: 'Qual a validade?', product_id: 'p1' }]);
    expect(RespostaCatalogo.safeParse(r.resposta).success).toBe(true);
  });

  it('RN-CAT-02: a fonte pode ser citada pela referência (F1) ou pelo id, sem repetir', () => {
    const c = ctx();
    const ref = c.fontes[0]!.ref;
    const r = validarRespostaPergunte({ tenant_id: 't1', contexto: c, bruto: { resposta: 'Sim.', fontes: [ref, c.fontes[0]!.id, { id: c.fontes[0]!.id, tenant_id: 't1' }] } });
    expect(r.ok && r.resposta.sources).toHaveLength(1);
  });

  it('RN-CAT-02: resposta sem fonte é rejeitada e vira "não encontrei"', () => {
    const r = validar({ resposta: 'Dura uns dois anos.', fontes: [] });
    expect(r).toMatchObject({ ok: false, motivo: 'sem_fonte' });
    expect(r.resposta).toEqual({ found: false, answer: NAO_ENCONTREI, sources: [] });
  });

  it('RN-CAT-02: fonte que não está no contexto é rejeitada', () => {
    expect(validar({ resposta: 'Dura 24 meses.', fontes: ['f-inexistente'] })).toMatchObject({ ok: false, motivo: 'fonte_inexistente' });
    expect(validar({ resposta: 'Dilua 1 para 3.', fontes: ['f-outro'] })).toMatchObject({ ok: false, motivo: 'fonte_inexistente' });
  });

  it('RN-CAT-02: fonte de outro tenant é rejeitada, inclusive quando só o id aparece na base geral', () => {
    expect(validar({ resposta: 'Dura 99 meses.', fontes: ['f-t2'] })).toMatchObject({ ok: false, motivo: 'fonte_de_outro_tenant' });
    expect(validar({ resposta: 'Dura 99 meses.', fontes: [{ id: 'f-validade', tenant_id: 't2' }] })).toMatchObject({ ok: false, motivo: 'fonte_de_outro_tenant' });
  });

  it('RN-CAT-02: uma fonte ruim entre as boas rejeita a resposta toda', () => {
    expect(validar({ resposta: 'Dura 24 meses.', fontes: ['f-validade', 'f-t2'] }).ok).toBe(false);
  });

  it('RN-CAT-02: marcação [F9] no texto sem fonte correspondente é rejeitada', () => {
    expect(validar({ resposta: 'Dura 24 meses [F9].', fontes: ['f-validade'] })).toMatchObject({ ok: false, motivo: 'fonte_inexistente' });
  });

  it('RN-CAT-02: "não encontrei" do próprio LLM é resposta válida, sem fonte', () => {
    const r = validar({ nao_encontrei: true, resposta: '', fontes: [] });
    expect(r).toMatchObject({ ok: true });
    expect(r.resposta).toEqual({ found: false, answer: NAO_ENCONTREI, sources: [] });
    expect(validar({ resposta: 'Não encontrei essa informação na base.', fontes: [] }).resposta.found).toBe(false);
  });

  it('RN-CAT-02: resposta vazia ou fora do formato é rejeitada com o texto padrão', () => {
    expect(validar({ resposta: '   ', fontes: ['f-validade'] })).toMatchObject({ ok: false, motivo: 'resposta_vazia' });
    expect(validar('texto solto')).toMatchObject({ ok: false, motivo: 'resposta_invalida' });
    expect(validar(null).resposta.answer).toBe(NAO_ENCONTREI);
  });

  it('RN-CAT-02: o texto padrão de "não encontrei" é claro e em português', () => {
    expect(NAO_ENCONTREI).toBe('Não encontrei essa informação na base do catálogo.');
  });
});
