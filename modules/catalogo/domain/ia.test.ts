import { describe, expect, it } from 'vitest';
import type { FiltrosInterpretados } from '../contracts';
import { AVISO_BUSCA_FALHOU, AVISO_BUSCA_OFFLINE, ErroTempoEsgotadoIa, interpretarBusca, mesclarFiltros, validarFiltrosLlm, type EntradaInterpretacao, type PortaInterpretacaoLlm } from './ia';
import { interpretarConsulta, type VocabularioTenant } from './consulta';
import { MENSAGEM_LIMITE_ATINGIDO, registrarDesfechoIa, verificarConsultaIa } from './limite-ia';
import { PARAMETROS_PADRAO } from './parametros';

const vocab: VocabularioTenant = { marcas: ['Limpex', 'Ypê'], linhas: ['Detergentes', 'Amaciantes'] };

/** Implementação falsa da porta de LLM: devolve uma resposta pronta (ou falha) e registra as chamadas. */
class LlmFalso implements PortaInterpretacaoLlm {
  chamadas: EntradaInterpretacao[] = [];
  constructor(private readonly resposta: unknown | Error) {}
  async interpretar(entrada: EntradaInterpretacao): Promise<unknown> {
    this.chamadas.push(entrada);
    if (this.resposta instanceof Error) throw this.resposta;
    return this.resposta;
  }
}
const vazio: FiltrosInterpretados = { text: '', brand: null, line: null, min_price_cents: null, max_price_cents: null, stock: null, code: null, measures: [], sort: null };
const llm = (o: Partial<FiltrosInterpretados>) => ({ ...vazio, ...o });
const base = { tenant_id: 't1', vocabulario: vocab, ia: { permitido: true, mensagem: null as string | null }, online: true };

describe('RN-CAT-01: validação do que o LLM devolve', () => {
  it('RN-CAT-01: marca e categoria que o tenant não tem são descartadas; as que têm voltam na grafia cadastrada', () => {
    const r = validarFiltrosLlm(llm({ brand: 'LIMPEX', line: 'detergente', text: 'neutro' }), vocab);
    expect(r).toMatchObject({ brand: 'Limpex', line: 'Detergentes', text: 'neutro' });
    expect(validarFiltrosLlm(llm({ brand: 'Inventada', line: 'Eletrônicos' }), vocab)).toMatchObject({ brand: null, line: null });
  });

  it('RN-CAT-01: resposta fora do formato (lixo, preço fracionado, faixa invertida) é descartada inteira', () => {
    expect(validarFiltrosLlm('texto solto', vocab)).toBeNull();
    expect(validarFiltrosLlm(null, vocab)).toBeNull();
    expect(validarFiltrosLlm({ max_price_cents: 10.5 }, vocab)).toBeNull();
    expect(validarFiltrosLlm({ min_price_cents: 900, max_price_cents: 100 }, vocab)).toBeNull();
  });

  it('RF-CAT-02: EAN do LLM só vale com dígito verificador correto', () => {
    expect(validarFiltrosLlm(llm({ code: { type: 'ean', value: '7891000100104' } }), vocab)?.code).toBeNull();
    expect(validarFiltrosLlm(llm({ code: { type: 'ean', value: '7891000100103' } }), vocab)?.code).toEqual({ type: 'ean', value: '7891000100103' });
  });

  it('o texto devolvido pelo LLM passa pela mesma normalização da busca', () => {
    expect(validarFiltrosLlm(llm({ text: 'Detergentes NEUTROS 5 litros' }), vocab)?.text).toBe('detergente neutro 5000ml');
  });
});

