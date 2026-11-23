/**
 * Modelos de views do Conector por ERP (`db/conector/modelos/<erp>.sql`, F4b do desenho docs/desenho/integracao-modelos-erp.md
 * §3 e §6; ADR 0066) contra o contrato canônico do Hub (`SCHEMA_REGISTRO`). Sem banco: roda na sessão e no CI.
 * - os 5 modelos do desenho existem (Protheus, WinThor, SAP B1, Sankhya, Senior), todos marcados "Status: beta" (D9) e com a
 *   legenda [P] (público) / [C] (confirmar com o cliente);
 * - cada entidade do contrato tem view OU uma linha "SEM VIEW: <entidade> — motivo" (nunca as duas, nunca nenhuma);
 * - as views seguem a ordem de carga (ORDEM_CARGA_ENTIDADES) e as 2 do retorno do pedido ficam no fim;
 * - cada view devolve todas as colunas obrigatórias do contrato, nada fora dele, sem coluna repetida; external_id nunca sai de
 *   CPF/CNPJ (inclui os nomes do ERP: CGC, CGCENT, CGC_CPF, CGCCPF, LicTradNum);
 * - cada view cita ao menos uma marcação [P] ou [C], e cada modelo tem ao menos um [C];
 * - as views do retorno têm as colunas, na ordem, que o Conector consulta;
 * - nenhum modelo escreve em tabela do ERP (§3: pedido só por rotina, API ou a tabela de entrada do Macuxi).
 * Formato: docs/banco/integracao.md, "Modelos por ERP".
 */
import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ENTIDADES, ORDEM_CARGA_ENTIDADES, SCHEMA_REGISTRO, type Entidade } from '../../modules/integracao/contracts';
import {
  COLUNAS_RETORNO,
  VIEWS_RETORNO,
  aliasesAlternativos,
  blocosDeView,
  colunasDoContrato,
  lerViews,
  obrigatoriasFaltando,
  semComentarios,
} from './leitor-views-conector';

const PASTA = new URL('../conector/modelos/', import.meta.url);
const ERPS = ['protheus', 'winthor', 'sap-b1', 'sankhya', 'senior'] as const;
const RETORNO = VIEWS_RETORNO as readonly string[];

const ler = (erp: string) => readFileSync(new URL(`${erp}.sql`, PASTA), 'utf8');

/** Entidades declaradas sem view no cabeçalho: "SEM VIEW: <entidade> — motivo". */
function semView(sql: string): string[] {
  return [...sql.matchAll(/^--\s+SEM VIEW:\s+([a-z_]+)\s+—\s+\S/gm)].map((m) => m[1]!);
}

