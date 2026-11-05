/**
 * Farol de clientes (RN-CORE-28; T-0081; desenho docs/desenho/T-0081.md): `GET /v1/core/farol` (ação `farol.ver`) e
 * `GET|PUT /v1/core/parametros/farol` (ação `parametro.farol`, analista e admin; auditoria RN-AUD-01). Sem migração: lê
 * `core.carteira`, `core.cliente`, `core.historico_compra`, as listas de `core.indicador_diario` (RN-CORE-20) ou `core.nota_erp`
 * (RN-CORE-27, nunca somadas) e guarda os parâmetros em `plataforma.parametro` (linha ausente = padrão do domain).
 * Escopo: `usuariosVisiveis()` (vendedores) e `carteira()` (clientes), RN-CORE-04. Equipe ou vendedor fora do escopo = lista vazia.
 */
import { ErroRegraNegocio, type ClienteBanco, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import {
  FarolQuerySchema,
  FarolSchema,
  FAROL_LIMITE_PADRAO,
  PARAMETRO_FAROL_AMARELO_DIAS,
  PARAMETRO_FAROL_POSITIVACAO_AMARELO,
  PARAMETRO_FAROL_POSITIVACAO_VERDE,
  PARAMETRO_FAROL_VERDE_DIAS,
  ParametrosFarolPutSchema,
  ParametrosFarolSchema,
  type Farol,
  type FarolCliente,
  type FarolQuery,
  type ParametrosFarol,
  type ParametrosFarolPut,
} from '../contracts';
import { corDoCliente, dataLocal, diasSemCompraDoFarol, mascararDocumentoDoFarol, ordenarClientesDoFarol, parametrosFarolDasLinhas, resumirFarol, validarParametrosFarol, type LinhaFarol } from '../domain';
import { auditar } from './auditoria';

const CHAVES = [PARAMETRO_FAROL_VERDE_DIAS, PARAMETRO_FAROL_AMARELO_DIAS, PARAMETRO_FAROL_POSITIVACAO_VERDE, PARAMETRO_FAROL_POSITIVACAO_AMARELO] as const;
/** Teto de vínculos por consulta, como o `GET carteira`. Acima disso o recorte precisa de filtro. */
export const FAROL_TETO_VINCULOS = 5000;

/** Valor efetivo do tenant da transação (RLS). Sem cache. */
export async function lerParametrosFarol(db: ClienteBanco): Promise<ParametrosFarol> {
  const r = await db.query<{ modulo: string; chave: string; valor: unknown }>(
    "select modulo, chave, valor from plataforma.parametro where tenant_id = plataforma.tenant_atual() and modulo = 'core' and chave = any($1::text[]) and deleted_at is null",
    [[...CHAVES]],
  );
  return parametrosFarolDasLinhas(r.rows);
}

interface LinhaVinculo {
  cliente_id: string;
  usuario_id: string;
  razao_social: string;
  nome_fantasia: string | null;
  documento: string | null;
}

export interface EntradaFarol {
  /** `'tenant'` = sem recorte de vendedores. */
  usuariosVisiveis: ReadonlySet<string> | 'tenant';
  clientesVisiveis: ReadonlySet<string> | 'tenant';
  agora: Date;
  fuso: string;
  integracaoNoTenant: boolean;
  /** Licença do tenant (RN-CORE-27): com o Vendedor ativo a fonte é o pedido, para qualquer perfil que consulta. */
  vendedorNoTenant?: boolean;
  query: FarolQuery;
}

const vazio = (periodo: string, hoje: string, parametros: ParametrosFarol): Farol =>
  FarolSchema.parse({ periodo, hoje, fonte_positivacao: null, parametros, resumo: resumirFarol([], parametros).resumo, vendedores: [], clientes: [], proximo_cursor: null });

/** Cálculo do farol (sobre o banco da transação; exportado para teste). */
export async function calcularFarol(db: ClienteBanco, tx: Partial<Pick<TransacaoTenant, 'consultar'>>, e: EntradaFarol): Promise<Farol> {
  const q = e.query;
  const hoje = dataLocal(e.agora, e.fuso);
  const periodo = q.periodo ?? hoje.slice(0, 7);
  const parametros = await lerParametrosFarol(db);

  // Vendedores do recorte: escopo (RN-CORE-04) x equipe x vendedor. Fora do escopo = vazio (nunca 403: não revela que existe).
  const usuarios = (
    await db.query<{ id: string; nome: string; equipe_id: string | null }>(
      `select id, nome, equipe_id from core.usuario
        where deleted_at is null and ($1::uuid[] is null or id = any($1::uuid[])) and ($2::uuid is null or equipe_id = $2) and ($3::uuid is null or id = $3)
        order by nome, id`,
      [e.usuariosVisiveis === 'tenant' ? null : [...e.usuariosVisiveis], q.equipe_id ?? null, q.usuario_id ?? null],
    )
  ).rows;
  if (usuarios.length === 0) return vazio(periodo, hoje, parametros);
  const idsUsuarios = usuarios.map((u) => u.id);

  const vinculos = (
    await db.query<LinhaVinculo>(
      `select k.cliente_id, k.usuario_id, c.razao_social, c.nome_fantasia, c.documento
         from core.carteira k join core.cliente c on c.id = k.cliente_id and c.deleted_at is null and c.ativo
        where k.deleted_at is null and k.papel = 'vendedor' and k.usuario_id = any($1::uuid[])
          and (k.inicio is null or k.inicio <= $2::date) and (k.fim is null or k.fim >= $2::date)
          and ($3::uuid[] is null or k.cliente_id = any($3::uuid[]))
        order by k.cliente_id, k.usuario_id
        limit ${FAROL_TETO_VINCULOS + 1}`,
      [idsUsuarios, hoje, e.clientesVisiveis === 'tenant' ? null : [...e.clientesVisiveis]],
    )
  ).rows;
  if (vinculos.length > FAROL_TETO_VINCULOS) throw new ErroRegraNegocio('RN-CORE-28', `A carteira deste recorte passa de ${FAROL_TETO_VINCULOS} clientes. Escolha uma equipe ou um vendedor para ver o farol.`);
  if (vinculos.length === 0) return vazio(periodo, hoje, parametros);

  const idsClientes = [...new Set(vinculos.map((v) => v.cliente_id))];
  const historico = (
    await db.query<{ cliente_id: string; ano_mes: string; valor_cents: number; pedidos: number; ultima_compra_em: string | null }>(
      "select cliente_id, ano_mes, valor_cents::float8 as valor_cents, pedidos, to_char(ultima_compra_em, 'YYYY-MM-DD') as ultima_compra_em from core.historico_compra where deleted_at is null and cliente_id = any($1::uuid[])",
      [idsClientes],
    )
  ).rows;
  const historicoDe = new Map<string, typeof historico>();
  for (const h of historico) historicoDe.set(h.cliente_id, [...(historicoDe.get(h.cliente_id) ?? []), h]);

  // Positivação do mês pela fonte do tenant, nunca somadas (RN-CORE-20 x RN-CORE-27; mesma decisão do Início).
  // A fonte é decidida pela LICENÇA DO TENANT (RN-CORE-27: devolução não tira), nunca pelos módulos de quem consulta.
  const usaNotas = !(e.vendedorNoTenant ?? false) && e.integracaoNoTenant && (await db.query('select 1 from core.nota_erp where deleted_at is null and usuario_id is not null limit 1')).rows.length > 0;
  const positivados = new Set<string>(); // "usuario|cliente"
  let fonte: Farol['fonte_positivacao'] = null;
  if (usaNotas) {
    fonte = 'nota_erp';
    const r = await db.query<{ usuario_id: string; cliente_id: string }>(
      "select distinct usuario_id, cliente_id from core.nota_erp where deleted_at is null and usuario_id = any($1::uuid[]) and ano_mes = $2 and tipo = 'faturamento' and not cancelada",
      [idsUsuarios, periodo],
    );
    for (const n of r.rows) positivados.add(`${n.usuario_id}|${n.cliente_id}`);
  } else {
    const r = await db.query<{ usuario_id: string; ids: string[] | null }>(
      "select usuario_id, clientes_positivados_ids as ids from core.indicador_diario where deleted_at is null and usuario_id = any($1::uuid[]) and to_char(data, 'YYYY-MM') = $2",
      [idsUsuarios, periodo],
    );
    if (r.rows.length > 0) fonte = 'pedido';
    for (const d of r.rows) for (const id of d.ids ?? []) positivados.add(`${d.usuario_id}|${id}`);
  }

  const itens = vinculos.map((v) => {
    const compra = diasSemCompraDoFarol(historicoDe.get(v.cliente_id) ?? [], hoje);
    return { v, ...compra, positivado_mes: positivados.has(`${v.usuario_id}|${v.cliente_id}`) };
  });
  const linhas: LinhaFarol[] = itens.map((i) => ({ cliente_id: i.v.cliente_id, usuario_id: i.v.usuario_id, dias_sem_compra: i.dias_sem_compra, positivado_mes: i.positivado_mes }));
  const resumido = resumirFarol(linhas, parametros);
  const infoUsuario = new Map(usuarios.map((u) => [u.id, u]));
  const ordemNome = new Map(usuarios.map((u, i) => [u.id, i]));
  const vendedores = resumido.vendedores
    .map((s) => ({ ...s, nome: infoUsuario.get(s.usuario_id)?.nome ?? '', equipe_id: infoUsuario.get(s.usuario_id)?.equipe_id ?? null }))
    .sort((a, b) => (ordemNome.get(a.usuario_id) ?? 0) - (ordemNome.get(b.usuario_id) ?? 0));

  // Lista: cor e busca só afetam a lista; resumo e vendedores são do recorte inteiro.
  const busca = q.busca?.trim().toLowerCase();
  const buscaDigitos = (q.busca ?? '').replace(/\D/g, '');
  const lista: FarolCliente[] = itens
    .map((i) => ({
      cliente_id: i.v.cliente_id,
      nome: i.v.nome_fantasia?.trim() || i.v.razao_social,
      documento_mascarado: mascararDocumentoDoFarol(i.v.documento),
      usuario_id: i.v.usuario_id,
      ultima_compra_em: i.ultima_compra_em,
      dias_sem_compra: i.dias_sem_compra,
      positivado_mes: i.positivado_mes,
      cor: corDoCliente(i, parametros),
      _bruto: `${i.v.razao_social} ${i.v.nome_fantasia ?? ''}`.toLowerCase(),
      _doc: (i.v.documento ?? '').replace(/\D/g, ''),
    }))
    .filter((c) => (!q.cor || c.cor === q.cor) && (!busca || c._bruto.includes(busca) || (buscaDigitos.length >= 3 && c._doc.includes(buscaDigitos))))
    .map(({ _bruto: _b, _doc: _d, ...c }) => c);
  const ordenada = ordenarClientesDoFarol(lista);
  const limite = q.limite ?? FAROL_LIMITE_PADRAO;
  const deslocamento = Math.max(0, Number.parseInt(q.cursor ?? '0', 10) || 0);
  const pagina = ordenada.slice(deslocamento, deslocamento + limite);

  return FarolSchema.parse({
    periodo,
    hoje,
    fonte_positivacao: fonte,
    parametros,
    resumo: resumido.resumo,
    vendedores,
    clientes: pagina,
    proximo_cursor: deslocamento + limite < ordenada.length ? String(deslocamento + limite) : null,
  });
}

export const rotasDeFarol: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'farol',
    acao: 'farol.ver',
    carteira: 'filtrar_no_dominio',
    query: FarolQuerySchema,
    executar: async (ctx): Promise<Farol> => {
      const usuariosVisiveis = await ctx.usuariosVisiveis();
      const clientesVisiveis = await ctx.carteira();
      return ctx.comTenant(async (db, tx) => {
        // Licença do tenant (RN-CORE-03/27), como o Início: Integração ativa liga a fonte das notas do ERP
        const lic = await db.query<{ modulo: string }>("select modulo from plataforma.tenant_modulo where modulo in ('integracao', 'vendedor') and ativo and deleted_at is null");
        const licenciado = (m: string) => lic.rows.some((r) => r.modulo === m);
        return calcularFarol(db, tx, { usuariosVisiveis, clientesVisiveis, agora: ctx.agora(), fuso: ctx.fuso(), integracaoNoTenant: licenciado('integracao'), vendedorNoTenant: licenciado('vendedor'), query: ctx.query as FarolQuery });
      });
    },
  },
  {
    metodo: 'GET',
    caminho: 'parametros/farol',
    acao: 'parametro.farol',
    carteira: 'nao_se_aplica',
    executar: (ctx) => ctx.comTenant(async (db): Promise<ParametrosFarol> => ParametrosFarolSchema.parse(await lerParametrosFarol(db))),
  },
  {
    metodo: 'PUT',
    caminho: 'parametros/farol',
    acao: 'parametro.farol',
    carteira: 'nao_se_aplica',
    corpo: ParametrosFarolPutSchema,
    executar: async (ctx) => {
      const v = validarParametrosFarol(ctx.corpo as ParametrosFarolPut);
      if (!v.ok) throw new ErroRegraNegocio('RN-CORE-28', v.erros.map((e) => e.mensagem).join(' '), { erros: v.erros });
      const novo = v.valores;
      return ctx.comTenant(async (db): Promise<ParametrosFarol> => {
        const antes = await lerParametrosFarol(db);
        const valores: Record<(typeof CHAVES)[number], number> = {
          [PARAMETRO_FAROL_VERDE_DIAS]: novo.verde_ate_dias,
          [PARAMETRO_FAROL_AMARELO_DIAS]: novo.amarelo_ate_dias,
          [PARAMETRO_FAROL_POSITIVACAO_VERDE]: novo.positivacao_verde_pct,
          [PARAMETRO_FAROL_POSITIVACAO_AMARELO]: novo.positivacao_amarelo_pct,
        };
        for (const chave of CHAVES) {
          await db.query(
            `insert into plataforma.parametro (tenant_id, modulo, chave, valor) values (plataforma.tenant_atual(), 'core', $1, $2::jsonb)
             on conflict (tenant_id, modulo, chave) where deleted_at is null do update set valor = excluded.valor
               where plataforma.parametro.valor is distinct from excluded.valor`,
            [chave, JSON.stringify(valores[chave])],
          );
        }
        if (JSON.stringify(antes) !== JSON.stringify(novo)) {
          await auditar(db, ctx, { acao: 'parametro.farol', entidade: 'parametro', entidadeId: null, antes, depois: novo });
        }
        return novo;
      });
    },
  },
];
