import { describe, expect, it } from 'vitest';
import {
  CARGA_COMPLETA_INTERVALO_DIAS,
  classificarFalhaCodigoSaida,
  classificarFalhaHttp,
  esperaTentativaS,
  exigeNovaCredencial,
  FREQUENCIA_PADRAO_MIN,
  frequenciaDaEntidade,
  janelaIncremental,
  lerRetryAfterS,
  planejarColetas,
  problemasFrequencias,
  SOBREPOSICAO_PADRAO_MIN,
  type EstadoColetaEntidade,
} from './coleta-erp';

const AGORA = '2026-11-22T14:00:00.000Z'; // 10h em Manaus
const MADRUGADA = '2026-11-22T07:00:00.000Z'; // 03h em Manaus
const ha = (min: number, de = AGORA) => new Date(Date.parse(de) - min * 60_000).toISOString();
const dias = (d: number, de = AGORA) => ha(d * 24 * 60, de);

const base = { fuso: 'America/Manaus', coletasParadasEm: null as string | null };
const estado = (e: Partial<EstadoColetaEntidade> = {}): EstadoColetaEntidade => ({ viva: false, ultimaSolicitadaEm: null, ultimaCompletaConcluidaEm: null, ...e });

describe('RN-INT-17: frequência por entidade (múltipla de 15 min, de 15 min a 1 dia)', () => {
  it('RN-INT-17: padrão por entidade segue o doc 06 — preço e estoque 15 min, cadastros 1 h, estruturas 1 dia', () => {
    expect(FREQUENCIA_PADRAO_MIN.preco).toBe(15);
    expect(FREQUENCIA_PADRAO_MIN.estoque).toBe(15);
    expect(FREQUENCIA_PADRAO_MIN.cliente).toBe(60);
    expect(FREQUENCIA_PADRAO_MIN.produto).toBe(60);
    expect(FREQUENCIA_PADRAO_MIN.filial).toBe(1440);
    for (const m of Object.values(FREQUENCIA_PADRAO_MIN)) {
      expect(m % 15).toBe(0);
      expect(m).toBeGreaterThanOrEqual(15);
      expect(m).toBeLessThanOrEqual(1440);
    }
  });

  it('RN-INT-17: a frequência do tenant vale quando válida; inválida (7 min, 1.455 min) cai no padrão', () => {
    expect(frequenciaDaEntidade({ cliente: 30 }, 'cliente')).toBe(30);
    expect(frequenciaDaEntidade({ cliente: 7 }, 'cliente')).toBe(60);
    expect(frequenciaDaEntidade({ cliente: 1455 }, 'cliente')).toBe(60);
    expect(frequenciaDaEntidade({}, 'preco')).toBe(15);
  });

  it('RN-INT-17: problemasFrequencias recusa o que não é múltiplo de 15, abaixo de 15 ou acima de 1 dia', () => {
    expect(problemasFrequencias({ preco: 15, cliente: 1440 })).toEqual([]);
    expect(problemasFrequencias({ preco: 10 }).join(' ')).toMatch(/preco/);
    expect(problemasFrequencias({ preco: 20 }).join(' ')).toMatch(/múltipla de 15/);
    expect(problemasFrequencias({ preco: 1500 }).join(' ')).toMatch(/1 dia/);
  });
});

