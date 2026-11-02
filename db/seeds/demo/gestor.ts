/**
 * Base de DEMONSTRAÇÃO do Gestor (dono: banco-dados; T-0055, migração 0014). Complementa a base de demo (demo.ts) sem
 * editá-la: roda DENTRO da transação de `carregarDemo`, com as linhas que ela acabou de gravar.
 *
 * Ligação (uma linha em demo.ts, dentro de carregarDemo, logo antes do `await admin.query('commit')`):
 *     await carregarDemoGestor(admin, dados);
 * com `import { carregarDemoGestor } from './gestor';` no topo.
 *
 * O que grava (só no tenant demo, idempotente — rodar 2× não duplica):
 *  1. Licença do Gestor: plataforma.tenant_modulo `gestor` ativo e plataforma.perfil_modulo `gestor` para supervisor
 *     (Renata), gerente (Marcelo), analista (Paulo) e admin (Sérgio) — RN-CORE-01 (efetivos = tenant ∩ perfil). Vendedor
 *     (Lucas, Camila) e promotor (Joana) não ganham o Gestor.
 *  2. Projeção do Gestor (gestor.projecao_fato + gestor.evento_aplicado) montada pelo PRÓPRIO domain do Gestor
 *     (`aplicarEventos`) a partir dos eventos que os módulos teriam publicado para os dados da demo: carteira dos 30
 *     clientes de Manaus, visitas (check-in/checkout), rotas de hoje, metas de venda do mês, pedidos com a linha do tempo
 *     e as aprovações pendentes. Assim o painel, o ranking, a fila de aprovação e os alertas da Renata e do Marcelo
 *     batem com o que o app Campo e o BKO mostram. Evento que o domain recusar = ERRO no seed (nunca projeção errada).
 *  Alertas e ajustes de regra NÃO são semeados: a API reconcilia os alertas na leitura (RN-GES, `reconciliarParaViewer`)
 *  e regra sem ajuste = padrão do domain.
 *
 * Upsert pelas chaves naturais (tenant, evento_id) e (tenant, tabela, chave): se a API já projetou um fato no ensaio, o
 * seed o devolve ao estado da demo (como demo.ts faz com os pedidos). Só roda contra o Postgres local (carregarDemo já
 * exige; aqui de novo para quem chamar direto).
 */
import type { ClientBase } from 'pg';
import { achatarEstado } from '../../../modules/gestor/db/projecao';
import { aplicarEventos, estadoInicial, type EventoRecebido } from '../../../modules/gestor/domain/projecao';
import { statusDoContrato } from '../../../modules/vendedor/domain/aprovacao';
import type { OrderStatus } from '../../../modules/vendedor/domain/order';
import { exigirBancoLocal, hostDoCliente } from '../../src/config';
import { idDeterministico } from '../../src/ids';
import { gravarLinhas, type Linha } from '../../src/gravar';
// só TIPO de demo.ts: demo.ts importa este arquivo (import de valor aqui seria circular)
import type { DadosDemo } from './demo';

/** Tenant demo (= TENANT_DEMO de demo.ts; conferido contra os dados em dadosGestorDemo e em db/testes/gestor.test.ts). */
export const TENANT_DEMO_GESTOR = 'dd000000-0000-4000-8000-000000000001';
const T = TENANT_DEMO_GESTOR;
/** Mesmo esquema de id da demo.ts (`demo:<chave>`): tenant_modulo/perfil_modulo do Gestor ficam com o id que a demo.ts daria. */
const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

export const MODULO_GESTOR = 'gestor';
/** Perfis com o Gestor na demo (app Macuxi Gestão: supervisor e gerente; BKO em leitura/regras: analista e admin). */
export const PERFIS_GESTOR_DEMO = ['supervisor', 'gerente', 'analista', 'admin'] as const;

/** Frequência de visita por segmento (RN-GES-01): supermercado e atacarejo semanal, o resto quinzenal. */
const frequenciaDoSegmento = (segmento: unknown) => (segmento === 'Supermercado' || segmento === 'Atacarejo' ? 'semanal' : 'quinzenal');

const MS_DIA = 86_400_000;
const menosDias = (iso: string, dias: number) => new Date(Date.parse(iso) - dias * MS_DIA).toISOString();
const iso = (x: unknown) => new Date(String(x)).toISOString();

export interface DadosGestorDemo {
  'plataforma.tenant_modulo': Linha[];
  'plataforma.perfil_modulo': Linha[];
  eventos: EventoRecebido[];
}

/**
 * Monta a licença e os eventos da demo a partir das linhas da base (função pura). Os eventos seguem os contratos que o
 * Gestor consome (modules/gestor/contracts/eventos-consumidos.ts), com ids determinísticos (`demo:gestor:evento:<chave>`).
 */
