/**
 * Base de DEMONSTRAÇÃO — dados da T-0170 (migrações 0064 a 0066). Dono: banco-dados.
 * Arquivo próprio: o demo.ts chama `gravarDemoTarefasProdutividade(admin, ...)` na MESMA transação do carregarDemo, depois
 * do laço (core.usuario, core.equipe, core.cliente e core.notificacao já gravados) e da Pesquisa (questionário da tarefa).
 *
 * - core.tarefa / core.tarefa_destinatario (0064): 4 tarefas da supervisora Renata (uma de foto, uma de PESQUISA com o
 *   questionário "Exposição do café no PDV" para a Equipe Manaus, uma simples já concluída pelo Lucas e uma vencida para
 *   todos), com o aviso de cada destinatário em core.notificacao (subtipo 'tarefa', texto de avisoDaTarefa, RN-CORE-TAR-07).
 *   O prazo anda com o "hoje" do seed.
 * - core.frase_dia (0065): NÃO semeia — as 30 frases padrão nascem com o tenant (gatilho tenant_semear_frase_dia da 0065,
 *   que também as semeou nos tenants que já existiam, inclusive no --recriar).
 * - core.meta_produtividade (0066): metas de produtividade da Equipe Manaus, do Lucas e da Camila (as demais ficam no
 *   padrão FDV, META_PRODUTIVIDADE_PADRAO), vigentes desde o mês do PRIMEIRO seed (vigencia_inicio preservado).
 * - core.meta 'itens_por_pedido' (CHECK da 0066; centésimos: 3,50 = 350): Lucas e Camila, mês corrente e anterior, mesmo
 *   id determinístico do demo.ts (`demo:meta:<quem>:<mês>:<indicador>`). Fica fora de METAS do demo.ts para a carga
 *   continuar valendo num banco anterior à 0066.
 * - core.deslocamento_dia (0066): km rodados por Lucas e Camila nos 5 dias antes do "hoje" (origem 'rastreamento').
 *
 * Idempotente (upsert por id determinístico). Respeita o ensaio: cancelamento/exclusão da tarefa, conclusão e leitura do
 * aviso ficam (coalesce); meta viva gravada pelo BKO com outro id na mesma chave única faz o seed pular a dele.
 * Banco sem a 0066 = nada a fazer. Só tenant demo; só Postgres local ou servidor da demo (exigirBancoDemo).
 */
import type { ClientBase } from 'pg';
import { avisoDaTarefa } from '../../../modules/core/domain/tarefas/aviso';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { anoMes, instante, somarDias } from '../../src/datas';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico } from '../../src/ids';
import { PESQUISA_DEMO } from './pesquisa';

const id = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;

/** E-mails dos logins do demo.ts (USUARIOS_DEMO); o id do usuário é `demo:usuario:<email>`. */
const EMAIL = {
  vendedor: 'vendedor@exemplo.com.br',
  vendedor2: 'vendedor2@exemplo.com.br',
  promotor: 'promotor@exemplo.com.br',
  supervisor: 'supervisor@exemplo.com.br',
  analista: 'analista@exemplo.com.br',
} as const;
type Quem = keyof typeof EMAIL;
const usuario = (k: Quem) => id(`usuario:${EMAIL[k]}`);
/** Mesmo id de idClienteDemo(n) do demo.ts (0 = Supermercado Bom Preço, também do promotor; 1 = Mercadinho São Jorge). */
const cliente = (n: number) => id(`cliente:${n}`);
const EQUIPE_MANAUS = id('equipe:Equipe Manaus');

/** Ids estáveis para a API, o app e os testes. */
export const TAREFAS_DEMO = {
  foto: id('tarefa:foto-gondola'),
  pesquisa: id('tarefa:pesquisa-exposicao'),
  concluida: id('tarefa:titulos-sao-jorge'),
  vencida: id('tarefa:catalogo-novo'),
} as const;

