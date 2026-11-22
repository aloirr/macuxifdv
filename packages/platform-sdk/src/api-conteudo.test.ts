/**
 * T-0087 (portal de implantação; PRs N1/N2 da nuvem): caminho com ponto (`modelos/:entidade.csv`, `openapi.json`) e resposta
 * que não é JSON (`tipoConteudo` + `nomeArquivo`). Mudança aditiva: as rotas que já existem continuam válidas.
 */
import { describe, expect, it } from 'vitest';
import {
  caminhoDeRotaValido,
  definirModuloApi,
  ehCaminhoDePedido,
  NOME_ARQUIVO_ROTA_RE,
  problemasConteudoRota,
  promotorBarradoNaRota,
  TIPOS_CONTEUDO_ROTA,
  type RotaModulo,
} from './api';
import { defineModule } from './manifesto';

const integracao = defineModule({
  id: 'integracao',
  versao: '1.0.0',
  depende: ['core'],
  perfis: ['admin', 'analista'],
  acoes: { 'relatorio.exportar': { perfis: ['admin'] } },
});
const ok = async () => 'a;b\n';
const rota = (r: Partial<RotaModulo>): RotaModulo => ({ metodo: 'GET', caminho: 'modelos/:entidade.csv', carteira: 'nao_se_aplica', executar: ok, ...r });

describe('caminho com ponto (T-0087)', () => {
  it('aceita sufixo depois do parâmetro e ponto interno em literal', () => {
    for (const c of ['modelos/:entidade.csv', 'openapi.json', 'docs/openapi.yaml', 'lotes/:id/erros.csv', 'v1.2/x', ':a.tar.gz'])
      expect(caminhoDeRotaValido(c), c).toBe(true);
  });

  it('continua aceitando os caminhos de antes', () => {
    for (const c of ['pedidos', 'pedidos/:id', 'clientes/:clienteId/pedidos', 'visitas-do-dia', 'lotes/:id/erros', 'a_b-c'])
      expect(caminhoDeRotaValido(c), c).toBe(true);
  });

  it('recusa ponto no início, no fim, dois seguidos, maiúscula na extensão e barra inicial', () => {
    for (const c of ['.csv', 'modelos/.csv', 'modelos/:entidade.', 'modelos/:entidade..csv', 'a..b', 'x/', '/openapi.json', 'modelos/:entidade.CSV', 'modelos/:.csv'])
      expect(caminhoDeRotaValido(c), c).toBe(false);
  });

  it('definirModuloApi monta a rota do modelo e trata `:a.csv` e `:b.csv` como a mesma rota (mas `.json` é outra)', () => {
    expect(definirModuloApi({ manifesto: integracao, rotas: [rota({}), rota({ caminho: 'modelos/:entidade.json' })] }).rotas).toHaveLength(2);
    expect(() => definirModuloApi({ manifesto: integracao, rotas: [rota({}), rota({ caminho: 'modelos/:nome.csv' })] })).toThrow(/repetida/);
    expect(() => definirModuloApi({ manifesto: integracao, rotas: [rota({ caminho: 'modelos/:entidade..csv' })] })).toThrow(/caminho inválido/);
  });

  it('RN-PRO-01: a extensão não esconde caminho de pedido', () => {
    expect(ehCaminhoDePedido('pedidos.csv')).toBe(true);
    expect(ehCaminhoDePedido('relatorios/pedidos-sugeridos.csv')).toBe(true);
    expect(ehCaminhoDePedido('modelos/:entidade.csv')).toBe(false);
    expect(promotorBarradoNaRota({ metodo: 'GET', caminho: 'pedidos.csv' })).toBe(true);
  });
});

describe('tipoConteudo e nomeArquivo (T-0087)', () => {
  it('aceita os tipos da lista e nome fixo ou calculado', () => {
    for (const t of TIPOS_CONTEUDO_ROTA) expect(problemasConteudoRota('r', { tipoConteudo: t, nomeArquivo: 'produtos.csv' })).toEqual([]);
    expect(problemasConteudoRota('r', { tipoConteudo: 'text/csv; charset=utf-8', nomeArquivo: (e) => `${String((e.params as { entidade: string }).entidade)}.csv` })).toEqual([]);
    expect(definirModuloApi({ manifesto: integracao, rotas: [rota({ tipoConteudo: 'text/csv; charset=utf-8', nomeArquivo: 'modelo.csv' })] }).rotas).toHaveLength(1);
  });

  it('recusa tipo que o navegador executa ou renderiza (HTML, JS, SVG) e tipo fora da lista', () => {
    for (const t of ['text/html', 'text/html; charset=utf-8', 'application/javascript', 'image/svg+xml', 'text/csv'])
      expect(problemasConteudoRota('r', { tipoConteudo: t as never }).join()).toMatch(/fora de/);
    expect(() => definirModuloApi({ manifesto: integracao, rotas: [rota({ tipoConteudo: 'text/html' as never })] })).toThrow(/tipoConteudo/);
  });

  it('recusa nome de arquivo com aspas, barra, espaço, acento, começo em ponto ou longo demais', () => {
    for (const n of ['a"b.csv', '../x.csv', 'a/b.csv', 'meu arquivo.csv', 'preço.csv', '.csv', 'x'.repeat(101), ''])
      expect(NOME_ARQUIVO_ROTA_RE.test(n), n).toBe(false);
    expect(() => definirModuloApi({ manifesto: integracao, rotas: [rota({ nomeArquivo: 'a b.csv' })] })).toThrow(/nomeArquivo/);
    expect(problemasConteudoRota('r', { nomeArquivo: 42 as never }).join()).toMatch(/texto ou função/);
  });
});
