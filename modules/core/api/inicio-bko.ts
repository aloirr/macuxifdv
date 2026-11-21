/**
 * `GET /v1/core/inicio-bko` (`core.inicio_bko@1`; RN-CORE-64/65/66; T-0189): a parte do Início do BKO que é do Core. Ação `inicio_bko.ver`
 * (supervisor, gerente, analista, assistente, admin); a licença é a dos módulos EFETIVOS do usuário (`ctx.usuario.modulos`).
 * Escopo: `usuariosVisiveis()` e `carteira()` (RN-CORE-04). Nada de outro schema: as vendas e os pedidos do dia vêm da consulta
 * `vendedor.pedidos_da_meta@1` (via `calcularInicio`/`fontePorConsulta`); mensagens paradas, lotes e última carga (Integração), aprovações e
 * alertas (Gestor) a tela busca nos endpoints desses módulos, que já checam perfil, escopo e licença.
 */
import { pode, type ClienteBanco, type RotaModulo, type TransacaoTenant } from '@macuxi/platform-sdk';
import { InicioBkoSchema, PARAMETRO_CAMPOS_OBRIGATORIOS, PARAMETRO_HORARIO_CARGA, type InicioBko } from '../contracts';
import {
  cadastroIncompletoDoEscopo,
  calendarioDoTenant,
  camposExigidos,
  dataLocal,
  dataPorExtenso,
  ehDiaUtil,
  horarioCargaDasLinhas,
  percentualDaMeta,
  saudacaoDoBko,
  type DadosCadastro,
} from '../domain';
import { calcularInicio } from './inicio';
import { fontePorConsulta } from './metas';
import { lerParametrosCore } from './parametro-tenant';
import { licencaDoTenant } from './licenca-tenant';

const CHAVES = ['metas.dias_uteis_semana', PARAMETRO_HORARIO_CARGA, PARAMETRO_CAMPOS_OBRIGATORIOS] as const;

type Escopo = ReadonlySet<string> | 'tenant';
const lista = (e: Escopo): string[] | null => (e === 'tenant' ? null : [...e]);

interface EntradaInicioBko {
  usuarioId: string;
  nome: string;
  perfil: string;
  podeVerUsuarios: boolean;
  modulos: readonly string[];
  usuariosVisiveis: Escopo;
  clientesVisiveis: Escopo;
  agora: Date;
  fuso: string;
}