interface TarefaDemo {
  id: string;
  titulo: string;
  descricao: string | null;
  /** dias a partir do "hoje" do seed (negativo = vencida) */
  prazoEmDias: number;
  tipo: 'simples' | 'foto' | 'pesquisa';
  cliente: number | null;
  questionarioId: string | null;
  alvo: 'usuarios' | 'equipe' | 'todos';
  equipeId: string | null;
  destinatarios: Quem[];
  /** destinatário que já concluiu (ontem, 15h de Manaus) */
  concluidaPor?: Quem;
}

export const DEFINICAO_TAREFAS_DEMO: readonly TarefaDemo[] = [
  {
    id: TAREFAS_DEMO.foto, titulo: 'Fotografar a gôndola de café', descricao: 'Foto de frente, com as etiquetas de preço visíveis.',
    prazoEmDias: 2, tipo: 'foto', cliente: 0, questionarioId: null, alvo: 'usuarios', equipeId: null, destinatarios: ['vendedor', 'promotor'],
  },
  {
    id: TAREFAS_DEMO.pesquisa, titulo: 'Responder a pesquisa de exposição do café', descricao: null,
    prazoEmDias: 5, tipo: 'pesquisa', cliente: null, questionarioId: PESQUISA_DEMO.questionarios.exposicao, alvo: 'equipe', equipeId: EQUIPE_MANAUS,
    destinatarios: ['vendedor', 'vendedor2', 'promotor'],
  },
  {
    id: TAREFAS_DEMO.concluida, titulo: 'Combinar o pagamento dos títulos vencidos', descricao: 'Mercadinho São Jorge: confirmar a data do pagamento.',
    prazoEmDias: 1, tipo: 'simples', cliente: 1, questionarioId: null, alvo: 'usuarios', equipeId: null, destinatarios: ['vendedor'], concluidaPor: 'vendedor',
  },
  {
    id: TAREFAS_DEMO.vencida, titulo: 'Apresentar o catálogo novo aos clientes da rota', descricao: null,
    prazoEmDias: -1, tipo: 'simples', cliente: null, questionarioId: null, alvo: 'todos', equipeId: null, destinatarios: ['vendedor', 'vendedor2', 'promotor'],
  },
];

/** Metas de produtividade (unidades de UNIDADES_PRODUTIVIDADE do contrato performance; dentro de FAIXA_META_PRODUTIVIDADE). */
export const METAS_PRODUTIVIDADE_DEMO: ReadonlyArray<readonly ['equipe' | Quem, string, number]> = [
  ['equipe', 'visitas_dia', 120], // 12,0 visitas por dia
  ['equipe', 'tma', 25], // 25 min por visita
  ['vendedor', 'primeiro_checkin', 450], // 07:30
  ['vendedor', 'km_dia', 100_000], // 100 km
  ['vendedor2', 'visitas_dia', 100], // 10,0 visitas por dia
  ['vendedor2', 'jornada_liquida', 450], // 7h30
];

/** Metas 'itens_por_pedido' em centésimos: [quem, mês (0 = corrente, -1 = anterior), valor]. */
export const METAS_ITENS_POR_PEDIDO_DEMO: ReadonlyArray<readonly [Quem, 0 | -1, number]> = [
  ['vendedor', 0, 350], ['vendedor', -1, 320],
  ['vendedor2', 0, 300], ['vendedor2', -1, 280],
];

