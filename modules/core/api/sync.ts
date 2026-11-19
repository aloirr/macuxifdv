/**
 * Provedores de sync do Core (T-0003 Fase 2, T-0017, T-0018; desenho T-0016 §2; ADR 0009):
 * pull de `cliente`, `carteira`, `produto`, `cliente_contato`, `cliente_financeiro`, `titulo`, `historico_compra`,
 * `motivo`, `rota`, `rota_parada`, `visita`, `meta`, `indicador_diario` (T-0020) e `cliente_visita_resumo` (RN-CORE-50, view); push de `visita` (check-in) e `visita_checkout` (`visita-push.ts`).
 * Todos: `updated_at < pedido.ate` (horizonte seguro) e `(updated_at, id) > desde`, ordenados, `limit`, `updated_at`
 * com microssegundos, removidos incluídos (`deleted_at`) e filtrados pela carteira do usuário (RN-CORE-04) quando
 * a entidade é de cliente (`escopo: 'carteira'`: a API devolve `versao_escopo` e o aparelho ressincroniza quando a
 * carteira muda) ou de usuário (`escopo: 'usuarios'`: rota, parada e visita da equipe visível, RN-CORE-04). Janelas do desenho §2 (o que sai da janela o app poda): as linhas REMOVIDAS passam sempre, para o
 * aparelho apagar. Valores em centavos saem como número (`::float8`, exato até 2^53), datas como texto.
 * Somente pull: cadastro vem do ERP/BKO (`servidor_vence`).
 */
import { sqlCodigoFdv } from './codigo-fdv';
import { definirEntidadeSync, type ContextoBase, type LinhaSync, type PedidoPull, type ProvedorSync } from '@macuxi/platform-sdk';
import {
  PARAMETRO_ALERTAS_PRODUTIVIDADE,
  PARAMETRO_ALMOCO_PADRAO,
  PARAMETRO_DIAS_UTEIS,
  PARAMETRO_FERIADOS,
  PARAMETRO_PARADO_MIN,
  PARAMETRO_PROMOTOR_VE_PEDIDOS,
  PARAMETRO_RASTREAMENTO,
  CarteiraSyncSchema,
  ClienteContatoSyncSchema,
  ClienteFinanceiroSyncSchema,
  ClienteSyncSchema,
  ClienteFotoPushSchema,
  ClienteFotoSyncSchema,
  FilialSyncSchema,
  UsuarioSyncSchema,
  ClienteVisitaResumoSyncSchema,
  FotoTipoSyncSchema,
  MedidaSyncSchema,
  ProdutoUnidadeSyncSchema,
  ClienteEnderecoSyncSchema,
  CheckinVisitaSchema,
  CheckoutVisitaSchema,
  HistoricoCompraSyncSchema,
  IndicadorDiarioSyncSchema,
  MetaSyncSchema,
  MotivoSyncSchema,
  ParametroSyncSchema,
  ProdutoSyncSchema,
  RotaParadaSyncSchema,
  RotaSyncSchema,
  TituloSyncSchema,
  VisitaSyncSchema,
} from '../contracts';
import { dataLocal, perfilRecebeHistoricoDeCompra } from '../domain';
import { JANELAS_CORE, janelaMesAnteriorOu40 } from './janelas-sync';
import { descontoMaximoAplicavel } from '../domain/produto-preco';
import { padraoDeDesconto } from './produtos';
import { lerPromotorVePedidos } from './promotor-pedidos';
import { receberFotosPdv } from './foto-pdv-push';
import { receberCheckins, receberCheckouts } from './visita-push';

const UTC = `'YYYY-MM-DD"T"HH24:MI:SS.US"Z"'`;
/** Placeholder de "hoje" nas janelas: substituído pela data civil do fuso do tenant (RN-CORE-11, regra 4), nunca por `current_date` do banco (UTC). */
export const HOJE = '{{hoje}}';

/** Troca o placeholder pela data (AAAA-MM-DD, validada: nunca vem de entrada do usuário). */
export function comHoje(sql: string, hoje: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(hoje)) throw new Error(`Data "hoje" inválida: ${hoje}`);
  return sql.replaceAll(HOJE, `date '${hoje}'`);
}

export const BASE = `id, to_char(updated_at at time zone 'UTC', ${UTC}) as updated_at, to_char(deleted_at at time zone 'UTC', ${UTC}) as deleted_at, external_id`;