export function dadosGestorDemo(dados: DadosDemo): DadosGestorDemo {
  if (dados['plataforma.tenant'][0]?.id !== T) throw new Error('[db] seed demo gestor: dados de outro tenant (esperado o tenant demo)');
  const eventos: EventoRecebido[] = [];
  const evento = (chave: string, nome: string, ocorrido_em: string, payload: unknown) =>
    eventos.push({ evento_id: id(`gestor:evento:${chave}`), nome, ocorrido_em, payload });

  // "agora" da base = início da rota de hoje (o mais antigo instante de referência é o primeiro pedido)
  const instantes = dados['vendedor.pedido'].map((p) => iso(p.created_at)).sort();
  const inicioDaBase = menosDias(instantes[0] ?? new Date(0).toISOString(), 60);

  // 1. carteira (core.cliente.atualizado@1, com os campos de carteira que o Gestor lê)
  const vendedorDoCliente = new Map(dados['core.carteira'].filter((c) => c.papel === 'vendedor').map((c) => [String(c.cliente_id), String(c.usuario_id)]));
  for (const c of dados['core.cliente']) {
    const cliente_id = String(c.id);
    evento(`cliente:${cliente_id}`, 'core.cliente.atualizado@1', inicioDaBase, {
      cliente_id, campos: ['vendedor_id', 'ativo', 'nome'], origem: 'erp', vendedor_id: vendedorDoCliente.get(cliente_id) ?? null, ativo: true,
      nome: String(c.nome_fantasia), frequencia_visita: frequenciaDoSegmento(c.segmento), na_carteira_desde: inicioDaBase,
    });
  }

  // 2. visitas (check-in e checkout do usuário)
  for (const v of dados['core.visita']) {
    const base = { visita_id: String(v.id), usuario_id: String(v.usuario_id), cliente_id: String(v.cliente_id), checkin_em: iso(v.checkin_em) };
    evento(`checkin:${base.visita_id}`, 'core.visita.checkin@1', base.checkin_em, base);
    if (!v.checkout_em) continue;
    const checkout_em = iso(v.checkout_em);
    evento(`checkout:${base.visita_id}`, 'core.visita.checkout@1', checkout_em, {
      ...base, checkout_em, data_local: String(v.data_local), resultado: String(v.resultado), motivo_codigo: null, pedido_id: v.pedido_id ? String(v.pedido_id) : null,
      fechada_por: 'usuario', permanencia_s: Math.max(0, Math.round((Date.parse(checkout_em) - Date.parse(base.checkin_em)) / 1000)),
    });
  }

  // 3. rotas de hoje (core.rota.dia_planejado@1): clientes na ordem das paradas
  for (const r of dados['core.rota']) {
    const paradas = dados['core.rota_parada'].filter((p) => p.rota_id === r.id).sort((x, y) => Number(x.sequencia) - Number(y.sequencia));
    evento(`rota:${String(r.id)}`, 'core.rota.dia_planejado@1', inicioDaBase, { usuario_id: String(r.usuario_id), data: String(r.data), cliente_ids: paradas.map((p) => String(p.cliente_id)) });
  }

  // 4. metas de venda do mês (core.meta.definida@1 no formato lido pelo Gestor)
  for (const m of dados['core.meta'].filter((x) => x.indicador === 'venda_cents')) {
    evento(`meta:${String(m.id)}`, 'core.meta.definida@1', inicioDaBase, { usuario_id: String(m.usuario_id), mes: String(m.periodo), meta_cents: Number(m.valor) });
  }

  // 5. pedidos: criado, linha do tempo (status_alterado) e aprovação solicitada (com o crédito do cliente)
  const financeiro = new Map(dados['core.cliente_financeiro'].map((f) => [String(f.cliente_id), f]));
  for (const p of dados['vendedor.pedido']) {
    const pedido_id = String(p.id);
    const criado_em = iso(p.created_at);
    const itens = dados['vendedor.pedido_item'].filter((i) => i.pedido_id === p.id).sort((x, y) => Number(x.sequencia) - Number(y.sequencia));
    evento(`pedido:${pedido_id}`, 'vendedor.pedido.criado@1', criado_em, {
      pedido_id, vendedor_id: String(p.vendedor_id), autor_id: String(p.autor_id), cliente_id: String(p.cliente_id), visita_id: p.visita_id ? String(p.visita_id) : null,
      tipo: 'pedido', total_cents: Number(p.total_cents), total_tabela_cents: Number(p.total_tabela_cents), criado_em,
      itens: itens.map((i) => ({ produto_id: String(i.produto_id), quantidade: Number(i.quantidade), total_cents: Number(i.total_cents) })),
    });
    for (const e of dados['vendedor.pedido_evento'].filter((x) => x.pedido_id === p.id)) {
      const alterado_em = iso(e.ocorrido_em);
      evento(`status:${String(e.id)}`, 'vendedor.pedido.status_alterado@1', alterado_em, {
        pedido_id, vendedor_id: String(p.vendedor_id), de: e.de ? statusDoContrato(e.de as OrderStatus) : null, para: statusDoContrato(e.para as OrderStatus),
        alterado_em, autor_id: e.autor_id ? String(e.autor_id) : null, motivo: e.motivo ? String(e.motivo) : null,
      });
    }
    if (p.nivel_aprovacao) {
      const f = financeiro.get(String(p.cliente_id));
      const limite = Number(f?.limite_cents ?? 0);
      const saldo = Number(f?.saldo_aberto_cents ?? 0);
      const tabela = Number(p.total_tabela_cents);
      const desconto = tabela > 0 ? Math.round(((tabela - Number(p.total_cents)) / tabela) * 10_000) / 100 : 0;
      evento(`aprovacao:${pedido_id}`, 'vendedor.pedido.aprovacao_solicitada@1', criado_em, {
        pedido_id, vendedor_id: String(p.vendedor_id), cliente_id: String(p.cliente_id), solicitada_em: criado_em, nivel: String(p.nivel_aprovacao),
        motivos: ['desconto'], desconto_efetivo_pct: Math.max(0, desconto), total_cents: Number(p.total_cents),
        credito: f ? { limite_cents: limite, saldo_aberto_cents: saldo, disponivel_cents: limite - saldo } : null, historico: null,
      });
    }
  }

  return {
    'plataforma.tenant_modulo': [{ id: id(`tenant_modulo:${MODULO_GESTOR}`), tenant_id: T, modulo: MODULO_GESTOR, ativo: true, plano: 'demonstracao', licencas: null, desativado_em: null, ...comuns }],
    'plataforma.perfil_modulo': PERFIS_GESTOR_DEMO.map((perfil) => ({ id: id(`perfil_modulo:${perfil}:${MODULO_GESTOR}`), tenant_id: T, perfil, modulo: MODULO_GESTOR, ...comuns })),
    eventos,
  };
}