describe('modelos por ERP do Conector (db/conector/modelos)', () => {
  it('os 5 modelos do desenho, e só eles', () => {
    const arquivos = readdirSync(PASTA).filter((a) => a.endsWith('.sql')).map((a) => a.replace(/\.sql$/, ''));
    expect(arquivos.sort()).toEqual([...ERPS].sort());
  });

  describe.each([...ERPS])('%s', (erp) => {
    const sql = ler(erp);
    const views = lerViews(sql);
    const porNome = new Map(views.map((v) => [v.entidade, v]));
    const carga = views.filter((v) => !RETORNO.includes(v.entidade));

    it('cabeçalho: status beta e legenda [P]/[C]', () => {
      const cabecalho = sql.slice(0, sql.search(/CREATE\s+(?:OR\s+REPLACE\s+)?VIEW/i));
      expect(cabecalho).toMatch(/^-- Status: beta\b/m);
      expect(cabecalho).toMatch(/\[P\] = conhecimento público/);
      expect(cabecalho).toMatch(/\[C\] = CONFIRMAR com o cliente/);
    });

    it('cada entidade do contrato tem view ou "SEM VIEW" com motivo, nunca os dois', () => {
      const nomes = carga.map((v) => v.entidade);
      const sem = semView(sql);
      expect(new Set(nomes).size, 'view repetida').toBe(nomes.length);
      expect(nomes.filter((n) => sem.includes(n)), 'entidade com view e com "SEM VIEW"').toEqual([]);
      expect([...nomes, ...sem].sort()).toEqual([...ENTIDADES].sort());
    });

    it('views na ordem de carga do contrato; as do retorno no fim', () => {
      const ordem = carga.map((v) => v.entidade);
      expect(ordem).toEqual(ORDEM_CARGA_ENTIDADES.filter((e) => ordem.includes(e)));
      const nomes = views.map((v) => v.entidade);
      const retornos = nomes.filter((n) => RETORNO.includes(n));
      expect(nomes.slice(nomes.length - retornos.length)).toEqual(retornos);
    });

    it('colunas contra o SCHEMA_REGISTRO: obrigatórias presentes, nada fora, sem repetida', () => {
      for (const v of carga) {
        const schema = SCHEMA_REGISTRO[v.entidade as Entidade];
        expect(schema, `vw_macuxi_${v.entidade} não é entidade do contrato`).toBeDefined();
        expect(obrigatoriasFaltando(v, schema), `vw_macuxi_${v.entidade}: obrigatória sem coluna`).toEqual([]);
        const aliases = v.colunas.map((c) => c.alias);
        expect(new Set(aliases).size, `vw_macuxi_${v.entidade}: coluna repetida`).toBe(aliases.length);
        const contrato = colunasDoContrato(schema).map((c) => c.coluna);
        expect(aliases.filter((a) => !contrato.includes(a)), `vw_macuxi_${v.entidade}: coluna fora do contrato`).toEqual([]);
        for (const c of ['external_id', 'alterado_em', 'ativo']) expect(aliases, `vw_macuxi_${v.entidade}`).toContain(c);
      }
    });

    it('external_id é chave interna do ERP, nunca CPF/CNPJ', () => {
      for (const v of carga) {
        const ext = v.colunas.find((c) => c.alias === 'external_id')!;
        expect(ext.expressao, `vw_macuxi_${v.entidade}`).not.toMatch(/cpf|cnpj|cgc|documento|lictradnum|taxid/i);
      }
    });

    it('views do retorno do pedido com as colunas que o Conector consulta', () => {
      for (const r of VIEWS_RETORNO) {
        const v = porNome.get(r);
        if (v) expect(v.colunas.map((c) => c.alias), `vw_macuxi_${r}`).toEqual([...COLUNAS_RETORNO[r]]);
      }
      expect(porNome.has('pedido_status'), 'as 2 views do retorno vêm juntas').toBe(porNome.has('pedido_nota_item'));
    });

    it('toda view marca a fonte ([P] ou [C]) e o modelo tem o que confirmar ([C])', () => {
      for (const { entidade, texto } of blocosDeView(sql)) {
        expect(texto, `vw_macuxi_${entidade} sem [P] nem [C]`).toMatch(/\[[PC]\]/);
      }
      expect(sql).toMatch(/\[C\]/);
    });

    it('as formas comentadas [Oracle]/[SQL Server] usam aliases da própria view', () => {
      for (const { entidade, texto } of blocosDeView(sql)) {
        const aliases = new Set(porNome.get(entidade)!.colunas.map((c) => c.alias));
        for (const a of aliasesAlternativos(texto)) expect(aliases.has(a), `vw_macuxi_${entidade}: alias "${a}"`).toBe(true);
      }
    });

    it('não escreve em tabela do ERP (só lê; a entrada é a tabela macuxi_pedido_entrada)', () => {
      const limpo = semComentarios(sql);
      const escritas = [...limpo.matchAll(/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|MERGE\s+INTO|TRUNCATE\s+TABLE)\s+([\w.]+)/gi)];
      expect(escritas.map((m) => m[2]!).filter((t) => !/^(dbo\.)?macuxi_pedido_entrada(_item)?$/i.test(t))).toEqual([]);
      expect(limpo).not.toMatch(/\b(ALTER|DROP)\s+TABLE\b/i);
    });
  });
});
