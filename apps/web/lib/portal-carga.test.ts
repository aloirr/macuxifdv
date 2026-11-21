/** T-0087: cartões das bases do portal (lib/portal-carga.ts): divisão, corpo das partes, soma da conferência e a execução. */
import { describe, expect, it } from 'vitest';
import type { CargaArquivoAceita, CargaArquivoEntrada, ConferenciaArquivo, ProgressoSessaoArquivo } from '@macuxi/integracao/contracts';

import { conferirArquivo, corpoDaParte, errosDaConferenciaCsv, importarArquivo, loteTerminou, novaChaveDeCarga, percentualDaCarga, planejarEnvio, seloDaCarga, somarConferencias, type PortaCarga, type ProgressoCarga, type ResultadoCarga } from './portal-carga';

const csv = (n: number) => ['external_id;nome', ...Array.from({ length: n }, (_, i) => `V${i + 1};Vendedor ${i + 1}`)].join('\n') + '\n';
const UUID = '0b0f2f8e-7b1c-4f7e-9a51-3f1c2d4e5a6b';

function planoOk(texto: string) {
  const p = planejarEnvio(texto);
  if (!p.ok) throw new Error(p.mensagem);
  return p;
}

describe('planejarEnvio (a mesma divisão da API, N3)', () => {
  it('arquivo pequeno = uma parte', () => {
    const p = planoOk(csv(10));
    expect(p.partes).toHaveLength(1);
    expect(p.totalLinhas).toBe(10);
  });
  it('12 mil linhas = 3 partes de até 5.000, com a linha inicial do arquivo original', () => {
    const p = planoOk(csv(12_000));
    expect(p.partes.map((x) => x.linhas)).toEqual([5000, 5000, 2000]);
    expect(p.partes.map((x) => x.linha_inicial)).toEqual([2, 5002, 10002]);
    expect(p.partes.every((x) => x.texto.startsWith('external_id;nome\n'))).toBe(true);
  });
  it('só cabeçalho = recusa com a frase da API', () => {
    expect(planejarEnvio('external_id;nome\n').ok).toBe(false);
  });
});

describe('corpoDaParte', () => {
  it('uma parte só = envio simples; várias = sessão com parte, total e linha inicial', () => {
    const grande = planoOk(csv(12_000));
    const pequeno = planoOk(csv(3));
    expect(corpoDaParte({ entidade: 'vendedor', modo: 'delta', chave: 'k'.repeat(20), sessaoId: UUID, parte: pequeno.partes[0]! })).not.toHaveProperty('sessao_id');
    const c = corpoDaParte({ entidade: 'vendedor', modo: 'completo', chave: 'k'.repeat(20), sessaoId: UUID, parte: grande.partes[1]! });
    expect(c).toMatchObject({ sessao_id: UUID, parte: 2, total_partes: 3, linha_inicial: 5002, chave_idempotencia: 'k'.repeat(20), modo: 'completo' });
  });
  it('chave de carga cabe na regra do Hub (16 a 128 caracteres seguros)', () => {
    expect(novaChaveDeCarga(() => UUID)).toMatch(/^[A-Za-z0-9._:-]{16,128}$/);
  });
});

const conferencia = (o: Partial<ConferenciaArquivo>): ConferenciaArquivo => ({
  entidade: 'vendedor',
  modo: 'delta',
  linhas_lidas: 10,
  linhas_validas: 10,
  linhas_com_erro: 0,
  erros: [],
  erros_omitidos: 0,
  pode_gravar: true,
  gravou: false,
  ...o,
});
const erro = (i: number) => ({ indice: i, external_id: `V${i}`, codigo: 'campo_obrigatorio' as const, campo: 'nome', mensagem: `Linha ${i + 2} do arquivo: nome é obrigatório.`, reprocessavel: false, origem: 'hub' as const });

describe('errosDaConferenciaCsv', () => {
  it('BOM, ponto e vírgula, CRLF, mesmas colunas do erros.csv e sem fórmula no Excel', () => {
    const csvErros = errosDaConferenciaCsv([erro(0), { ...erro(1), external_id: '=SOMA(A1)', mensagem: 'Linha 3 do arquivo: "nome"; vazio.' }]);
    expect(csvErros.charCodeAt(0)).toBe(0xfeff);
    const linhas = csvErros.slice(1).split('\r\n');
    expect(linhas[0]).toBe('linha_do_lote;external_id;codigo;campo;reprocessavel;mensagem');
    expect(linhas[1]).toBe('1;V0;campo_obrigatorio;nome;nao;Linha 2 do arquivo: nome é obrigatório.');
    expect(linhas[2]).toBe(`2;'=SOMA(A1);campo_obrigatorio;nome;nao;"Linha 3 do arquivo: ""nome""; vazio."`);
    expect(linhas[3]).toBe('');
  });
});

