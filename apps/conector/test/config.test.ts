import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ErroConfig, interpretarConfig } from '../src/config/carregar';
import { parametrosDaConsulta, trocarParametros } from '../src/config/esquema';

const exemplo = join(__dirname, '..', 'exemplos', 'conector.exemplo.json');
interface Ent {
  consulta: string;
  campos: Record<string, unknown>;
}
const base = () => JSON.parse(readFileSync(exemplo, 'utf8')) as { erp: Record<string, unknown>; hub: Record<string, unknown>; entidades: Record<string, Ent> & { cliente: Ent; produto: Ent }; [k: string]: unknown };
const interpretar = (o: unknown) => interpretarConfig(JSON.stringify(o), 'json');

describe('configuração: arquivo de exemplo e validação', () => {
  it('o exemplo de ERP genérico (SQL Server) é válido e cobre as 8 entidades do contrato', () => {
    const cfg = interpretar(base());
    expect(Object.keys(cfg.entidades).sort()).toEqual(['cliente', 'estoque', 'nota', 'preco', 'produto', 'rota', 'titulo', 'vendedor']);
    expect(cfg.erp.tipo).toBe('sqlserver');
    expect(cfg.pedidos?.gravacao.numeroErp).toContain(':pedido_uuid');
  });

  it('aceita YAML equivalente ao JSON', () => {
    const yaml = `
hub: { url: "https://hub.exemplo.com" }
erp: { tipo: postgres, host: db, banco: erp, usuario: leitura }
entidades:
  produto:
    consulta: >-
      SELECT * FROM v WHERE alterado_em > :cursor_alterado_em OR (alterado_em = :cursor_alterado_em AND id > :cursor_external_id) LIMIT :limite
    campos: { external_id: id, alterado_em: alterado_em, sku: sku, nome: nome, unidade: un }
`;
    const cfg = interpretarConfig(yaml, 'yaml');
    expect(cfg.entidades.produto?.periodicidadeSegundos).toBeUndefined();
    expect(cfg.lote.maxLinhas).toBe(5000);
  });

  it('segredo no arquivo é recusado, com orientação para variável de ambiente ou Gerenciador de Credenciais', () => {
    const c = base();
    c.erp.senha = 'qualquer';
    expect(() => interpretar(c)).toThrow(/Segredo no arquivo.*erp\.senha/s);
    const d = base();
    d.hub.token = 'abc';
    try {
      interpretar(d);
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(ErroConfig);
      expect((e as Error).message).toContain('MACUXI_CONECTOR_HUB_TOKEN');
      expect((e as Error).message).not.toContain('abc');
    }
  });

  it('exige HTTPS para o Hub (http só em localhost)', () => {
    const c = base();
    c.hub.url = 'http://hub.exemplo.com';
    expect(() => interpretar(c)).toThrow(/HTTPS/);
    c.hub.url = 'http://127.0.0.1:9999';
    expect(() => interpretar(c)).not.toThrow();
  });

  it('a consulta precisa dos parâmetros do cursor e do limite', () => {
    const c = base();
    c.entidades.cliente.consulta = 'SELECT * FROM v';
    expect(() => interpretar(c)).toThrow(/:cursor_alterado_em/);
    expect(() => interpretar(c)).toThrow(/:limite/);
  });

  it('campo mapeado que não existe no contrato é erro, com a lista dos campos válidos', () => {
    const c = base();
    c.entidades.cliente.campos.cpf = 'cpf';
    expect(() => interpretar(c)).toThrow(/não tem o campo "cpf".*razao_social/s);
  });

  it('external_id e alterado_em são obrigatórios no mapeamento', () => {
    const c = base();
    delete c.entidades.produto.campos.alterado_em;
    expect(() => interpretar(c)).toThrow(/alterado_em/);
  });

  it('entidade fora do contrato e chave desconhecida são recusadas', () => {
    const c = base();
    c.entidades.fornecedor = c.entidades.cliente;
    expect(() => interpretar(c)).toThrow(/fornecedor/);
    const d = base();
    d.chaveDesconhecida = 1;
    expect(() => interpretar(d)).toThrow(ErroConfig);
  });
});

describe('parâmetros nomeados de SQL', () => {
  it('ignora ::cast, literais, identificadores entre aspas e comentários', () => {
    const sql = `SELECT a::text, ':nao_param', ":tambem_nao", x -- :comentario\n FROM t /* :outro */ WHERE y > :cursor_alterado_em AND z = :limite AND w = :cursor_alterado_em`;
    expect(parametrosDaConsulta(sql).sort()).toEqual(['cursor_alterado_em', 'limite']);
    expect(trocarParametros(sql, (n) => `$${n}`)).toContain('a::text');
    expect(trocarParametros(sql, (n) => `@${n}`)).toContain(":nao_param");
  });
});
