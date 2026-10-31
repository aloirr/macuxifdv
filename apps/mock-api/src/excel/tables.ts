/**
 * Definição das planilhas de mock-data/ (docs/08-fase-mockup-excel.md).
 * Uma tabela por aba, cabeçalho na linha 1, colunas iguais aos campos do modelo de dados.
 *
 * Tipos de coluna:
 *  s  texto · i inteiro · n número · b booleano (sim/não, true/false, 1/0)
 *  d  data civil AAAA-MM-DD · dt instante ISO (UTC) · m dinheiro decimal (ex.: 89.90)
 * Colunas `m` ficam em memória como centavos inteiros no campo `<coluna>_cents`.
 */
export type ColType = 's' | 'i' | 'n' | 'b' | 'd' | 'dt' | 'm';
export interface ColumnDef {
  name: string;
  type: ColType;
  width?: number;
}
export interface SheetDef {
  sheet: string;
  columns: ColumnDef[];
}
export interface FileDef {
  /** caminho relativo a mock-data/ */
  file: string;
  /** entrada = vem do ERP (só leitura para o front); parametros = analista edita; saida = sistema grava */
  area: 'entrada' | 'parametros' | 'saida';
  sheets: Record<string, SheetDef>;
}

const c = (name: string, type: ColType = 's', width?: number): ColumnDef => ({ name, type, width });

