/**
 * Base de DEMONSTRAÇÃO — plano de RV (core.plano_rv, migração 0028, T-0082; RN-CORE-29/30). Dono: banco-dados.
 * Arquivo próprio: o demo.ts chama `gravarDemoPlanoRv(admin, ...)` na MESMA transação do carregarDemo, depois do laço
 * (core.usuario já gravado: atualizado_por = o analista da demo).
 *
 * Um plano para o perfil vendedor, vigente desde o mês do PRIMEIRO seed (o mês de início não anda nas recargas: plano
 * que já valeu para mês fechado não muda, RN-CORE-30; o --recriar começa de novo no mês corrente). Valor máximo
 * R$ 2.000,00; venda 50%, positivação 30% e visitas 20%, todos com as faixas 0%: zero · 80%: proporcional ·
 * 100%: cheio · 110%: 120%; cobertura como gatilho (sem peso). Só os indicadores de INDICADORES_RV (contrato do core):
 * itens_por_pedido (T-0170) é meta, não entra no plano de RV. A recarga regrava as regras do plano da demo (só o mês de
 * início fica).
 *
 * Idempotente (upsert por id determinístico). Plano vivo do ensaio (gravado pelo BKO) no mesmo mês de início ou o plano
 * da demo excluído pelo BKO = o seed não grava (respeita o ensaio, como as metas). Banco sem a 0028 = nada a fazer.
 * Só tenant demo; só Postgres local ou servidor da demo (exigirBancoDemo).
 */
import type { ClientBase } from 'pg';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { anoMes } from '../../src/datas';
import { arrayDeTexto, gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico } from '../../src/ids';

export const ID_PLANO_RV_DEMO = idDeterministico('demo:plano_rv:padrao');
export const VALOR_MAXIMO_RV_DEMO = 200_000;

const FAIXAS = [
  { de_pct: 0, modo: 'zero', pagamento_pct: 0 },
  { de_pct: 80, modo: 'proporcional', pagamento_pct: 0 },
  { de_pct: 100, modo: 'fixo', pagamento_pct: 100 },
  { de_pct: 110, modo: 'fixo', pagamento_pct: 120 },
] as const;

/** Regras do plano da demo (formato RegraRvSchema de modules/core/contracts/plano-rv.ts). */
export const REGRAS_PLANO_RV_DEMO = [
  { indicador: 'venda_cents', peso_pct: 50, gatilho: false, faixas: FAIXAS },
  { indicador: 'positivacao', peso_pct: 30, gatilho: false, faixas: FAIXAS },
  { indicador: 'visitas', peso_pct: 20, gatilho: false, faixas: FAIXAS },
  { indicador: 'cobertura_pct', peso_pct: 0, gatilho: true, faixas: [] },
];

/** Função pura: a linha de core.plano_rv da demo para o "hoje" (AAAA-MM-DD) do seed. */
export function dadosDemoPlanoRv(p: { tenantId: string; hoje: string; atualizadoPor: string }): Linha {
  return {
    id: ID_PLANO_RV_DEMO,
    tenant_id: p.tenantId,
    nome: 'Plano de RV da demonstração',
    vigencia_inicio: anoMes(p.hoje),
    perfis: arrayDeTexto(['vendedor']),
    valor_maximo_cents: VALOR_MAXIMO_RV_DEMO,
    regras: REGRAS_PLANO_RV_DEMO,
    atualizado_por: p.atualizadoPor,
    deleted_at: null,
    external_id: null,
  };
}

/** Grava o plano da demo (dentro da transação do carregarDemo). Devolve quantas linhas gravou (0 ou 1). */
export async function gravarDemoPlanoRv(admin: ClientBase, p: { tenantId: string; hoje: string; atualizadoPor: string }): Promise<number> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed do plano de RV da demo');
  const existe = await admin.query<{ ok: boolean }>("select to_regclass('core.plano_rv') is not null as ok");
  if (!existe.rows[0]?.ok) return 0;
  const linha = dadosDemoPlanoRv(p);
  const atual = await admin.query<{ vigencia_inicio: string; apagado: boolean }>(
    'select vigencia_inicio, deleted_at is not null as apagado from core.plano_rv where tenant_id = $1 and id = $2',
    [p.tenantId, ID_PLANO_RV_DEMO],
  );
  if (atual.rows[0]?.apagado) return 0;
  const vigencia = atual.rows[0]?.vigencia_inicio ?? String(linha.vigencia_inicio);
  const outro = await admin.query(
    'select 1 from core.plano_rv where tenant_id = $1 and vigencia_inicio = $2 and id <> $3 and deleted_at is null',
    [p.tenantId, vigencia, ID_PLANO_RV_DEMO],
  );
  if ((outro.rowCount ?? 0) > 0) return 0;
  return gravarLinhas(admin, 'core.plano_rv', [linha], { preservar: ['vigencia_inicio'] });
}