export interface Tabela {
  tabela: string;
  colunas: string;
  /** Coluna com o `cliente_id` para filtrar pela carteira; `null` = cadastro do tenant inteiro. */
  colunaCliente: 'id' | 'cliente_id' | null;
  /** Coluna com o `usuario_id` para filtrar pelos usuários visíveis (escopo `usuarios`). */
  colunaUsuario?: 'usuario_id';
  /** Janela do desenho §2 (SQL fixo, sem entrada do usuário). Linhas removidas passam sempre. */
  janela?: string;
  /** Filtro fixo que vale também para linhas removidas (SQL fixo, sem entrada do usuário). */
  onde?: string;
}

/** Chaves de `plataforma.parametro` (módulo core) que vão ao aparelho no pull `parametro` (lista fixa). */
const CHAVES_PARAMETRO_SYNC = ['checkin.raio_m', PARAMETRO_PROMOTOR_VE_PEDIDOS, PARAMETRO_DIAS_UTEIS, PARAMETRO_PARADO_MIN, PARAMETRO_FERIADOS, PARAMETRO_ALMOCO_PADRAO, PARAMETRO_ALERTAS_PRODUTIVIDADE, PARAMETRO_RASTREAMENTO] as const;

export const TABELAS_SYNC = {
  cliente: {
    tabela: 'core.cliente',
    colunas:
      'documento, razao_social, nome_fantasia, segmento, telefone, email, logradouro, numero, bairro, cidade, uf, cep, latitude::text as latitude, longitude::text as longitude, ativo, inscricao_estadual, observacao, cadastro_incompleto, cadastro_campos_faltantes, prazo_medio_max_dias, formas_pagamento, canal, filial_id',
    colunaCliente: 'id',
  },
  carteira: {
    tabela: 'core.carteira',
    colunas:
      "cliente_id, usuario_id, papel, to_char(inicio, 'YYYY-MM-DD') as inicio, to_char(fim, 'YYYY-MM-DD') as fim, frequencia_semanas, dia_semana",
    colunaCliente: 'cliente_id',
    // vigentes e encerradas há ≤ 40 dias
    janela: "(fim is null or fim >= {{hoje}} - 40)",
  },
  produto: { tabela: 'core.produto', colunas: 'sku, ean, nome, marca, categoria, unidade, embalagem_medida, embalagem_quantidade, preco_venda_cents::float8 as preco_venda_cents, desconto_maximo_pct::float8 as desconto_maximo_pct, ativo', colunaCliente: null },
  // RN-VEN-11a (T-0168): a linha do próprio usuário (e da equipe visível) com as colunas de limite de desconto; sem nome, e-mail nem telefone.
  usuario: {
    // T-0176 / RN-CORE-39: `filial_cadastro_id`, `filial_venda_ids` e `sem_filial` (sem cadastro, qualquer perfil); o `updated_at` acompanha a troca de filiais (cadastro ou venda)
    tabela: `(select u.id as usuario_id, u.id, greatest(u.updated_at, coalesce(f.alterado_em, u.updated_at)) as updated_at, u.deleted_at, null::text as external_id, ${sqlCodigoFdv('u')} as codigo_fdv,
        u.desconto_limita_item, u.desconto_limita_pedido, u.desconto_maximo_pedido_permil, u.filial_cadastro_id, coalesce(f.filial_venda_ids, '{}'::uuid[]) as filial_venda_ids,
        (u.filial_cadastro_id is null) as sem_filial, u.almoco_inicio_min, u.almoco_fim_min
      from core.usuario u
      left join lateral (select max(uf.updated_at) as alterado_em,
                                  array_agg(uf.filial_id order by uf.created_at, uf.filial_id) filter (where uf.deleted_at is null) as filial_venda_ids
                           from core.usuario_filial uf where uf.usuario_id = u.id) f on true) as usuario`,
    colunas: 'codigo_fdv, desconto_limita_item, desconto_limita_pedido, desconto_maximo_pedido_permil, filial_cadastro_id, filial_venda_ids, sem_filial, almoco_inicio_min, almoco_fim_min',
    colunaCliente: null,
    colunaUsuario: 'usuario_id',
  },
  // RN-CORE-50 (cliente_visita_resumo@1): total de visitas e última visita (instante UTC, quem e nome) de qualquer usuário, da view do banco-dados
  cliente_visita_resumo: {
    tabela: '(select r.cliente_id as id, r.cliente_id, r.updated_at, null::timestamptz as deleted_at, null::text as external_id, r.total_visitas, r.ultima_visita_em, r.ultima_visita_usuario_id, r.ultima_visita_usuario_nome from core.v_cliente_visita_resumo r) as cliente_visita_resumo',
    colunas: `cliente_id, total_visitas::int as total_visitas, to_char(ultima_visita_em at time zone 'UTC', ${UTC}) as ultima_visita_em, ultima_visita_usuario_id, ultima_visita_usuario_nome`,
    colunaCliente: 'cliente_id',
  },
  foto_tipo: { tabela: 'core.foto_tipo', colunas: 'nome, obrigatorio, sensivel, fachada, ordem, ativo', colunaCliente: null },
  // ADR 0041: o vendedor nunca recebe o id do arquivo de documento sensível (CNH, contrato): vem nulo e ele só sabe que existe
  cliente_foto: {
    tabela: `(select f.id, f.updated_at, f.deleted_at, f.external_id, f.cliente_id, f.foto_tipo_id, case when t.fachada then f.arquivo_id else null end as arquivo_id, f.origem, to_char(f.tirada_em at time zone 'UTC', ${UTC}) as tirada_em from core.cliente_foto f join core.foto_tipo t on t.id = f.foto_tipo_id) as cliente_foto`,
    colunas: 'cliente_id, foto_tipo_id, arquivo_id, origem, tirada_em',
    colunaCliente: 'cliente_id',
  },
  filial: { tabela: 'core.filial', colunas: 'codigo, nome, cidade, uf, padrao, ativo, cnpj, logradouro, numero, complemento, bairro, cep, telefone', colunaCliente: null },
  medida: { tabela: 'core.medida', colunas: 'sigla, descricao, ativo', colunaCliente: null },
  produto_unidade: { tabela: 'core.produto_unidade', colunas: 'produto_id, unidade, fator, ean, padrao, ativo', colunaCliente: null },
  cliente_endereco: {
    tabela: 'core.cliente_endereco',
    colunas: 'cliente_id, tipo, descricao, logradouro, numero, complemento, bairro, cidade, uf, cep, latitude::text as latitude, longitude::text as longitude, principal, ativo',
    colunaCliente: 'cliente_id',
  },
  cliente_contato: {
    tabela: 'core.cliente_contato',
    colunas: 'cliente_id, nome, cargo, telefone, whatsapp, email, principal',
    colunaCliente: 'cliente_id',
  },
  cliente_financeiro: {
    tabela: 'core.cliente_financeiro',
    colunas: `cliente_id, limite_cents::float8 as limite_cents, saldo_aberto_cents::float8 as saldo_aberto_cents, credito_disponivel_cents::float8 as credito_disponivel_cents, bloqueado, motivo_bloqueio, to_char(atualizado_erp_em at time zone 'UTC', ${UTC}) as atualizado_erp_em`,
    colunaCliente: 'cliente_id',
  },
  titulo: {
    tabela: 'core.titulo',
    colunas: `cliente_id, documento, parcela, to_char(emissao, 'YYYY-MM-DD') as emissao, to_char(vencimento, 'YYYY-MM-DD') as vencimento, valor_cents::float8 as valor_cents, saldo_cents::float8 as saldo_cents, situacao, to_char(liquidado_em at time zone 'UTC', ${UTC}) as liquidado_em`,
    colunaCliente: 'cliente_id',
    // abertos + vencimento ≥ hoje − 90
    janela: "(situacao = 'aberto' or vencimento >= {{hoje}} - 90)",
  },
  historico_compra: {
    tabela: 'core.historico_compra',
    colunas: "cliente_id, ano_mes, valor_cents::float8 as valor_cents, pedidos, itens, to_char(ultima_compra_em, 'YYYY-MM-DD') as ultima_compra_em, origem",
    colunaCliente: 'cliente_id',
    // ano_mes ≥ 12 meses atrás
    janela: "ano_mes >= to_char({{hoje}} - interval '12 months', 'YYYY-MM')",
  },
  motivo: {
    tabela: 'core.motivo',
    colunas: 'tipo, codigo, descricao, exige_foto, sistema, ativo, ordem',
    colunaCliente: null,
  },
  // RN-CORE-10 / T-0061: o raio do check-in, a opção promotor_ve_pedidos, (T-0073) os parâmetros do Início e (T-0170) os feriados
  // do tenant e o almoço da Performance vão ao aparelho (lista fixa; nada de outros parâmetros do tenant)
  parametro: {
    tabela: 'plataforma.parametro',
    colunas: 'modulo, chave, valor',
    colunaCliente: null,
    onde: `modulo = 'core' and chave in (${CHAVES_PARAMETRO_SYNC.map((c) => `'${c}'`).join(', ')})`,
  },
  rota: {
    tabela: 'core.rota',
    colunas: "usuario_id, to_char(data, 'YYYY-MM-DD') as data, situacao, origem, regiao, observacao",
    colunaCliente: null,
    colunaUsuario: 'usuario_id',
    // data ≥ least(hoje − 40, início do mês anterior), SEM limite superior (ADR 0009, adendo §5): rota futura nunca fica para trás
    // do cursor; o mês anterior inteiro vai para a Performance do aparelho (T-0170, performance-produtividade.md §7.2)
    janela: janelaMesAnteriorOu40('data'),
  },
  rota_parada: {
    tabela: 'core.rota_parada',
    colunas: "rota_id, usuario_id, to_char(data, 'YYYY-MM-DD') as data, cliente_id, sequencia, to_char(janela_inicio, 'HH24:MI') as janela_inicio, to_char(janela_fim, 'HH24:MI') as janela_fim",
    colunaCliente: null,
    colunaUsuario: 'usuario_id',
    janela: janelaMesAnteriorOu40('data'),
  },
  visita: {
    tabela: 'core.visita',
    colunas: `usuario_id, cliente_id, rota_parada_id, to_char(data_local, 'YYYY-MM-DD') as data_local,
      to_char(checkin_em at time zone 'UTC', ${UTC}) as checkin_em, checkin_lat::float8 as checkin_lat, checkin_lng::float8 as checkin_lng,
      sem_gps, distancia_m, fora_do_raio, justificativa_fora_raio, sugere_coordenada, extra,
      to_char(checkout_em at time zone 'UTC', ${UTC}) as checkout_em, resultado, motivo_id, motivo_texto, pedido_id, foto_fachada_id,
      fechada_por, checkout_id, etapas_pendentes`,
    colunaCliente: null,
    colunaUsuario: 'usuario_id',
    janela: janelaMesAnteriorOu40('data_local'),
  },
  // T-0020: metas e vendas diárias dos usuários visíveis, do mês anterior em diante (desenho T-0016 §2)
  meta: {
    tabela: 'core.meta',
    colunas: 'usuario_id, periodo, indicador, valor::float8 as valor, tipo',
    colunaCliente: null,
    colunaUsuario: 'usuario_id',
    janela: "periodo >= to_char({{hoje}} - interval '1 month', 'YYYY-MM')",
  },
  indicador_diario: {
    tabela: 'core.indicador_diario',
    colunas: "usuario_id, to_char(data, 'YYYY-MM-DD') as data, pedidos, vendido_cents::float8 as vendido_cents, cancelado_cents::float8 as cancelado_cents",
    colunaCliente: null,
    colunaUsuario: 'usuario_id',
    janela: "data >= date_trunc('month', {{hoje}} - interval '1 month')",
  },
} as const satisfies Record<string, Tabela>;