/** Função pura: as linhas da T-0170 para o "hoje" (AAAA-MM-DD) do seed. */
export function dadosDemoTarefasProdutividade(p: { tenantId: string; hoje: string }) {
  const T = p.tenantId;
  const tarefas: Linha[] = [];
  const destinatarios: Linha[] = [];
  const avisos: Linha[] = [];
  const ontem = somarDias(p.hoje, -1);
  for (const t of DEFINICAO_TAREFAS_DEMO) {
    const prazo = somarDias(p.hoje, t.prazoEmDias);
    tarefas.push({
      id: t.id, tenant_id: T, autor_id: usuario('supervisor'), titulo: t.titulo, descricao: t.descricao, prazo,
      cliente_id: t.cliente === null ? null : cliente(t.cliente), tipo: t.tipo, questionario_id: t.questionarioId, alvo: t.alvo, equipe_id: t.equipeId,
      cancelada_em: null, cancelada_por: null, motivo_cancelamento: null, ...comuns,
    });
    const aviso = avisoDaTarefa({ id: t.id, titulo: t.titulo, prazo });
    for (const quem of t.destinatarios) {
      const concluiu = t.concluidaPor === quem;
      destinatarios.push({
        id: id(`tarefa_destinatario:${t.id}:${quem}`), tenant_id: T, tarefa_id: t.id, usuario_id: usuario(quem),
        // 19:00 UTC = 15:00 em Manaus; recebida pelo servidor 5 min depois
        concluida_em: concluiu ? instante(ontem, '19:00') : null, recebida_em: concluiu ? instante(ontem, '19:05') : null,
        conclusao_id: concluiu ? id(`tarefa_conclusao:${t.id}:${quem}`) : null, observacao: concluiu ? 'Pagamento combinado para sexta.' : null,
        resposta_id: null, suspeita: false, ...comuns,
      });
      avisos.push({
        id: id(`notificacao:tarefa:${t.id}:${quem}`), tenant_id: T, usuario_id: usuario(quem), tipo: aviso.tipo, subtipo: aviso.subtipo, tarefa_id: t.id,
        titulo: aviso.titulo, corpo: aviso.corpo, link: null, origem_modulo: 'core', autor_id: usuario('supervisor'), prioridade: aviso.prioridade,
        lida_em: concluiu ? instante(ontem, '18:50') : null, ...comuns,
      });
    }
  }
  const vigencia = anoMes(p.hoje);
  const metasProdutividade: Linha[] = METAS_PRODUTIVIDADE_DEMO.map(([alvo, indicador, valor]) => ({
    id: id(`meta_produtividade:${alvo}:${indicador}`), tenant_id: T, escopo: alvo === 'equipe' ? 'equipe' : 'usuario',
    equipe_id: alvo === 'equipe' ? EQUIPE_MANAUS : null, usuario_id: alvo === 'equipe' ? null : usuario(alvo),
    indicador, valor, vigencia_inicio: vigencia, atualizado_por: usuario('analista'), ...comuns,
  }));
  const metasItens: Linha[] = METAS_ITENS_POR_PEDIDO_DEMO.map(([quem, n, valor]) => {
    const periodo = anoMes(p.hoje, n);
    return { id: id(`meta:${quem}:${periodo}:itens_por_pedido`), tenant_id: T, usuario_id: usuario(quem), periodo, indicador: 'itens_por_pedido', valor, tipo: 'pedido', ...comuns };
  });
  // km dos 5 dias antes do "hoje": primeiro ponto 07:40 e último 17:50 de Manaus (UTC-4)
  const deslocamentos: Linha[] = (['vendedor', 'vendedor2'] as const).flatMap((quem, q) =>
    [1, 2, 3, 4, 5].map((d) => {
      const data = somarDias(p.hoje, -d);
      return {
        id: id(`deslocamento_dia:${quem}:${d}`), tenant_id: T, usuario_id: usuario(quem), data, metros: 82_000 + 9_500 * ((d + q * 2) % 5),
        pontos: 380 + 20 * d, primeiro_ponto_em: instante(data, '11:40'), ultimo_ponto_em: instante(data, '21:50'), origem: 'rastreamento', ...comuns,
      };
    }),
  );
  return { tarefas, destinatarios, avisos, metasProdutividade, metasItens, deslocamentos };
}

export interface ResultadoDemoTarefasProdutividade {
  tarefas: number;
  destinatarios: number;
  avisos: number;
  metasProdutividade: number;
  metasItens: number;
  deslocamentos: number;
}