/** Cálculo do Início do BKO (exportado para teste). */
export async function calcularInicioBko(db: ClienteBanco, tx: Partial<Pick<TransacaoTenant, 'consultar'>>, e: EntradaInicioBko): Promise<InicioBko> {
  const dia = dataLocal(e.agora, e.fuso);
  const periodo = dia.slice(0, 7);
  const linhas = await lerParametrosCore(db, CHAVES);
  const comIntegracao = e.modulos.includes('integracao');
  const comVendedor = e.modulos.includes('vendedor');

  // RN-CORE-66: clientes ativos do escopo, pela lista efetiva da RN-CORE-16 (o complemento mora no endereço, não em core.cliente: não entra na conta)
  const clientes = (
    await db.query<DadosCadastro>(
      `select razao_social, nome_fantasia, documento, inscricao_estadual, telefone, email, logradouro, numero, bairro, cidade, uf, cep, latitude::float8 as latitude, longitude::float8 as longitude
         from core.cliente where deleted_at is null and ativo and ($1::uuid[] is null or id = any($1::uuid[]))`,
      [lista(e.clientesVisiveis)],
    )
  ).rows;
  const cadastro_incompleto = cadastroIncompletoDoEscopo(clientes, camposExigidos(linhas.find((l) => l.chave === PARAMETRO_CAMPOS_OBRIGATORIOS)?.valor).filter((c) => c !== 'complemento'));

  // senha temporária vencida: usuários do escopo, só para quem pode ver usuários
  let usuarios_senha_vencida: number | null = null;
  if (e.podeVerUsuarios) {
    usuarios_senha_vencida = (
      await db.query<{ n: number }>(
        'select count(*)::int as n from core.usuario where deleted_at is null and ativo and trocar_senha and senha_expira_em is not null and senha_expira_em < $2 and ($1::uuid[] is null or id = any($1::uuid[]))',
        [lista(e.usuariosVisiveis), e.agora.toISOString()],
      )
    ).rows[0]?.n ?? 0;
  }

  const calendario = calendarioDoTenant(linhas.map((l) => ({ modulo: l.modulo, chave: l.chave, valor: l.valor })));
  const carga = comIntegracao ? { dia_util: ehDiaUtil(dia, calendario), horario: horarioCargaDasLinhas(linhas) } : null;

  // visitas do dia: paradas planejadas × visitas feitas, no escopo
  const idsUsuarios = lista(e.usuariosVisiveis);
  const [paradas, visitas] = await Promise.all([
    db.query<{ planejadas: number; na_rota: number }>(
      `select count(*)::int as planejadas,
              count(*) filter (where not exists (select 1 from core.visita v where v.deleted_at is null and v.usuario_id = p.usuario_id and v.cliente_id = p.cliente_id and v.data_local = p.data))::int as na_rota
         from core.rota_parada p where p.deleted_at is null and p.data = $2::date and ($1::uuid[] is null or p.usuario_id = any($1::uuid[]))`,
      [idsUsuarios, dia],
    ),
    db.query<{ n: number }>('select count(*)::int as n from core.visita where deleted_at is null and data_local = $2::date and ($1::uuid[] is null or usuario_id = any($1::uuid[]))', [idsUsuarios, dia]),
  ]);
  const visitasHoje = { feitas: visitas.rows[0]?.n ?? 0, planejadas: paradas.rows[0]?.planejadas ?? 0, na_rota: paradas.rows[0]?.na_rota ?? 0 };

  let vendas: InicioBko['hoje']['vendas'] = null;
  let pedidos: number | null = null;
  let positivacao: InicioBko['hoje']['positivacao'] = null;
  if (comVendedor) {
    // a mesma conta do Início do app, no escopo de equipe (analista, assistente e admin = tenant)
    const lic = await licencaDoTenant(db);
    const inicio = await calcularInicio(db, tx, { usuarioId: e.usuarioId, ...lic, perfil: e.perfil === 'supervisor' ? 'supervisor' : 'gerente', visiveis: e.usuariosVisiveis, agora: e.agora, fuso: e.fuso });
    const com = inicio.usuarios.filter((u) => u.venda_cents);
    if (com.length > 0) {
      const cents = com.reduce((s, u) => s + (u.venda_cents?.hoje ?? 0), 0);
      const meta = inicio.metas_do_dia.find((m) => m.indicador === 'venda_cents');
      vendas = { cents, meta_dia_cents: meta?.meta_dia ?? null, pct: percentualDaMeta(cents, meta?.meta_dia) };
    }
    const pos = inicio.usuarios.filter((u) => u.positivacao);
    if (pos.length > 0 && clientes.length > 0) {
      const positivados = pos.reduce((s, u) => s + (u.positivacao ? u.positivacao.ate_ontem + u.positivacao.hoje : 0), 0);
      const meta = inicio.metas_do_dia.find((m) => m.indicador === 'positivacao');
      positivacao = { pct: Math.round((positivados / clientes.length) * 100), meta_pct: meta ? Math.round((meta.meta_mes / clientes.length) * 100) : null };
    }
    const ids = inicio.usuarios.map((u) => u.usuario_id).slice(0, 500);
    if (ids.length > 0) {
      const f = await fontePorConsulta(tx)({ usuario_ids: ids, periodo });
      if (f) pedidos = f.pedidos.filter((p) => dataLocal(p.emitido_em, e.fuso) === dia).length;
    }
  }

  return InicioBkoSchema.parse({
    agora: e.agora.toISOString(),
    fuso: e.fuso,
    dia,
    saudacao: saudacaoDoBko(e.agora, e.fuso, e.nome),
    data_extenso: dataPorExtenso(e.agora, e.fuso),
    usuarios_senha_vencida,
    cadastro_incompleto,
    carga,
    hoje: { vendas, pedidos, positivacao, visitas: visitasHoje },
  });
}

export const rotasDeInicioBko: RotaModulo[] = [
  {
    metodo: 'GET',
    caminho: 'inicio-bko',
    superficie: 'bko',
    acao: 'inicio_bko.ver',
    carteira: 'filtrar_no_dominio',
    executar: async (ctx): Promise<InicioBko> => {
      const [usuariosVisiveis, clientesVisiveis] = await Promise.all([ctx.usuariosVisiveis(), ctx.carteira()]);
      return ctx.comTenant(async (db, tx) => {
        const nome = (await db.query<{ nome: string }>('select nome from core.usuario where id = $1', [ctx.usuario.id])).rows[0]?.nome ?? '';
        return calcularInicioBko(db, tx, {
          usuarioId: ctx.usuario.id,
          nome,
          perfil: ctx.usuario.perfil,
          podeVerUsuarios: pode(ctx.usuario.perfis, 'usuario.ver'),
          modulos: ctx.usuario.modulos,
          usuariosVisiveis,
          clientesVisiveis,
          agora: ctx.agora(),
          fuso: ctx.fuso(),
        });
      });
    },
  },
];
