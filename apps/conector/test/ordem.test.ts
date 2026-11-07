/**
 * T-0099 (RN-INT-05): `conector testar-conexao` confere a ordem do external_id no banco do ERP contra a ordem do Conector
 * (binária/ordinal) e avisa, com exemplo concreto, quando a colação do banco não é binária (ou a chave é numérica).
 */
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ConfigConector, type EntidadeConfig } from '../src/config/esquema';
import type { ConexaoErp, ExecutorSql, Linha, Parametros } from '../src/erp/driver';
import { avisoOrdemDivergente, conferirOrdemExternalId, ORIENTACAO_ORDEM, sondasPara } from '../src/ordem';

type Comparar = (a: string, b: string) => number;
const binaria: Comparar = (a, b) => (a === b ? 0 : a < b ? -1 : 1);
/** SQL Server `Latin1_General_CI_AS` (aproximação): sem caixa, com acento. */
const ci = new Intl.Collator('en', { sensitivity: 'accent' }).compare;
/** Colação linguística sensível à caixa (`CS_AS`, `en_US.UTF-8`, `NLS_SORT=WEST_EUROPEAN`): a < A < b < B. */
const linguistica = new Intl.Collator('en', { sensitivity: 'variant', caseFirst: 'lower' }).compare;
const numerica: Comparar = (a, b) => Number(a) - Number(b);

/** ERP falso que filtra e ordena pelo cursor como a consulta real, com a colação dada no filtro e no ORDER BY. */
class ErpColacao implements ConexaoErp {
  readonly tipo = 'sqlserver' as const;
  consultas: Parametros[] = [];
  falhar = false;
  /** Precisão de alterado_em maior que ms: o filtro devolve também o mesmo instante (controle da conferência). */
  precisaoMaior = false;
  constructor(
    public linhas: { external_id: string | number; alterado_em: string }[],
    public filtro: Comparar = binaria,
    public ordem: Comparar = filtro,
  ) {}
  async consultar(_sql: string, p: Parametros = {}): Promise<Linha[]> {
    this.consultas.push(p);
    if (this.falhar) throw new Error('falhou');
    const ms = (p.cursor_alterado_em as Date).getTime();
    const id = String(p.cursor_external_id);
    return this.linhas
      .filter((l) => {
        const t = Date.parse(l.alterado_em);
        if (this.precisaoMaior) return t >= ms;
        return t > ms || (t === ms && this.filtro(String(l.external_id), id) > 0);
      })
      .sort((a, b) => Date.parse(a.alterado_em) - Date.parse(b.alterado_em) || this.ordem(String(a.external_id), String(b.external_id)))
      .slice(0, Number(p.limite))
      .map((l) => ({ ...l }));
  }
  async executar(): Promise<{ linhasAfetadas: number }> {
    return { linhasAfetadas: 0 };
  }
  async testar() {
    return { versao: 'falso' };
  }
  async transacao<T>(fn: (tx: ExecutorSql) => Promise<T>): Promise<T> {
    return fn(this);
  }
  async fechar() {}
}

const CONSULTA = 'SELECT TOP (:limite) * FROM v WHERE alterado_em > :cursor_alterado_em OR (alterado_em = :cursor_alterado_em AND external_id > :cursor_external_id) ORDER BY alterado_em, external_id';
const cfgCliente = (): EntidadeConfig =>
  ConfigConector.parse({
    hub: { url: 'https://h.example.com', conectorId: 'cnx-1' },
    erp: { tipo: 'sqlserver', host: 'h', banco: 'b', usuario: 'u' },
    entidades: { cliente: { consulta: CONSULTA, campos: { external_id: 'external_id', alterado_em: 'alterado_em', razao_social: 'razao_social' } } },
  }).entidades.cliente as EntidadeConfig;

const T = '2026-03-01T10:00:00.000Z';
const T2 = '2026-03-01T10:00:01.000Z';