describe('somarConferencias e percentual', () => {
  it('soma contagens, junta os erros até o limite e só pode gravar se todas as partes podem', () => {
    const s = somarConferencias([conferencia({}), conferencia({ linhas_validas: 7, linhas_com_erro: 3, erros: [erro(1), erro(2), erro(3)], pode_gravar: false, erros_omitidos: 1 })], 2);
    expect(s).toMatchObject({ linhas_lidas: 20, linhas_validas: 17, linhas_com_erro: 3, pode_gravar: false, erros_omitidos: 2, gravou: false });
    expect(s?.erros).toHaveLength(2);
    expect(somarConferencias([])).toBeNull();
  });
  it('barra: metade envio, metade gravação', () => {
    expect(percentualDaCarga({ totalPartes: 4, enviadas: 0, aplicadas: 0 })).toBe(0);
    expect(percentualDaCarga({ totalPartes: 4, enviadas: 4, aplicadas: 0 })).toBe(50);
    expect(percentualDaCarga({ totalPartes: 4, enviadas: 4, aplicadas: 2 })).toBe(75);
    expect(percentualDaCarga({ totalPartes: 0, enviadas: 0, aplicadas: 0 })).toBe(0);
  });
});

class ErroFalso extends Error {
  constructor(
    readonly status: number,
    readonly codigo: string,
  ) {
    super(codigo);
  }
}

function portaFalsa(o: { semConector?: boolean; quedas?: number } = {}) {
  const enviados: CargaArquivoEntrada[] = [];
  let conector = !o.semConector;
  let quedas = o.quedas ?? 0;
  let leituras = 0;
  const linhas = (t: string) => t.split('\n').length - 2;
  const porta: PortaCarga = {
    conferir: async (c) => conferencia({ linhas_lidas: linhas(c.conteudo), linhas_validas: linhas(c.conteudo) }),
    enviarParte: async (c) => {
      if (!conector) throw new ErroFalso(404, 'CONECTOR_NAO_ENCONTRADO');
      if (quedas > 0) {
        quedas--;
        throw new ErroFalso(0, 'sem_conexao');
      }
      enviados.push(c);
      const aceita: CargaArquivoAceita = { lote_id: `${UUID.slice(0, -1)}${enviados.length}`, status: 'recebido', entidade: 'vendedor', modo: 'delta', recebidos: 1, consulta: '', conector_id: 'implantacao-csv', linhas_lidas: 1, linhas_invalidas_leitura: 0 };
      return aceita;
    },
    garantirConectorArquivo: async () => {
      conector = true;
    },
    lerLote: async () => ({ status: ++leituras >= 2 ? 'concluido' : 'processando' }),
    lerSessao: async () => ({ situacao: ++leituras >= 2 ? 'completa' : 'aberta', partes_aplicadas: leituras >= 2 ? 3 : 1, partes_com_falha: 0, partes: [] }) as unknown as ProgressoSessaoArquivo,
    esperar: async () => undefined,
    agora: () => 0,
    ehConectorAusente: (e) => e instanceof ErroFalso && e.codigo === 'CONECTOR_NAO_ENCONTRADO',
  };
  return { porta, enviados };
}

describe('importarArquivo', () => {
  it('arquivo grande: 3 partes na mesma sessão e chave, progresso crescente até 100', async () => {
    const plano = planoOk(csv(12_000));
    const { porta, enviados } = portaFalsa();
    const passos: ProgressoCarga[] = [];
    const r = await importarArquivo(porta, { entidade: 'vendedor', modo: 'completo', plano, chave: 'k'.repeat(20), sessaoId: UUID, aoProgredir: (p) => passos.push(p) });
    expect(enviados.map((c) => c.parte)).toEqual([1, 2, 3]);
    expect(new Set(enviados.map((c) => c.chave_idempotencia)).size).toBe(1);
    expect(enviados.every((c) => c.sessao_id === UUID)).toBe(true);
    expect(r).toMatchObject({ sessaoId: UUID, terminou: true });
    expect(r.lotes).toHaveLength(3);
    expect(passos.at(-1)).toMatchObject({ fase: 'pronto', percentual: 100 });
    const pcts = passos.map((p) => p.percentual);
    expect(pcts).toEqual([...pcts].sort((a, b) => a - b));
  });
  it('tenant novo: sem Conector arquivo, cria e repete a 1ª parte; queda de rede repete com a mesma chave', async () => {
    const plano = planoOk(csv(5));
    const { porta, enviados } = portaFalsa({ semConector: true, quedas: 2 });
    const r = await importarArquivo(porta, { entidade: 'vendedor', modo: 'delta', plano, chave: 'k'.repeat(20), sessaoId: UUID, aoProgredir: () => undefined });
    expect(enviados).toHaveLength(1);
    expect(enviados[0]).not.toHaveProperty('sessao_id');
    expect(r).toMatchObject({ status: 'concluido', terminou: true, sessaoId: null });
  });
  it('três quedas seguidas: desiste e devolve o erro', async () => {
    const plano = planoOk(csv(5));
    const { porta } = portaFalsa({ quedas: 3 });
    await expect(importarArquivo(porta, { entidade: 'vendedor', modo: 'delta', plano, chave: 'k'.repeat(20), sessaoId: null, aoProgredir: () => undefined })).rejects.toThrow('sem_conexao');
  });
  it('conferir divide como o envio e soma', async () => {
    const plano = planoOk(csv(12_000));
    const { porta } = portaFalsa();
    const c = await conferirArquivo(porta, { entidade: 'vendedor', modo: 'delta', plano });
    expect(c.linhas_lidas).toBe(12_000);
    expect(c.gravou).toBe(false);
  });
});