/** SQL e parâmetros da página (exportado para teste do texto e para o teste com banco). */
export function sqlDoPull(t: Tabela, pedido: PedidoPull, visiveis: ReadonlySet<string> | 'tenant', hoje?: string): { sql: string; valores: unknown[] } {
  const valores: unknown[] = [pedido.ate, pedido.desde?.updated_at ?? null, pedido.desde?.id ?? null, pedido.limite];
  let filtro = '';
  const coluna = t.colunaCliente ?? t.colunaUsuario;
  if (coluna && visiveis !== 'tenant') {
    valores.push([...visiveis]);
    filtro = `and ${coluna} = any($5::uuid[])`;
  }
  const fixo = t.onde ? `and ${t.onde}` : '';
  if (t.janela?.includes(HOJE) && !hoje) throw new Error(`Janela de ${t.tabela} exige a data de hoje no fuso do tenant.`);
  const janela = t.janela ? `and (deleted_at is not null or ${(hoje ? comHoje(t.janela, hoje) : t.janela)})` : '';
  const sql = `select ${BASE}, ${t.colunas}
    from ${t.tabela}
   where updated_at < $1::timestamptz
     and ($2::timestamptz is null or (updated_at, id) > ($2::timestamptz, $3::uuid))
     ${filtro}
     ${fixo}
     ${janela}
   order by updated_at, id
   limit $4`;
  return { sql, valores };
}