describe('sondasPara (função pura)', () => {
  it('troca a caixa, usa a letra vizinha da outra caixa e, em chave só de dígitos, um número mais longo com dígito menor', () => {
    expect(sondasPara('abc')).toEqual(expect.arrayContaining(['ABC', 'Abc', 'Bbc', 'B']));
    expect(sondasPara('Cli9')).toEqual(expect.arrayContaining(['CLI9', 'cli9', 'bli9', 'b']));
    // `A` não tem minúscula anterior: a vizinha sai da próxima letra elegível
    expect(sondasPara('ABC')).toEqual(expect.arrayContaining(['abc', 'aBC', 'AaC', 'Aa']));
    expect(sondasPara('123')).toEqual(['1229']);
    expect(sondasPara('120')).toEqual(['1199']);
    expect(sondasPara('000')).toEqual([]);
    for (const x of ['abc', 'ABC', 'Cli9', '123', 'T1:P1']) expect(sondasPara(x)).not.toContain(x);
  });

  it('cada sonda de letra discorda entre a ordem binária e a linguística (é o que a torna útil)', () => {
    for (const x of ['abc', 'Cli9', 'ABC', 'T1:P1']) {
      const uteis = sondasPara(x).filter((y) => Math.sign(binaria(x, y)) !== Math.sign(linguistica(x, y)) || Math.sign(binaria(x, y)) !== Math.sign(ci(x, y)));
      expect(uteis.length, x).toBeGreaterThan(0);
    }
  });
});

describe('conferirOrdemExternalId', () => {
  const dados = [
    { external_id: 'C10', alterado_em: T },
    { external_id: 'C2', alterado_em: T },
    { external_id: 'c3', alterado_em: T2 },
  ];

  it('colação binária: ok (só lê, com a própria consulta da entidade)', async () => {
    const erp = new ErpColacao(dados);
    const r = await conferirOrdemExternalId(erp, cfgCliente());
    expect(r).toMatchObject({ situacao: 'ok' });
    expect(erp.consultas.length).toBeGreaterThan(2);
    expect(erp.consultas.every((p) => Number(p.limite) <= 5)).toBe(true);
  });

  it('SQL Server CI_AS: diverge, com exemplo concreto dos external_id', async () => {
    const r = await conferirOrdemExternalId(new ErpColacao(dados, ci), cfgCliente());
    expect(r.situacao).toBe('divergente');
    if (r.situacao !== 'divergente') return;
    expect(r.exemplo).toMatch(/"C10"/);
    expect(r.exemplo).toMatch(/com o cursor em external_id "[^"]+" o banco (NÃO )?considerou "C10" maior, mas na ordem do Conector "C10" é (maior|menor)/);
  });

  it('colação linguística sensível à caixa (en_US, CS_AS, NLS_SORT linguístico): diverge', async () => {
    const minusculas = [{ external_id: 'abc', alterado_em: T }, { external_id: 'abd', alterado_em: T }];
    expect((await conferirOrdemExternalId(new ErpColacao(minusculas, linguistica), cfgCliente())).situacao).toBe('divergente');
    expect((await conferirOrdemExternalId(new ErpColacao(minusculas), cfgCliente())).situacao).toBe('ok');
  });

  it('ORDER BY fora da ordem binária na amostra (mesmo alterado_em): diverge, mostrando o par', async () => {
    // filtro binário, mas o ORDER BY com colação sem caixa: "a1" antes de "B2" no mesmo instante
    const erp = new ErpColacao([{ external_id: 'B2', alterado_em: T }, { external_id: 'a1', alterado_em: T }], binaria, ci);
    const r = await conferirOrdemExternalId(erp, cfgCliente());
    expect(r).toEqual({ situacao: 'divergente', exemplo: expect.stringContaining('o banco devolveu "a1" antes de "B2"') });
  });

  it('chave numérica (coluna int): diverge e diz que o banco comparou como número', async () => {
    const r = await conferirOrdemExternalId(new ErpColacao([{ external_id: 123, alterado_em: T }, { external_id: 9, alterado_em: T2 }], numerica), cfgCliente());
    expect(r).toEqual({ situacao: 'divergente', exemplo: expect.stringMatching(/"1229" o banco NÃO considerou "123" maior.*comparou como número/) });
  });

  it('chave só de dígitos em coluna de texto: a ordem coincide (ok)', async () => {
    const r = await conferirOrdemExternalId(new ErpColacao([{ external_id: '123', alterado_em: T }], linguistica), cfgCliente());
    expect(r).toMatchObject({ situacao: 'ok' });
  });

  it('inconclusiva sem afirmar nada: alterado_em com precisão maior que ms, consulta vazia ou com erro', async () => {
    const micro = new ErpColacao(dados, ci);
    micro.precisaoMaior = true;
    expect(await conferirOrdemExternalId(micro, cfgCliente())).toMatchObject({ situacao: 'inconclusiva', motivo: expect.stringMatching(/precisão maior/) });
    expect(await conferirOrdemExternalId(new ErpColacao([]), cfgCliente())).toMatchObject({ situacao: 'inconclusiva' });
    const erro = new ErpColacao(dados);
    erro.falhar = true;
    expect(await conferirOrdemExternalId(erro, cfgCliente())).toMatchObject({ situacao: 'inconclusiva' });
  });

  it('o aviso traz a orientação do tipo de ERP (COLLATE Latin1_General_BIN2, NLSSORT BINARY, COLLATE "C")', () => {
    expect(avisoOrdemDivergente('cliente', 'sqlserver', 'Exemplo: x.')).toMatch(/cliente: a ordem do external_id.*Exemplo: x\..*COLLATE Latin1_General_BIN2.*conector\.md §5/);
    expect(ORIENTACAO_ORDEM.oracle).toMatch(/NLSSORT\(external_id, 'NLS_SORT=BINARY'\)/);
    expect(ORIENTACAO_ORDEM.postgres).toMatch(/COLLATE "C"/);
  });
});