describe('RF-CAT-01: mesclagem de regras locais com o LLM', () => {
  it('RF-CAT-01: o que a frase diz de forma explícita (regras) vence o LLM; o LLM completa o que faltou', () => {
    const regras = interpretarConsulta('detergente até R$ 10', vocab);
    const m = mesclarFiltros(regras, llm({ text: 'detergente', max_price_cents: 5000, brand: 'Limpex', stock: 'com' }));
    expect(m).toMatchObject({ max_price_cents: 1000, brand: 'Limpex', stock: 'com', text: 'detergente' });
  });

  it('RF-CAT-02: código exato das regras nunca é trocado pelo LLM', () => {
    const regras = interpretarConsulta('7891000100103', vocab);
    const m = mesclarFiltros(regras, llm({ code: { type: 'sku', value: 'OUTRO1' }, text: 'x' }));
    expect(m.code).toEqual({ type: 'ean', value: '7891000100103' });
  });

  it('faixa de preço resultante da mistura nunca fica invertida', () => {
    const regras = interpretarConsulta('detergente até R$ 10', vocab);
    const m = mesclarFiltros(regras, llm({ min_price_cents: 5000 }));
    expect(FiltrosLimpos(m)).toBe(true);
  });

  it('LLM sem texto e sem filtros mantém o texto das regras', () => {
    const m = mesclarFiltros(interpretarConsulta('detergente neutro', vocab), vazio);
    expect(m.text).toBe('detergente neutro');
  });
});
const FiltrosLimpos = (f: FiltrosInterpretados) => f.min_price_cents === null || f.max_price_cents === null || f.min_price_cents <= f.max_price_cents;