/**
 * RN-PRO-01 / T-0077 D2: `historico_compra` é leitura de pedidos. Promotor com `promotor_ve_pedidos` desligada recebe as linhas
 * como removidas (`deleted_at` = `updated_at`): o aparelho limpa o que já tinha e o cursor avança normalmente. A rota do parâmetro
 * toca o `updated_at` do histórico do tenant ao desligar (pull incremental recebe a remoção) e ao religar (aparelho puxa de novo;
 * todos os perfis rebaixam o histórico, aceitável porque a troca é rara). A linha oculta não leva dado de compra: os campos que o
 * `HistoricoCompraSyncSchema@1` exige seguem presentes, mas zerados (`valor_cents`, `pedidos`, `itens`) ou nulos (`ultima_compra_em`).
 */
export function ocultarHistorico(linhas: LinhaSync[]): LinhaSync[] {
  return linhas.map((l) => {
    const { id, updated_at, external_id, cliente_id, ano_mes, origem } = l as unknown as Record<string, unknown>;
    return { id, updated_at, deleted_at: updated_at, external_id, cliente_id, ano_mes, valor_cents: 0, pedidos: 0, itens: 0, ultima_compra_em: null, origem } as unknown as LinhaSync;
  });
}

/** T-0151 / RN-VEN-11: o aparelho recebe o desconto máximo EFETIVO (próprio ?? parâmetro do tenant ?? 15), nunca o nulo. */
export function comDescontoEfetivo(linhas: LinhaSync[], padrao: number): LinhaSync[] {
  return linhas.map((l) => {
    const r = l as unknown as { preco_venda_cents?: number | null; desconto_maximo_pct?: number | null };
    return { ...l, preco_venda_cents: r.preco_venda_cents ?? null, desconto_maximo_pct: descontoMaximoAplicavel(r.desconto_maximo_pct ?? null, padrao) } as unknown as LinhaSync;
  });
}