// ---------- CLI: testar-conexao com o ERP falso ----------
const erpDaVez: { atual: ConexaoErp | null } = { atual: null };
vi.mock('../src/erp/fabrica', () => ({ abrirConexaoErp: async () => erpDaVez.atual }));

let dir = '';
afterEach(() => {
  if (dir) rmSync(dir, { recursive: true, force: true });
  dir = '';
  erpDaVez.atual = null;
});

async function testarConexao(erp: ConexaoErp) {
  const { executarCli } = await import('../src/comandos');
  dir = mkdtempSync(join(tmpdir(), 'conector-ordem-'));
  const arquivo = join(dir, 'conector.json');
  writeFileSync(arquivo, JSON.stringify({
    dadosDir: join(dir, 'dados'),
    hub: { url: 'http://127.0.0.1:9', conectorId: 'cnx-1' },
    erp: { tipo: 'sqlserver', host: 'localhost', banco: 'erp', usuario: 'u', criptografar: false },
    segredos: { provedor: 'env' },
    entidades: { cliente: { consulta: CONSULTA, campos: { external_id: 'external_id', alterado_em: 'alterado_em', razao_social: 'razao_social' } } },
  }));
  erpDaVez.atual = erp;
  const saidas: string[] = [];
  const codigo = await executarCli(['testar-conexao', '--config', arquivo], {
    saida: (t) => void saidas.push(t), erro: (t) => void saidas.push(t), lerEntrada: async () => '', env: { MACUXI_CONECTOR_ERP_SENHA: 'x' },
  });
  return { codigo, texto: saidas.join('\n') };
}

describe('CLI testar-conexao: ordem do external_id', () => {
  it('colação não binária: [aviso] com exemplo e a orientação COLLATE Latin1_General_BIN2 (não conta como falha)', async () => {
    const { texto } = await testarConexao(new ErpColacao([{ external_id: 'C10', alterado_em: T }, { external_id: 'C2', alterado_em: T }], ci));
    expect(texto).toMatch(/\[aviso\] cliente: a ordem do external_id no banco do ERP diverge da ordem do Conector/);
    expect(texto).toMatch(/Exemplo: .*"C10"/);
    expect(texto).toContain('COLLATE Latin1_General_BIN2');
    // a única falha é a chave do Hub ausente (não configurada no teste), não a ordem
    expect(texto).toMatch(/1 problema\(s\) encontrado\(s\)/);
  });

  it('colação binária: [ok] da ordem, sem aviso', async () => {
    const { texto } = await testarConexao(new ErpColacao([{ external_id: 'C10', alterado_em: T }, { external_id: 'C2', alterado_em: T }]));
    expect(texto).toMatch(/\[ok\]\s+cliente: ordem do external_id igual à do Conector/);
    expect(texto).not.toMatch(/\[aviso\] cliente/);
  });
});