/** Grava os dados da T-0170 (dentro da transação do carregarDemo). Banco sem a 0066 = tudo 0. */
export async function gravarDemoTarefasProdutividade(admin: ClientBase, p: { tenantId: string; hoje: string }): Promise<ResultadoDemoTarefasProdutividade> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed das tarefas e metas de produtividade da demo');
  const zero = { tarefas: 0, destinatarios: 0, avisos: 0, metasProdutividade: 0, metasItens: 0, deslocamentos: 0 };
  const existe = await admin.query<{ ok: boolean }>(
    "select to_regclass('core.tarefa') is not null and to_regclass('core.meta_produtividade') is not null and to_regclass('core.deslocamento_dia') is not null as ok",
  );
  if (!existe.rows[0]?.ok) return zero;
  const d = dadosDemoTarefasProdutividade(p);
  const T = p.tenantId;
  const ids = (l: Linha[]) => l.map((x) => x.id);

  // o que o ensaio fez com as tarefas do seed fica: cancelamento, exclusão, conclusão e leitura do aviso
  const tarefas = await gravarLinhas(admin, 'core.tarefa', d.tarefas, { preservar: ['cancelada_em', 'cancelada_por', 'motivo_cancelamento', 'deleted_at'] });
  const destinatarios = await gravarLinhas(admin, 'core.tarefa_destinatario', d.destinatarios, {
    preservar: ['concluida_em', 'recebida_em', 'conclusao_id', 'observacao', 'resposta_id', 'deleted_at'],
  });
  const avisos = await gravarLinhas(admin, 'core.notificacao', d.avisos, { preservar: ['lida_em', 'deleted_at'] });

  // metas de produtividade: viva do BKO com outro id na mesma chave (meta_produtividade_vigencia_uk) = fica a do ensaio
  const outrasProd = await admin.query<{ chave: string }>(
    `select escopo || '|' || coalesce(equipe_id, usuario_id)::text || '|' || indicador as chave from core.meta_produtividade
      where tenant_id = $1 and deleted_at is null and id <> all($2::uuid[])`,
    [T, ids(d.metasProdutividade)],
  );
  const doEnsaioProd = new Set(outrasProd.rows.map((x) => x.chave));
  const prod = d.metasProdutividade.filter((l) => !doEnsaioProd.has(`${String(l.escopo)}|${String(l.equipe_id ?? l.usuario_id)}|${String(l.indicador)}`));
  const metasProdutividade = await gravarLinhas(admin, 'core.meta_produtividade', prod, { preservar: ['vigencia_inicio', 'deleted_at'] });

  // itens por pedido: mesma regra das metas do demo.ts (meta viva do ensaio na mesma chave = o seed pula a dele)
  const outrasMetas = await admin.query<{ chave: string }>(
    `select usuario_id || '|' || periodo || '|' || indicador as chave from core.meta
      where tenant_id = $1 and deleted_at is null and indicador = 'itens_por_pedido' and id <> all($2::uuid[])`,
    [T, ids(d.metasItens)],
  );
  const doEnsaio = new Set(outrasMetas.rows.map((x) => x.chave));
  const itens = d.metasItens.filter((l) => !doEnsaio.has(`${String(l.usuario_id)}|${String(l.periodo)}|${String(l.indicador)}`));
  const metasItens = await gravarLinhas(admin, 'core.meta', itens);

  // deslocamento: as datas andam com o "hoje" e o único (usuario_id, data) não é adiável — apaga as do seed e regrava,
  // sem tocar no dia que o rastreamento do ensaio já gravou
  await admin.query('delete from core.deslocamento_dia where tenant_id = $1 and id = any($2::uuid[])', [T, ids(d.deslocamentos)]);
  const ocupados = await admin.query<{ chave: string }>(
    "select usuario_id || '|' || to_char(data, 'YYYY-MM-DD') as chave from core.deslocamento_dia where tenant_id = $1 and deleted_at is null",
    [T],
  );
  const diasDoEnsaio = new Set(ocupados.rows.map((x) => x.chave));
  const desl = d.deslocamentos.filter((l) => !diasDoEnsaio.has(`${String(l.usuario_id)}|${String(l.data)}`));
  const deslocamentos = await gravarLinhas(admin, 'core.deslocamento_dia', desl);

  return { tarefas, destinatarios, avisos, metasProdutividade, metasItens, deslocamentos };
}