function puxarDe(t: Tabela) {
  return async (ctx: ContextoBase, pedido: PedidoPull): Promise<LinhaSync[]> => {
    const visiveis = t.colunaCliente ? await ctx.carteira() : t.colunaUsuario ? await ctx.usuariosVisiveis() : 'tenant';
    const { sql, valores } = sqlDoPull(t, pedido, visiveis, dataLocal(ctx.agora(), ctx.fuso()));
    return ctx.comTenant(async (db) => {
      const linhas = (await db.query(sql, valores)).rows as unknown as LinhaSync[];
      if (t.tabela === 'core.produto') return comDescontoEfetivo(linhas, await padraoDeDesconto(db));
      if (t.tabela !== 'core.historico_compra' || ctx.usuario.perfil !== 'promotor') return linhas;
      return perfilRecebeHistoricoDeCompra('promotor', await lerPromotorVePedidos(db)) ? linhas : ocultarHistorico(linhas);
    });
  };
}

/** `naJanela` (poda local, ADR 0009 §5) só nas entidades que têm janela no provedor (`JANELAS_CORE`). */
const pull = (nome: string, schema: Parameters<typeof definirEntidadeSync>[0]['schema']) =>
  definirEntidadeSync({ nome, modulo: 'core', direcao: 'pull', conflito: 'servidor_vence', schema, ...(nome in JANELAS_CORE ? { naJanela: JANELAS_CORE[nome as keyof typeof JANELAS_CORE] } : {}) });

