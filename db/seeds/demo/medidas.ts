/**
 * Base de DEMONSTRAÇÃO — medidas do produto (core.medida, migração 0018, T-0063; RN-CORE-19, RF-CORE-14). Dono: banco-dados.
 * Arquivo próprio: o demo.ts chama `gravarDemoMedidas(admin, tabela, dados)` DENTRO do laço do `carregarDemo`, logo
 * depois de gravar cada tabela (uma linha; ver o recado do T-0063 ao banco-dados local):
 *     await gravarDemoMedidas(admin, tabela, dados);
 * com `import { gravarDemoMedidas } from './medidas';` no topo.
 *
 * - Depois de `plataforma.tenant` (o gatilho tenant_semear_medidas já semeou a lista inicial): na demo ficam ATIVAS
 *   UN, CX, FD, LT e BD; PCT, TB, GL, KG, DZ e DP ficam INATIVAS (não ausentes: o banco semeia as 11 em todo tenant e
 *   medida não se apaga — o BKO mostra as inativas para reativar). Sigla usada por produto da demo que não esteja na
 *   lista inicial (hoje só PC, do PAP-4 — pedido ao banco-dados local para trocá-lo por UN) entra ativa, para a FK
 *   produto_medida_fk não recusar o produto.
 * - Depois de `core.produto`: embalagem do produto (embalagem_medida + embalagem_quantidade) = a caixa de embarque do
 *   demo.ts (linha de core.produto_unidade com fator > 1 — "CX c/ 12" etc.); os demais ficam sem embalagem.
 *
 * Idempotente (upsert por id determinístico idMedida = o da semeadura do banco; o UPDATE da embalagem regrava o mesmo
 * valor). Só tenant demo; só Postgres local (exigirBancoLocal). Exige a 0018 (`to_regclass('core.medida')`).
 * CICLO DE IMPORT: o demo.ts importa este arquivo; daqui só o TIPO de './demo' (import de valor seria circular).
 */
import type { ClientBase } from 'pg';
import { exigirBancoLocal, hostDoCliente } from '../../src/config';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idMedida, MEDIDAS_INICIAIS } from '../../src/ids';
import type { DadosDemo } from './demo';

/** Medidas ativas na demo (T-0063). As demais da lista inicial ficam inativas. */
export const MEDIDAS_ATIVAS_DEMO = ['UN', 'CX', 'FD', 'LT', 'BD'] as const;
/** Descrição das siglas fora da lista inicial que a demo ainda usa (some quando o PAP-4 passar a UN). */
const DESCRICAO_EXTRA: Record<string, string> = { PC: 'Peça' };

export interface DadosDemoMedidas {
  tenantId: string;
  /** Linhas de core.medida (lista inicial + siglas extras usadas pelos produtos da demo). */
  medidas: Linha[];
  /** Embalagem por produto: [produto_id, medida, quantidade] — só os produtos com caixa de embarque. */
  embalagens: Array<[string, string, number]>;
}

/** Função pura: o que este seed grava, a partir das linhas do demo.ts. */
export function dadosDemoMedidas(dados: Pick<DadosDemo, 'plataforma.tenant' | 'core.produto' | 'core.produto_unidade'>): DadosDemoMedidas {
  const tenantId = String(dados['plataforma.tenant'][0]!.id);
  const ativas = new Set<string>(MEDIDAS_ATIVAS_DEMO);
  const iniciais = new Set<string>(MEDIDAS_INICIAIS.map(([s]) => s));
  const usadas = new Set([...dados['core.produto'].map((p) => String(p.unidade)), ...dados['core.produto_unidade'].map((u) => String(u.unidade))]);
  const linha = (sigla: string, descricao: string, ativo: boolean): Linha => ({
    id: idMedida(tenantId, sigla), tenant_id: tenantId, sigla, descricao, ativo, deleted_at: null, external_id: null,
  });
  const medidas = [
    ...MEDIDAS_INICIAIS.map(([sigla, descricao]) => linha(sigla, descricao, ativas.has(sigla) || usadas.has(sigla))),
    ...[...usadas].filter((s) => !iniciais.has(s)).sort().map((s) => linha(s, DESCRICAO_EXTRA[s] ?? s, true)),
  ];
  const unidadeDe = new Map(dados['core.produto'].map((p) => [String(p.id), String(p.unidade)]));
  const embalagens: Array<[string, string, number]> = dados['core.produto_unidade']
    .filter((u) => Number(u.fator) > 1 && u.deleted_at == null && String(u.unidade) !== unidadeDe.get(String(u.produto_id)))
    .map((u) => [String(u.produto_id), String(u.unidade), Number(u.fator)]);
  const porProduto = new Map<string, [string, string, number]>();
  for (const e of embalagens) if (!porProduto.has(e[0])) porProduto.set(e[0], e);
  return { tenantId, medidas, embalagens: [...porProduto.values()] };
}

/**
 * Grava a parte de medidas da demo logo depois de `tabela` (chamar dentro da transação do carregarDemo, depois de cada
 * gravarLinhas). Ignora as demais tabelas.
 */
export async function gravarDemoMedidas(admin: ClientBase, tabela: string, dados: DadosDemo): Promise<void> {
  if (tabela !== 'plataforma.tenant' && tabela !== 'core.produto') return;
  exigirBancoLocal(hostDoCliente(admin), 'Seed das medidas da demo');
  const r = await admin.query<{ ok: boolean }>("select to_regclass('core.medida') is not null as ok");
  if (!r.rows[0]?.ok) throw new Error('[db] medidas da demo precisam da migração até a 0018 (falta core.medida): rode "banco migrar up" antes.');
  const d = dadosDemoMedidas(dados);
  if (tabela === 'plataforma.tenant') {
    await gravarLinhas(admin, 'core.medida', d.medidas);
    return;
  }
  // core.produto: zera a embalagem dos produtos da demo e grava as caixas (idempotente)
  await admin.query("select set_config('app.tenant_id', $1, true)", [d.tenantId]);
  await admin.query('update core.produto set embalagem_medida = null, embalagem_quantidade = null where tenant_id = $1 and id = any($2::uuid[]) and embalagem_medida is not null', [
    d.tenantId,
    dados['core.produto'].map((p) => p.id),
  ]);
  if (d.embalagens.length > 0) {
    await admin.query(
      `update core.produto p set embalagem_medida = e.medida, embalagem_quantidade = e.quantidade
         from unnest($2::uuid[], $3::text[], $4::int[]) as e (produto_id, medida, quantidade)
        where p.tenant_id = $1 and p.id = e.produto_id`,
      [d.tenantId, d.embalagens.map((e) => e[0]), d.embalagens.map((e) => e[1]), d.embalagens.map((e) => e[2])],
    );
  }
}