describe('selo da carga (RN-INT-15: os 5 status do monitor, D-T0173-A4)', () => {
  /** Relógio que anda 1 min a cada leitura: sem a correção, a espera acaba no prazo com `terminou: false` (sem laço infinito). */
  const relogio = () => {
    let t = 0;
    return () => (t += 60_000);
  };
  const resultado = (o: Partial<ResultadoCarga>): ResultadoCarga => ({ lotes: [UUID], sessaoId: null, progressoSessao: null, status: null, repetido: false, terminou: true, ...o });
  it.each([
    ['recebido', 'Em andamento', 'pending'],
    ['processando', 'Em andamento', 'pending'],
    ['concluido', 'Concluído', 'success'],
    ['concluido_com_erros', 'Concluído com avisos', 'warning'],
    ['falhou', 'Com falha', 'danger'],
    ['cancelado', 'Cancelado', 'neutral'],
  ] as const)('lote %s: %s', (status, rotulo, tom) => {
    expect(seloDaCarga(resultado({ status }))).toEqual({ rotulo, tom });
  });
  it('sem resultado: sem selo', () => {
    expect(seloDaCarga(null)).toBeNull();
    expect(seloDaCarga(resultado({ status: null }))).toBeNull();
  });
  it('arquivo em partes com uma parte cancelada no BKO: Cancelado', () => {
    const progressoSessao = { situacao: 'aberta', partes_aplicadas: 1, partes_com_falha: 0, erros_total: 0, total_partes: 3, partes: [{ status: 'concluido' }, { status: 'cancelado' }] } as unknown as ProgressoSessaoArquivo;
    expect(seloDaCarga(resultado({ sessaoId: UUID, progressoSessao }))).toEqual({ rotulo: 'Cancelado', tom: 'neutral' });
  });
  it('arquivo em partes: falha, avisos, concluído e em andamento', () => {
    const sessao = (o: object) => resultado({ sessaoId: UUID, progressoSessao: { situacao: 'aberta', partes_aplicadas: 0, partes_com_falha: 0, erros_total: 0, total_partes: 2, partes: [], ...o } as unknown as ProgressoSessaoArquivo });
    expect(seloDaCarga(sessao({ partes_com_falha: 1 }))?.rotulo).toBe('Com falha');
    expect(seloDaCarga(sessao({ erros_total: 3 }))?.rotulo).toBe('Concluído com avisos');
    expect(seloDaCarga(sessao({ situacao: 'completa' }))?.rotulo).toBe('Concluído');
    expect(seloDaCarga(sessao({ partes_aplicadas: 1 }))?.rotulo).toBe('Em andamento');
  });
  it('cancelado é status final: a espera da tela para', async () => {
    expect(loteTerminou('cancelado')).toBe(true);
    expect(loteTerminou('processando')).toBe(false);
    const { porta } = portaFalsa();
    porta.lerLote = async () => ({ status: 'cancelado' });
    porta.agora = relogio();
    const r = await importarArquivo(porta, { entidade: 'produto', modo: 'delta', plano: planoOk(csv(2)), chave: 'k'.repeat(20), sessaoId: null, aoProgredir: () => undefined });
    expect(r).toMatchObject({ status: 'cancelado', terminou: true });
  });
  it('sessão com parte cancelada: a espera da tela para', async () => {
    const { porta } = portaFalsa();
    porta.lerSessao = async () => ({ situacao: 'aberta', partes_aplicadas: 1, partes_com_falha: 0, erros_total: 0, total_partes: 3, partes: [{ status: 'cancelado' }] }) as unknown as ProgressoSessaoArquivo;
    porta.agora = relogio();
    const r = await importarArquivo(porta, { entidade: 'produto', modo: 'delta', plano: planoOk(csv(12_000)), chave: 'k'.repeat(20), sessaoId: UUID, aoProgredir: () => undefined });
    expect(r.terminou).toBe(true);
  });
});
