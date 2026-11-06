/**
 * Base de DEMONSTRAÇÃO — Catálogo do cadastro (migração 0033; T-0084 aplicação e T-0085 referência cruzada). Dono:
 * banco-dados. Arquivo próprio: o demo.ts chama `gravarDemoCatalogoCadastro(admin, { hoje, dados })` na MESMA transação do
 * carregarDemo, depois do Promotor (as marcas concorrentes são o cadastro `concorrente` do Promotor, promotor.ts).
 *
 * O que fica no demo.ts (colunas que existem desde a 0013/0020): a aplicação em `produto_conteudo.aplicacoes` (cerca de 40%
 * das autopeças, com os casos do Uno e do Gol, um texto acima de 300 caracteres sem separador e um "a partir de 2018"),
 * os produtos novos (pastilha, disco, filtro de óleo e amortecedor), a árvore sistema › grupo › linha, os sinônimos VW e GM
 * e o "oferece junto" (`produto_relacao` complementar). Aqui, só o que depende da 0033:
 * - referências cruzadas (`catalogo.produto_referencia`, RN-CAT-09): "CB 3401" (Freiomax) na pastilha do Uno, "FB-0207"
 *   (Filtrobom) no filtro do Gol e outras nas autopeças; marca_id = id da marca no cadastro do Promotor (sem FK) e, desde a
 *   0034, marca_nome = o nome dela (retrato; sem a 0034 na base, grava sem a coluna);
 *   codigo_compacto = `codigoCompacto` do domain do Catálogo (a mesma função da API);
 * - etiquetas curtas (`produto_conteudo.etiquetas`): "Dianteira", "Traseira" e "Novo";
 * - documento de busca do servidor (`produto_busca.aplicacao` e `.referencias`): a aplicação já expandida por
 *   `expandirAplicacao` (anos de dentro das faixas, RN-CAT-12; ano corrente = o do "hoje" do seed) e os códigos crus +
 *   compactos das referências — o que a API do Catálogo grava.
 *
 * Idempotente (upsert por id determinístico; as colunas da 0033 são reescritas a cada carga). Banco sem a 0033 = nada a
 * fazer (a base continua com a aplicação no conteúdo). Só tenant demo; só Postgres local ou servidor da demo.
 * CICLO DE IMPORT: o demo.ts importa este arquivo; daqui só o TIPO do demo.ts é importado.
 */
import type { ClientBase } from 'pg';
import { expandirAplicacao } from '../../../modules/catalogo/domain/aplicacao';
import { codigoCompacto } from '../../../modules/catalogo/domain/ranking';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { arrayDeTextoLivre, gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico } from '../../src/ids';
import type { DadosDemo } from './demo';
import { idMarcaConcorrenteDemo, MARCAS_CONCORRENTES_DEMO, type ChaveMarcaConcorrenteDemo } from './promotor';

const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

/** Referências cruzadas da demo (RN-CAT-09; até 3 por produto): [sku, marca concorrente, código como o catálogo imprime, ordem]. */
export const REFERENCIAS_DEMO: ReadonlyArray<readonly [string, ChaveMarcaConcorrenteDemo, string, 1 | 2 | 3]> = [
  ['PST-D01', 'freiomax', 'CB 3401', 1],
  ['PST-D01', 'rodaforte', 'RF-1187', 2],
  ['DSC-D01', 'freiomax', 'DF 2210', 1],
  ['DSC-D01', 'rodaforte', 'RD-450V', 2],
  ['FOL-G01', 'filtrobom', 'FB-0207', 1],
  ['AMR-T01', 'rodaforte', 'AT-7720', 1],
  ['LAM-H4', 'vialume', 'VL H4.6055', 1],
];

/** Etiquetas curtas (RF-CAT-09; até 4 de até 20 caracteres). Os demais produtos ficam sem ('{}'). */
export const ETIQUETAS_DEMO: Readonly<Record<string, readonly string[]>> = {
  'PST-D01': ['Dianteira', 'Novo'],
  'DSC-D01': ['Dianteira'],
  'AMR-T01': ['Traseira'],
  'FOL-G01': ['Novo'],
};

export const idProdutoReferenciaDemo = (sku: string, ordem: number) => id(`produto_referencia:${sku}:${ordem}`);

export interface DadosDemoCatalogoCadastro {
  'catalogo.produto_referencia': Linha[];
  /** Etiquetas por linha de produto_conteudo (todas as linhas da demo: '{}' quando não há). */
  etiquetas: Array<{ id: string; etiquetas: string[] }>;
  /** Colunas da 0033 no documento de busca do servidor, por produto. */
  busca: Array<{ produto_id: string; aplicacao: string | null; referencias: string | null }>;
}