describe('RF-CAT-01 / RF-CAT-02: busca inteligente atrás da porta de LLM (com contingência)', () => {
  it('RF-CAT-01: com a porta disponível, o LLM interpreta e a origem é "llm"', async () => {
    const porta = new LlmFalso(llm({ text: 'detergente neutro', brand: 'Limpex', stock: 'com' }));
    const r = await interpretarBusca({ ...base, porta, texto: 'aquele detergente neutro da limpex que tenha' });
    expect(r).toMatchObject({ origem: 'llm', chamouProvedor: true, aviso: null });
    expect(r.filtros).toMatchObject({ brand: 'Limpex', stock: 'com', text: 'detergente neutro' });
    expect(porta.chamadas).toEqual([{ tenant_id: 't1', texto: 'aquele detergente neutro da limpex que tenha', marcas: ['Limpex', 'Ypê'], linhas: ['Detergentes', 'Amaciantes'] }]);
  });

  it('RN-CAT-03: limite atingido — não chama o provedor, usa as regras e explica', async () => {
    const porta = new LlmFalso(llm({}));
    const r = await interpretarBusca({ ...base, porta, ia: { permitido: false, mensagem: MENSAGEM_LIMITE_ATINGIDO }, texto: 'detergente com estoque' });
    expect(porta.chamadas).toHaveLength(0);
    expect(r).toMatchObject({ origem: 'regras', chamouProvedor: false, aviso: MENSAGEM_LIMITE_ATINGIDO });
    expect(r.filtros.stock).toBe('com');
  });

  it('RF-CAT-02: offline — nada de provedor, regras locais e aviso discreto', async () => {
    const porta = new LlmFalso(llm({}));
    const r = await interpretarBusca({ ...base, porta, online: false, texto: 'detergente' });
    expect(porta.chamadas).toHaveLength(0);
    expect(r).toMatchObject({ origem: 'regras', aviso: AVISO_BUSCA_OFFLINE, chamouProvedor: false });
    expect(AVISO_BUSCA_OFFLINE).toBe('A busca inteligente volta quando houver internet.');
  });

  it('RF-CAT-01: sem porta configurada o resultado é o das regras, sem erro', async () => {
    const r = await interpretarBusca({ ...base, porta: null, texto: 'detergente até 10 reais' });
    expect(r).toMatchObject({ origem: 'regras', chamouProvedor: false });
    expect(r.filtros.max_price_cents).toBe(1000);
  });

  it('RN-CAT-03: o provedor falhou — contingência pelas regras, aviso em português, e NÃO consome a cota', async () => {
    const porta = new LlmFalso(new Error('falha no provedor'));
    const r = await interpretarBusca({ ...base, porta, texto: 'detergente em estoque' });
    expect(r).toMatchObject({ origem: 'regras', chamouProvedor: true, aviso: AVISO_BUSCA_FALHOU, desfecho: 'erro', consomeCota: false });
    expect(r.filtros.stock).toBe('com');
  });

  it('RN-CAT-03: tempo esgotado (erro de timeout da porta ou tempo_limite_ms) — regras, aviso e NÃO consome a cota', async () => {
    const timeout = Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
    for (const erro of [new ErroTempoEsgotadoIa(), timeout]) {
      const r = await interpretarBusca({ ...base, porta: new LlmFalso(erro), texto: 'detergente' });
      expect(r).toMatchObject({ origem: 'regras', aviso: AVISO_BUSCA_FALHOU, desfecho: 'tempo_esgotado', consomeCota: false });
    }
    const lento: PortaInterpretacaoLlm = { interpretar: () => new Promise((ok) => setTimeout(() => ok(llm({ brand: 'Limpex' })), 200)) };
    const r = await interpretarBusca({ ...base, porta: lento, texto: 'detergente', tempo_limite_ms: 10 });
    expect(r).toMatchObject({ origem: 'regras', desfecho: 'tempo_esgotado', consomeCota: false });
    expect(r.filtros.brand).toBeNull();
  });

  it('RN-CAT-03: consulta respondida pelo provedor consome a cota (fluxo completo: verificar → interpretar → registrar)', async () => {
    const agora = '2026-10-31T15:00:00Z';
    let uso = { dia: '2026-10-31', consultas: 5 };
    const ok = await interpretarBusca({ ...base, ia: verificarConsultaIa(uso, agora, PARAMETROS_PADRAO), porta: new LlmFalso(llm({ brand: 'Limpex' })), texto: 'detergente' });
    expect(ok).toMatchObject({ origem: 'llm', desfecho: 'respondida', consomeCota: true });
    uso = registrarDesfechoIa(uso, agora, PARAMETROS_PADRAO, ok.desfecho).uso;
    expect(uso.consultas).toBe(6);
    const falha = await interpretarBusca({ ...base, ia: verificarConsultaIa(uso, agora, PARAMETROS_PADRAO), porta: new LlmFalso(new Error('503')), texto: 'detergente' });
    uso = registrarDesfechoIa(uso, agora, PARAMETROS_PADRAO, falha.desfecho).uso;
    expect(uso.consultas).toBe(6);
  });

  it('RN-CAT-03: offline, limite e sem porta não chamam o provedor e não consomem', async () => {
    for (const e of [{ online: false }, { ia: { permitido: false, mensagem: MENSAGEM_LIMITE_ATINGIDO } }, { porta: null }]) {
      const r = await interpretarBusca({ ...base, porta: new LlmFalso(llm({})), texto: 'detergente', ...e });
      expect(r).toMatchObject({ chamouProvedor: false, desfecho: 'nao_chamada', consomeCota: false });
    }
  });

  it('RN-CAT-01: o LLM devolveu lixo — contingência pelas regras (o provedor respondeu: consome, RN-CAT-03)', async () => {
    const r = await interpretarBusca({ ...base, porta: new LlmFalso({ foo: 'bar', max_price_cents: 'barato' }), texto: 'detergente' });
    expect(r).toMatchObject({ origem: 'regras', aviso: AVISO_BUSCA_FALHOU, desfecho: 'respondida', consomeCota: true });
  });

  it('RN-CAT-01: o LLM inventou marca — o filtro some, o resto da interpretação fica', async () => {
    const r = await interpretarBusca({ ...base, porta: new LlmFalso(llm({ brand: 'Inventada', text: 'detergente', stock: 'com' })), texto: 'detergente' });
    expect(r.origem).toBe('llm');
    expect(r.filtros).toMatchObject({ brand: null, stock: 'com' });
  });
});