export const entidadeCliente = pull('cliente', ClienteSyncSchema);
export const entidadeCarteira = pull('carteira', CarteiraSyncSchema);
export const entidadeProduto = pull('produto', ProdutoSyncSchema);
export const entidadeUsuario = pull('usuario', UsuarioSyncSchema);
export const entidadeClienteVisitaResumo = pull('cliente_visita_resumo', ClienteVisitaResumoSyncSchema);
export const entidadeFotoTipo = pull('foto_tipo', FotoTipoSyncSchema);
/** Foto do PDV (RN-CORE-38): o aparelho envia o comando (`ClienteFotoPushSchema`) e recebe a linha (`ClienteFotoSyncSchema`); os bytes vão pela fila de arquivos. */
export const entidadeClienteFoto = definirEntidadeSync({ nome: 'cliente_foto', modulo: 'core', direcao: 'ambos', conflito: 'servidor_vence', schema: ClienteFotoPushSchema, schemaLinha: ClienteFotoSyncSchema });
export const entidadeFilial = pull('filial', FilialSyncSchema);
export const entidadeMedida = pull('medida', MedidaSyncSchema);
export const entidadeProdutoUnidade = pull('produto_unidade', ProdutoUnidadeSyncSchema);
export const entidadeClienteEndereco = pull('cliente_endereco', ClienteEnderecoSyncSchema);
export const entidadeClienteContato = pull('cliente_contato', ClienteContatoSyncSchema);
export const entidadeClienteFinanceiro = pull('cliente_financeiro', ClienteFinanceiroSyncSchema);
export const entidadeTitulo = pull('titulo', TituloSyncSchema);
export const entidadeHistoricoCompra = pull('historico_compra', HistoricoCompraSyncSchema);
export const entidadeMotivo = pull('motivo', MotivoSyncSchema);
export const entidadeParametro = pull('parametro', ParametroSyncSchema);
export const entidadeRota = pull('rota', RotaSyncSchema);
export const entidadeRotaParada = pull('rota_parada', RotaParadaSyncSchema);
export const entidadeMeta = pull('meta', MetaSyncSchema);
export const entidadeIndicadorDiario = pull('indicador_diario', IndicadorDiarioSyncSchema);
/** Check-in: o aparelho envia o comando (`CheckinVisitaSchema`) e recebe a linha (`VisitaSyncSchema`). Sobreposição da fila: ADR 0009 §3. */
export const entidadeVisita = definirEntidadeSync({
  nome: 'visita',
  modulo: 'core',
  direcao: 'ambos',
  conflito: 'servidor_vence',
  schema: CheckinVisitaSchema,
  schemaLinha: VisitaSyncSchema,
  naJanela: JANELAS_CORE.visita,
});
/** Checkout: comando só de envio, nunca conflita (a fechada sozinha cede ao checkout do usuário). */
export const entidadeVisitaCheckout = definirEntidadeSync({
  nome: 'visita_checkout',
  modulo: 'core',
  direcao: 'push',
  conflito: 'somente_insercao',
  schema: CheckoutVisitaSchema,
});

export const provedoresSyncCore: readonly ProvedorSync[] = [
  { entidade: entidadeCliente, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.cliente) },
  { entidade: entidadeCarteira, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.carteira) },
  { entidade: entidadeProduto, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC.produto) },
  { entidade: entidadeMedida, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC.medida) },
  { entidade: entidadeFilial, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC.filial) },
  { entidade: entidadeUsuario, escopo: 'usuarios', puxar: puxarDe(TABELAS_SYNC.usuario), liberadoSemFilial: true },
  { entidade: entidadeClienteVisitaResumo, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.cliente_visita_resumo) },
  { entidade: entidadeFotoTipo, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC.foto_tipo) },
  { entidade: entidadeClienteFoto, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.cliente_foto), receber: receberFotosPdv },
  { entidade: entidadeProdutoUnidade, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC.produto_unidade) },
  { entidade: entidadeClienteEndereco, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.cliente_endereco) },
  { entidade: entidadeClienteContato, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.cliente_contato) },
  { entidade: entidadeClienteFinanceiro, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.cliente_financeiro) },
  { entidade: entidadeTitulo, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.titulo) },
  { entidade: entidadeHistoricoCompra, escopo: 'carteira', puxar: puxarDe(TABELAS_SYNC.historico_compra) },
  { entidade: entidadeMotivo, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC.motivo) },
  { entidade: entidadeParametro, escopo: 'tenant', puxar: puxarDe(TABELAS_SYNC.parametro) },
  { entidade: entidadeRota, escopo: 'usuarios', puxar: puxarDe(TABELAS_SYNC.rota) },
  { entidade: entidadeRotaParada, escopo: 'usuarios', puxar: puxarDe(TABELAS_SYNC.rota_parada) },
  { entidade: entidadeMeta, escopo: 'usuarios', puxar: puxarDe(TABELAS_SYNC.meta) },
  { entidade: entidadeIndicadorDiario, escopo: 'usuarios', puxar: puxarDe(TABELAS_SYNC.indicador_diario) },
  { entidade: entidadeVisita, escopo: 'usuarios', puxar: puxarDe(TABELAS_SYNC.visita), receber: receberCheckins },
  { entidade: entidadeVisitaCheckout, receber: receberCheckouts },
];