describe('RN-INT-17: plano de coleta', () => {
  it('RN-INT-17: coleta parada por credencial recusada não planeja nada (RN-INT-20)', () => {
    const r = planejarColetas({ ...base, agora: AGORA, entidades: ['preco'], frequencias: {}, coletasParadasEm: ha(30), estados: { preco: estado({ ultimaCompletaConcluidaEm: dias(1), ultimaSolicitadaEm: ha(60) }) } });
    expect(r).toEqual([]);
  });

  it('RN-INT-17: entidade sem nenhuma carga completa espera a primeira carga explícita (o assistente), não nasce sozinha', () => {
    expect(planejarColetas({ ...base, agora: AGORA, entidades: ['cliente'], frequencias: {}, estados: { cliente: estado() } })).toEqual([]);
  });

  it('RN-INT-17: vencida pela frequência vira delta; dentro da frequência não planeja', () => {
    const vencida = planejarColetas({ ...base, agora: AGORA, entidades: ['preco'], frequencias: {}, estados: { preco: estado({ ultimaCompletaConcluidaEm: dias(2), ultimaSolicitadaEm: ha(15) }) } });
    expect(vencida).toEqual([{ entidade: 'preco', modo: 'delta', motivo: 'frequencia' }]);
    const cedo = planejarColetas({ ...base, agora: AGORA, entidades: ['preco'], frequencias: {}, estados: { preco: estado({ ultimaCompletaConcluidaEm: dias(2), ultimaSolicitadaEm: ha(14) }) } });
    expect(cedo).toEqual([]);
  });

  it('RN-INT-17: a frequência do tenant manda (cliente a cada 30 min)', () => {
    const e = { cliente: estado({ ultimaCompletaConcluidaEm: dias(2), ultimaSolicitadaEm: ha(31) }) };
    expect(planejarColetas({ ...base, agora: AGORA, entidades: ['cliente'], frequencias: { cliente: 30 }, estados: e })).toHaveLength(1);
    expect(planejarColetas({ ...base, agora: AGORA, entidades: ['cliente'], frequencias: {}, estados: e })).toEqual([]);
  });

  it('RN-INT-17: uma coleta viva da entidade segura a seguinte (um trabalho vivo por entidade)', () => {
    const r = planejarColetas({ ...base, agora: AGORA, entidades: ['preco'], frequencias: {}, estados: { preco: estado({ viva: true, ultimaCompletaConcluidaEm: dias(2), ultimaSolicitadaEm: ha(60) }) } });
    expect(r).toEqual([]);
  });

  it('RN-INT-17: a carga completa semanal só sai de madrugada no fuso do tenant e é a única com modo completo agendado', () => {
    const e = { cliente: estado({ ultimaCompletaConcluidaEm: dias(CARGA_COMPLETA_INTERVALO_DIAS, MADRUGADA), ultimaSolicitadaEm: ha(120, MADRUGADA) }) };
    expect(planejarColetas({ ...base, agora: MADRUGADA, entidades: ['cliente'], frequencias: {}, estados: e })).toEqual([{ entidade: 'cliente', modo: 'completo', motivo: 'carga_semanal' }]);
    // 10h em Manaus: horário comercial, segue em delta
    const dia = { cliente: estado({ ultimaCompletaConcluidaEm: dias(CARGA_COMPLETA_INTERVALO_DIAS), ultimaSolicitadaEm: ha(120) }) };
    expect(planejarColetas({ ...base, agora: AGORA, entidades: ['cliente'], frequencias: {}, estados: dia })).toEqual([{ entidade: 'cliente', modo: 'delta', motivo: 'frequencia' }]);
  });

  it('RN-INT-17: menos de 7 dias desde a última completa não repete a completa, mesmo de madrugada', () => {
    const e = { cliente: estado({ ultimaCompletaConcluidaEm: dias(6, MADRUGADA), ultimaSolicitadaEm: ha(120, MADRUGADA) }) };
    expect(planejarColetas({ ...base, agora: MADRUGADA, entidades: ['cliente'], frequencias: {}, estados: e })).toEqual([{ entidade: 'cliente', modo: 'delta', motivo: 'frequencia' }]);
  });

  it('RN-INT-04: o plano segue a ordem de carga (filial antes de vendedor, cliente depois de preço)', () => {
    const e = (): EstadoColetaEntidade => estado({ ultimaCompletaConcluidaEm: dias(2), ultimaSolicitadaEm: dias(1) });
    const r = planejarColetas({ ...base, agora: AGORA, entidades: ['cliente', 'vendedor', 'filial'], frequencias: {}, estados: { cliente: e(), vendedor: e(), filial: e() } });
    expect(r.map((x) => x.entidade)).toEqual(['filial', 'vendedor', 'cliente']);
  });
});

describe('RN-INT-05: janela incremental', () => {
  it('RN-INT-05: sem cursor lê tudo (sem filtro de data)', () => {
    expect(janelaIncremental({ cursorAlteradoEm: null, sobreposicaoMin: SOBREPOSICAO_PADRAO_MIN })).toBeNull();
  });
  it('RN-INT-05: com cursor, começa a janela de sobreposição (padrão 10 min) antes do cursor', () => {
    expect(janelaIncremental({ cursorAlteradoEm: '2026-11-22T14:00:00.000Z', sobreposicaoMin: 10 })).toBe('2026-11-22T13:50:00.000Z');
    expect(SOBREPOSICAO_PADRAO_MIN).toBe(10);
  });
});