/** Projeta os eventos com o domain do Gestor; qualquer evento não aplicado é erro do seed. */
export function projecaoDemo(eventos: readonly EventoRecebido[]) {
  const r = aplicarEventos(estadoInicial(), eventos);
  const naoAplicados = eventos.length - r.contagem.aplicado;
  if (naoAplicados > 0) {
    throw new Error(`[db] seed demo gestor: ${naoAplicados} evento(s) recusado(s) pelo domain do Gestor (${JSON.stringify(r.contagem)}); confira os contratos em modules/gestor/contracts.`);
  }
  return { estado: r.estado, fatos: achatarEstado(r.estado) };
}

export interface ResultadoDemoGestor {
  eventos: number;
  fatos: number;
  perfis: readonly string[];
}

/**
 * Grava a licença e a projeção do Gestor no tenant demo, na transação ABERTA de quem chama (carregarDemo). Exige as
 * migrações até a 0014 (schema gestor).
 */
export async function carregarDemoGestor(admin: ClientBase, dados: DadosDemo): Promise<ResultadoDemoGestor> {
  exigirBancoLocal(hostDoCliente(admin), 'Seed da base de demonstração do Gestor');
  const falta = await admin.query<{ ok: boolean }>("select to_regclass('gestor.projecao_fato') is not null as ok");
  if (!falta.rows[0]?.ok) throw new Error('[db] base de demo do Gestor precisa da migração 0014_gestor: rode "banco migrar up" antes.');
  const g = dadosGestorDemo(dados);
  const { fatos } = projecaoDemo(g.eventos);
  for (const l of [...g['plataforma.tenant_modulo'], ...g['plataforma.perfil_modulo']]) if (l.tenant_id !== T) throw new Error('[db] seed demo gestor: linha fora do tenant demo');

  await gravarLinhas(admin, 'plataforma.tenant_modulo', g['plataforma.tenant_modulo']);
  await gravarLinhas(admin, 'plataforma.perfil_modulo', g['plataforma.perfil_modulo']);
  for (const e of g.eventos) {
    await admin.query(
      `insert into gestor.evento_aplicado (id, tenant_id, evento_id, nome, ocorrido_em) values ($1, $2, $3, $4, $5)
       on conflict (tenant_id, evento_id) do update set nome = excluded.nome, ocorrido_em = excluded.ocorrido_em, deleted_at = null`,
      [id(`gestor:evento_aplicado:${e.evento_id}`), T, e.evento_id, e.nome, e.ocorrido_em],
    );
  }
  for (const f of fatos) {
    await admin.query(
      `insert into gestor.projecao_fato (id, tenant_id, tabela, chave, carimbo, dados, ocorrido_em, usuario_id) values ($1, $2, $3, $4, $5, $6::jsonb, $7, $8)
       on conflict (tenant_id, tabela, chave) do update
         set carimbo = excluded.carimbo, dados = excluded.dados, ocorrido_em = excluded.ocorrido_em, usuario_id = excluded.usuario_id, deleted_at = null`,
      [id(`gestor:projecao_fato:${f.tabela}:${f.chave}`), T, f.tabela, f.chave, f.carimbo, JSON.stringify(f.dados), f.ocorrido_em, f.usuario_id],
    );
  }
  return { eventos: g.eventos.length, fatos: fatos.length, perfis: PERFIS_GESTOR_DEMO };
}