/** Função pura: linhas e colunas da 0033 a partir do "hoje" (AAAA-MM-DD) e dos dados do demo.ts. */
export function dadosDemoCatalogoCadastro(p: { tenantId: string; hoje: string; dados: Pick<DadosDemo, 'core.produto' | 'catalogo.produto_conteudo'> }): DadosDemoCatalogoCadastro {
  const anoAtual = Number(p.hoje.slice(0, 4));
  const produtoPorSku = new Map(p.dados['core.produto'].map((x) => [String(x.sku), String(x.id)]));
  const idProduto = (sku: string) => {
    const v = produtoPorSku.get(sku);
    if (!v) throw new Error(`[db] demo: referência de produto que não está na base (${sku})`);
    return v;
  };
  const referencias = REFERENCIAS_DEMO.map(([sku, marca, codigo, ordem]) => ({
    id: idProdutoReferenciaDemo(sku, ordem),
    tenant_id: p.tenantId,
    produto_id: idProduto(sku),
    marca_id: idMarcaConcorrenteDemo(marca),
    // 0034: retrato do nome da marca do Promotor (o que a rota do BKO grava depois de validar por promotor.concorrentes@1)
    marca_nome: MARCAS_CONCORRENTES_DEMO[marca],
    codigo,
    codigo_compacto: codigoCompacto(codigo),
    ordem,
    ...comuns,
  }));
  const skuPorProduto = new Map([...produtoPorSku].map(([sku, pid]) => [pid, sku]));
  const etiquetas = p.dados['catalogo.produto_conteudo'].map((c) => ({ id: String(c.id), etiquetas: [...(ETIQUETAS_DEMO[skuPorProduto.get(String(c.produto_id)) ?? ''] ?? [])] }));
  const aplicacaoPorProduto = new Map(p.dados['catalogo.produto_conteudo'].map((c) => [String(c.produto_id), (c.aplicacoes as string | null) ?? null]));
  const busca = p.dados['core.produto'].map((x) => {
    const pid = String(x.id);
    const aplicacao = aplicacaoPorProduto.get(pid) ?? null;
    const refs = referencias.filter((r) => r.produto_id === pid);
    return {
      produto_id: pid,
      aplicacao: aplicacao ? expandirAplicacao(aplicacao, { anoAtual }).textoIndice : null,
      referencias: refs.length > 0 ? refs.flatMap((r) => [r.codigo, r.codigo_compacto]).join(' ') : null,
    };
  });
  return { 'catalogo.produto_referencia': referencias, etiquetas, busca };
}

/** Grava a parte da 0033 (dentro da transação do carregarDemo). Devolve quantas referências gravou (0 sem a 0033). */
export async function gravarDemoCatalogoCadastro(admin: ClientBase, p: { tenantId: string; hoje: string; dados: DadosDemo }): Promise<number> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed do Catálogo do cadastro da demo');
  const existe = await admin.query<{ ok: boolean }>("select to_regclass('catalogo.produto_referencia') is not null as ok");
  if (!existe.rows[0]?.ok) return 0;
  const d = dadosDemoCatalogoCadastro(p);
  // base em 0033 sem a 0034: grava sem o retrato do nome (a coluna não existe ainda)
  const comNome = await admin.query<{ ok: boolean }>(
    "select exists (select 1 from information_schema.columns where table_schema = 'catalogo' and table_name = 'produto_referencia' and column_name = 'marca_nome') as ok",
  );
  const referencias = comNome.rows[0]?.ok ? d['catalogo.produto_referencia'] : d['catalogo.produto_referencia'].map(({ marca_nome: _semNome, ...r }) => r);
  const n = await gravarLinhas(admin, 'catalogo.produto_referencia', referencias);
  for (const e of d.etiquetas) {
    await admin.query('update catalogo.produto_conteudo set etiquetas = $3::text[] where tenant_id = $1 and id = $2', [p.tenantId, e.id, arrayDeTextoLivre(e.etiquetas)]);
  }
  for (const b of d.busca) {
    await admin.query('update catalogo.produto_busca set aplicacao = $3, referencias = $4 where tenant_id = $1 and produto_id = $2 and deleted_at is null', [
      p.tenantId,
      b.produto_id,
      b.aplicacao,
      b.referencias,
    ]);
  }
  return n;
}