describe('RN-INT-20: falhas do ERP', () => {
  it('RN-INT-20: 401 e 403 são credencial recusada e param as coletas', () => {
    expect(classificarFalhaHttp(401)).toMatchObject({ classe: 'credencial_recusada', paraColetas: true, tenta: false });
    expect(classificarFalhaHttp(403)).toMatchObject({ classe: 'credencial_recusada', paraColetas: true, tenta: false });
  });
  it('RN-INT-20: 429, 408 e 5xx são transitórias e tentam de novo', () => {
    for (const s of [408, 429, 500, 502, 503, 504]) expect(classificarFalhaHttp(s)).toMatchObject({ classe: 'transitoria', tenta: true, paraColetas: false });
  });
  it('RN-INT-20: 404, 400 e 422 não adiantam tentar de novo (endpoint ou formato mudou)', () => {
    for (const s of [400, 404, 422]) expect(classificarFalhaHttp(s)).toMatchObject({ classe: 'formato_mudou', tenta: false, paraColetas: false });
  });
  it('RN-INT-20: rede, timeout e limite por minuto são transitórios; destino bloqueado e URL inválida não', () => {
    for (const c of ['TEMPO_ESGOTADO', 'DNS_FALHOU', 'REDE', 'LIMITE_POR_MINUTO'] as const) expect(classificarFalhaCodigoSaida(c)).toMatchObject({ classe: 'transitoria', tenta: true });
    for (const c of ['DESTINO_BLOQUEADO', 'URL_INVALIDA', 'ESQUEMA_PROIBIDO', 'REDIRECIONAMENTO_PROIBIDO', 'RESPOSTA_GRANDE_DEMAIS'] as const) expect(classificarFalhaCodigoSaida(c)).toMatchObject({ classe: 'formato_mudou', tenta: false });
  });
  it('RN-INT-20: espera de 1, 2, 4, 8 e 16 min; na sexta falha desiste até o próximo ciclo', () => {
    expect([1, 2, 3, 4, 5].map((n) => esperaTentativaS(n))).toEqual([60, 120, 240, 480, 960]);
    expect(esperaTentativaS(6)).toBeNull();
    expect(esperaTentativaS(0)).toBe(60);
  });
  it('RN-INT-20: o Retry-After maior que a espera vale; o menor não encurta; o absurdo é limitado a 1 hora', () => {
    expect(esperaTentativaS(1, { retryAfterS: 300 })).toBe(300);
    expect(esperaTentativaS(3, { retryAfterS: 30 })).toBe(240);
    expect(esperaTentativaS(1, { retryAfterS: 999_999 })).toBe(3600);
  });
  it('RN-INT-20: Retry-After em segundos ou em data HTTP', () => {
    expect(lerRetryAfterS('120', AGORA)).toBe(120);
    expect(lerRetryAfterS('Sun, 22 Nov 2026 14:05:00 GMT', AGORA)).toBe(300);
    expect(lerRetryAfterS('Sun, 22 Nov 2026 13:00:00 GMT', AGORA)).toBe(0);
    expect(lerRetryAfterS('abc', AGORA)).toBeNull();
    expect(lerRetryAfterS(undefined, AGORA)).toBeNull();
  });
});

describe('RN-INT-18: trocar a URL não leva a credencial antiga a outro host', () => {
  it('RN-INT-18: mudar o host exige credencial nova na mesma chamada; mudar só o caminho ou o usuário não exige', () => {
    const antes = { url_base: 'https://erp.cliente.com.br:50000/b1s/v1' };
    expect(exigeNovaCredencial(antes, { url_base: 'https://outro.com/b1s/v1' })).toBe(true);
    expect(exigeNovaCredencial(antes, { url_base: 'https://erp.cliente.com.br:50001/b1s/v1' })).toBe(true);
    expect(exigeNovaCredencial(antes, { url_base: 'https://erp.cliente.com.br:50000/b1s/v2' })).toBe(false);
    expect(exigeNovaCredencial(null, { url_base: 'https://erp.cliente.com.br' })).toBe(true);
  });
});