export const FILES = {
  empresa: {
    file: 'entrada/empresa.xlsx',
    area: 'entrada',
    sheets: {
      tenant: { sheet: 'empresa', columns: [c('id'), c('name', 's', 30), c('cnpj', 's', 20), c('timezone', 's', 18), c('product_name', 's', 22), c('plan'), c('status'), c('erp_name'), c('last_erp_load_at', 'dt', 22)] },
      branch: { sheet: 'filiais', columns: [c('id'), c('tenant_id'), c('erp_code'), c('name', 's', 18), c('city', 's', 14), c('uf'), c('is_distribution_center', 'b')] },
      app_user: { sheet: 'usuarios', columns: [c('id'), c('tenant_id'), c('name', 's', 22), c('email', 's', 30), c('role', 's', 14), c('branch_id'), c('seller_id'), c('active', 'b')] },
    },
  },
  vendedores: {
    file: 'entrada/vendedores.xlsx',
    area: 'entrada',
    sheets: {
      seller: { sheet: 'vendedores', columns: [c('id'), c('tenant_id'), c('user_id'), c('erp_code'), c('name', 's', 22), c('short_name', 's', 12), c('team_id'), c('branch_id'), c('region', 's', 14), c('active', 'b')] },
      team: { sheet: 'equipes', columns: [c('id'), c('tenant_id'), c('name', 's', 16), c('manager_user_id')] },
    },
  },
  clientes: {
    file: 'entrada/clientes.xlsx',
    area: 'entrada',
    sheets: {
      customer: {
        sheet: 'clientes',
        columns: [
          c('id'), c('tenant_id'), c('erp_code'), c('legal_name', 's', 34), c('trade_name', 's', 30), c('cnpj', 's', 20), c('segment', 's', 14),
          c('abc_curve'), c('address', 's', 28), c('city', 's', 12), c('district', 's', 16), c('lat', 'n'), c('lng', 'n'),
          c('credit_limit', 'm', 12), c('seller_id'), c('phone', 's', 16), c('email', 's', 28), c('customer_since', 'd', 12),
        ],
      },
    },
  },
  produtos: {
    file: 'entrada/produtos.xlsx',
    area: 'entrada',
    sheets: {
      product: {
        sheet: 'produtos',
        columns: [c('id'), c('tenant_id'), c('erp_code', 's', 12), c('description', 's', 32), c('brand', 's', 12), c('line', 's', 14), c('unit'), c('active', 'b'), c('applications', 's', 36), c('is_campaign', 'b'), c('image_url')],
      },
    },
  },
  precos: {
    file: 'entrada/precos.xlsx',
    area: 'entrada',
    sheets: {
      price_table: { sheet: 'tabelas', columns: [c('id'), c('tenant_id'), c('erp_code'), c('name', 's', 22)] },
      price_item: { sheet: 'itens', columns: [c('id'), c('tenant_id'), c('price_table_id'), c('product_id'), c('price', 'm', 10)] },
      customer_price_table: { sheet: 'cliente_tabela', columns: [c('tenant_id'), c('customer_id'), c('price_table_id')] },
    },
  },
  estoque: {
    file: 'entrada/estoque.xlsx',
    area: 'entrada',
    sheets: { stock: { sheet: 'estoque', columns: [c('tenant_id'), c('product_id'), c('branch_id'), c('quantity', 'i'), c('updated_at', 'dt', 22)] } },
  },
  titulos: {
    file: 'entrada/titulos.xlsx',
    area: 'entrada',
    sheets: {
      receivable: { sheet: 'titulos', columns: [c('id'), c('tenant_id'), c('customer_id'), c('document', 's', 14), c('due_date', 'd', 12), c('amount', 'm', 12), c('open_amount', 'm', 12), c('status')] },
    },
  },
  notas: {
    file: 'entrada/notas.xlsx',
    area: 'entrada',
    sheets: {
      invoice: { sheet: 'notas', columns: [c('id'), c('tenant_id'), c('erp_code'), c('customer_id'), c('seller_id'), c('branch_id'), c('issued_at', 'dt', 22), c('total', 'm', 12)] },
      invoice_item: { sheet: 'itens', columns: [c('id'), c('tenant_id'), c('invoice_id'), c('product_id'), c('quantity', 'i'), c('unit_price', 'm'), c('total', 'm')] },
    },
  },
  rotas: {
    file: 'entrada/rotas.xlsx',
    area: 'entrada',
    sheets: {
      route_plan: { sheet: 'rotas', columns: [c('id'), c('tenant_id'), c('seller_id'), c('date', 'd', 12), c('status'), c('region', 's', 14)] },
      route_stop: { sheet: 'paradas', columns: [c('id'), c('tenant_id'), c('route_plan_id'), c('customer_id'), c('sequence', 'i'), c('window_start'), c('window_end')] },
    },
  },
  metas: {
    file: 'parametros/metas.xlsx',
    area: 'parametros',
    sheets: {
      goal_period: { sheet: 'periodos', columns: [c('id'), c('tenant_id'), c('year_month'), c('status'), c('closed_by', 's', 18), c('closed_at', 'dt', 22)] },
      goal: { sheet: 'metas', columns: [c('id'), c('tenant_id'), c('period_id'), c('seller_id'), c('kpi_code', 's', 14), c('target_value', 'n', 12)] },
      kpi: { sheet: 'indicadores', columns: [c('id'), c('tenant_id'), c('code', 's', 14), c('name', 's', 18), c('unit'), c('direction', 's', 18), c('projectable', 'b'), c('rule_text', 's', 50)] },
      holiday: { sheet: 'feriados', columns: [c('tenant_id'), c('date', 'd', 12), c('name', 's', 30)] },
      setting: { sheet: 'configuracoes', columns: [c('tenant_id'), c('key', 's', 28), c('value', 's', 14), c('description', 's', 50)] },
    },
  },
  plano_rv: {
    file: 'parametros/plano_rv.xlsx',
    area: 'parametros',
    sheets: {
      incentive_plan: { sheet: 'planos', columns: [c('id'), c('tenant_id'), c('name', 's', 24), c('valid_from'), c('applies_to', 's', 24), c('max_amount', 'm', 12), c('updated_at', 'dt', 22), c('updated_by', 's', 22), c('last_change', 's', 50)] },
      incentive_rule: { sheet: 'regras', columns: [c('id'), c('tenant_id'), c('plan_id'), c('kpi_code', 's', 14), c('weight_pct', 'n'), c('is_trigger', 'b')] },
      incentive_band: { sheet: 'faixas', columns: [c('id'), c('tenant_id'), c('plan_id'), c('kpi_code', 's', 14), c('from_pct', 'n'), c('mode', 's', 14), c('payout_pct', 'n')] },
    },
  },
  alcadas: {
    file: 'parametros/alcadas.xlsx',
    area: 'parametros',
    sheets: {
      discount_level: { sheet: 'alcadas', columns: [c('tenant_id'), c('role', 's', 14), c('max_discount_pct', 'n'), c('description', 's', 40)] },
      discount_exception: { sheet: 'excecoes', columns: [c('tenant_id'), c('seller_id'), c('max_discount_pct', 'n')] },
    },
  },
  pedidos: {
    file: 'saida/pedidos.xlsx',
    area: 'saida',
    sheets: {
      sales_order: {
        sheet: 'pedidos',
        columns: [
          c('id', 's', 38), c('tenant_id'), c('number'), c('idempotency_key', 's', 38), c('seller_id'), c('customer_id'), c('branch_id'), c('price_table_id'),
          c('discount_pct', 'n'), c('subtotal', 'm', 12), c('discount_amount', 'm', 12), c('total', 'm', 12), c('payment_terms', 's', 12), c('status', 's', 16),
          c('pending_reason', 's', 40), c('rejection_reason', 's', 40), c('erp_order_code'), c('route_stop_id'), c('created_offline_at', 'dt', 22), c('received_at', 'dt', 22), c('updated_at', 'dt', 22),
        ],
      },
      sales_order_item: { sheet: 'itens', columns: [c('id', 's', 38), c('tenant_id'), c('order_id', 's', 38), c('product_id'), c('quantity', 'i'), c('unit_price', 'm'), c('discount_pct', 'n'), c('total', 'm')] },
    },
  },
  visitas: {
    file: 'saida/visitas.xlsx',
    area: 'saida',
    sheets: {
      visit: {
        sheet: 'visitas',
        columns: [c('id', 's', 38), c('tenant_id'), c('seller_id'), c('customer_id'), c('route_stop_id'), c('checkin_at', 'dt', 22), c('received_at', 'dt', 22), c('lat', 'n'), c('lng', 'n'), c('outcome'), c('no_order_reason', 's', 24), c('order_id', 's', 38), c('checkout_at', 'dt', 22), c('closed_by')],
      },
    },
  },
  aprovacoes: {
    file: 'saida/aprovacoes.xlsx',
    area: 'saida',
    sheets: {
      order_approval: {
        sheet: 'aprovacoes',
        columns: [c('id', 's', 38), c('tenant_id'), c('order_id', 's', 38), c('requested_by'), c('reason_requested', 's', 40), c('requested_at', 'dt', 22), c('decided_by'), c('decision'), c('reason', 's', 40), c('decided_at', 'dt', 22)],
      },
    },
  },
  auditoria: {
    file: 'saida/auditoria.xlsx',
    area: 'saida',
    sheets: {
      audit_log: {
        sheet: 'auditoria',
        columns: [c('id', 's', 38), c('tenant_id'), c('user_id'), c('user_name', 's', 18), c('entity', 's', 16), c('entity_id', 's', 38), c('action', 's', 14), c('before', 's', 50), c('after', 's', 50), c('at', 'dt', 22)],
      },
    },
  },
  fechamentos: {
    file: 'saida/fechamento_rv.xlsx',
    area: 'saida',
    sheets: {
      goal_snapshot: {
        sheet: 'fechamento',
        columns: [c('id', 's', 38), c('tenant_id'), c('period_id'), c('seller_id'), c('kpi_code', 's', 14), c('target_value', 'n'), c('actual_value', 'n'), c('achievement_pct', 'n'), c('projected_pct', 'n'), c('incentive_amount', 'm'), c('computed_at', 'dt', 22)],
      },
    },
  },
} as const satisfies Record<string, FileDef>;

export type FileKey = keyof typeof FILES;
export type TableName = {
  [F in FileKey]: keyof (typeof FILES)[F]['sheets'];
}[FileKey];

/** Mapa tabela → arquivo, para saber o que regravar depois de uma mudança. */
export const TABLE_FILE: Record<string, FileKey> = Object.fromEntries(
  (Object.keys(FILES) as FileKey[]).flatMap((fk) => Object.keys(FILES[fk].sheets).map((t) => [t, fk])),
);
