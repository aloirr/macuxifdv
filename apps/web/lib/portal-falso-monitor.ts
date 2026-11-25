/**
 * Monitor da Integração no modo falso do portal (desenho docs/desenho/empresa-zerar.md §6.4): `GET /integracao/monitor`,
 * `GET /integracao/monitor/detalhes`, `GET /integracao/lotes/:id/erros` e `POST /integracao/lotes/:id/reprocessar`, validados pelos
 * contratos do módulo, para o e2e e os prints da aba Integração. Só o time da Macuxi (o admin do cliente recebe 403). Exemplo: um
 * Conector `erp`; Produtos com um lote que falhou (Reprocessar); Estoque e Títulos com dados no Hub e sem lote (o "Zerar dados" fica
 * na aba Dados). O que o zerar falso (`portal-falso-zerar.ts`) já apagou some daqui: sem lote e sem registro.
 */
import {
  ConectorDetalhe,
  ErrosLoteResposta,
  MonitorDetalhes,
  MonitorResumo,
  ORDEM_CARGA_ENTIDADES,
  ReprocessarLoteResposta,
  type Entidade,
  type EntidadeDetalhe,
  type ErroPorCodigo,
  type LinhaErro,
  type LoteListagemItem,
} from '@macuxi/integracao/contracts';

import { entidadesZeradasFalso, REGISTROS_FALSOS } from './portal-falso-zerar';

/** Rotas do monitor no falso (relativas ao `/v1`). */
export const MONITOR_FALSO_M = /^\/integracao\/(monitor(\/detalhes)?|lotes\/([^/]+)\/(erros|reprocessar))$/;

const MIN = 60_000;
const iso = (ms: number) => new Date(ms).toISOString();
const json = (status: number, corpo: unknown) => new Response(JSON.stringify(corpo), { status, headers: { 'content-type': 'application/json' } });

/** Lote de exemplo: entidade, minutos atrás, estado, recebidas e com erro. O id é fixo para o e2e achar a linha. */
type LoteExemplo = { id: string; entidade: Entidade; ha: number; status: LoteListagemItem['status']; recebidas: number; com_erro: number };
const LOTES: readonly LoteExemplo[] = [
  { id: '0b6f0c3e-0001-4a00-8000-000000000001', entidade: 'produto', ha: 40, status: 'falhou', recebidas: 860, com_erro: 15 },
  { id: '0b6f0c3e-0001-4a00-8000-000000000002', entidade: 'produto', ha: 26 * 60, status: 'concluido', recebidas: 860, com_erro: 0 },
  { id: '0b6f0c3e-0001-4a00-8000-000000000003', entidade: 'cliente', ha: 95, status: 'concluido', recebidas: 1240, com_erro: 0 },
  { id: '0b6f0c3e-0001-4a00-8000-000000000004', entidade: 'cliente_endereco', ha: 94, status: 'concluido', recebidas: 1310, com_erro: 0 },
  { id: '0b6f0c3e-0001-4a00-8000-000000000005', entidade: 'preco', ha: 120, status: 'concluido_com_erros', recebidas: 4120, com_erro: 4 },
  { id: '0b6f0c3e-0001-4a00-8000-000000000006', entidade: 'vendedor', ha: 6 * 60, status: 'concluido', recebidas: 16, com_erro: 0 },
  { id: '0b6f0c3e-0001-4a00-8000-000000000007', entidade: 'forma_pagamento', ha: 8 * 60, status: 'concluido', recebidas: 12, com_erro: 0 },
];
/** Erros por linha de cada lote com erro: código, se basta reprocessar e quantas linhas. */
const ERROS: Readonly<Record<string, readonly { codigo: LinhaErro['codigo']; reprocessavel: boolean; linhas: number; mensagem: string; campo: string | null }[]>> = {
  '0b6f0c3e-0001-4a00-8000-000000000001': [
    { codigo: 'referencia_ausente', reprocessavel: true, linhas: 12, mensagem: 'Nó do catálogo ainda não chegou.', campo: 'catalogo_no' },
    { codigo: 'campo_obrigatorio', reprocessavel: false, linhas: 3, mensagem: 'Descrição em branco.', campo: 'descricao' },
  ],
  '0b6f0c3e-0001-4a00-8000-000000000005': [{ codigo: 'valor_fora_da_faixa', reprocessavel: false, linhas: 4, mensagem: 'Preço negativo.', campo: 'preco' }],
};
const ENTIDADES_DO_ERP: readonly Entidade[] = ['filial', 'vendedor', 'produto', 'preco', 'estoque', 'cliente', 'cliente_endereco', 'titulo'];

/** Lotes reprocessados por empresa: passam a concluídos. */
const reprocessados = new Map<string, Set<string>>();

/** Volta ao começo (testes). */
export function limparMonitorFalso() {
  reprocessados.clear();
}

function lotesDe(tenant: string, agora: number): LoteListagemItem[] {
  const zeradas = entidadesZeradasFalso(tenant, agora);
  const feitos = reprocessados.get(tenant) ?? new Set<string>();
  return LOTES.filter((l) => !zeradas.has(l.entidade)).map((l) => {
    const status = feitos.has(l.id) ? 'concluido' : l.status;
    const comErro = feitos.has(l.id) ? 0 : l.com_erro;
    const recebido = agora - l.ha * MIN;
    return {
      lote_id: l.id,
      conector_id: 'erp',
      entidade: l.entidade,
      modo: 'delta',
      status,
      recebidas: l.recebidas,
      com_erro: comErro,
      novas: status === 'falhou' ? 0 : 8,
      atualizadas: status === 'falhou' ? 0 : l.recebidas - comErro - 8,
      inalteradas: 0,
      obsoletas: 0,
      inativadas: 0,
      recebido_em: iso(recebido),
      concluido_em: iso(recebido + MIN),
    };
  });
}

function monitor(tenant: string, agora: number): MonitorResumo {
  const lotes = lotesDe(tenant, agora);
  const ultimaCarga = ORDEM_CARGA_ENTIDADES.flatMap((e) => {
    const l = lotes.find((x) => x.entidade === e);
    return l ? [{ entidade: e, recebido_em: l.recebido_em }] : [];
  });
  return MonitorResumo.parse({
    gerado_em: iso(agora),
    lotes_recentes: lotes,
    conectores: [{ conector_id: 'erp', versao_conector: '1.4.0' }],
    resumo_pedidos: { na_fila: 0, entregue_ao_conector: 0, rejeitado_pelo_erp: 0, presos_sem_retorno: 0, retidos_sem_mapeamento: 0, parados_desde: null },
    ultima_carga_por_entidade: ultimaCarga,
  });
}

/**
 * Cursor do delta no falso: a última alteração no ERP vem 5 min antes da última carga recebida (nunca depois dela) e o cursor é
 * gravado quando a carga termina; sem lote, uma alteração de 3 dias atrás.
 */
function cursorFalso(ultimo: LoteListagemItem | null, agora: number): EntidadeDetalhe['cursores'][number] {
  if (!ultimo) return { conector_id: 'erp', alterado_em: iso(agora - 3 * 24 * 60 * MIN), external_id: null, atualizado_em: iso(agora - 30 * MIN) };
  return { conector_id: 'erp', alterado_em: iso(Date.parse(ultimo.recebido_em) - 5 * MIN), external_id: null, atualizado_em: ultimo.concluido_em ?? ultimo.recebido_em };
}

/** Como a API: as entidades do Conector e as que têm dado no Hub (lote ou registro), na ordem de carga. */
function detalhes(tenant: string, agora: number): MonitorDetalhes {
  const zeradas = entidadesZeradasFalso(tenant, agora);
  const lotes = lotesDe(tenant, agora);
  const entidades = ORDEM_CARGA_ENTIDADES.filter((e) => ENTIDADES_DO_ERP.includes(e) || lotes.some((l) => l.entidade === e) || (REGISTROS_FALSOS[e] && !zeradas.has(e))).map((e) => {
    const r = zeradas.has(e) ? undefined : REGISTROS_FALSOS[e];
    const daEntidade = lotes.filter((l) => l.entidade === e);
    const ultimo = daEntidade[0] ?? null;
    const comErro = daEntidade.filter((l) => l.com_erro > 0 || l.status === 'falhou');
    const erros: ErroPorCodigo[] = comErro.flatMap((l) => (ERROS[l.lote_id] ?? []).map((x) => ({ codigo: x.codigo, classe: x.reprocessavel ? 'reprocessavel' : 'corrigir_no_erp', linhas: x.linhas })));
    return {
      entidade: e,
      cursores: r ? [cursorFalso(ultimo, agora)] : [],
      registros: { ativos: r?.ativos ?? 0, inativos: r?.inativos ?? 0 },
      ultimo_lote: ultimo && { lote_id: ultimo.lote_id, conector_id: 'erp', modo: ultimo.modo, status: ultimo.status, recebido_em: ultimo.recebido_em, concluido_em: ultimo.concluido_em },
      erros,
      lotes_reprocessaveis: comErro.map((l) => l.lote_id).reverse(),
    };
  });
  const conector = ConectorDetalhe.parse({
    conector_id: 'erp',
    tipo: 'conector',
    ativo: true,
    entidades: ENTIDADES_DO_ERP,
    versao_conector: '1.4.0',
    ultimo_sinal_em: iso(agora - 3 * MIN),
    saude: 'ok',
    sinal: { fila: [{ estado: 'pendente', lotes: 2, linhas: 380, maisAntigo: iso(agora - 5 * MIN) }], entidades: [], atualizacao: null },
  });
  return MonitorDetalhes.parse({ gerado_em: iso(agora), entidades, conectores: [conector] });
}

function erros(loteId: string, caminhoComQuery: string): ErrosLoteResposta {
  const q = new URLSearchParams(caminhoComQuery.split('?')[1] ?? '');
  const codigo = q.get('codigo');
  const itens: LinhaErro[] = (ERROS[loteId] ?? [])
    .filter((x) => !codigo || x.codigo === codigo)
    .flatMap((x) => Array.from({ length: x.linhas }, () => ({ codigo: x.codigo, reprocessavel: x.reprocessavel, mensagem: x.mensagem, campo: x.campo })))
    .map((x, i) => ({ ...x, indice: i, external_id: `P${String(1000 + i)}` }));
  return ErrosLoteResposta.parse({ itens, total: itens.length });
}

/** Responde as rotas do monitor. `superAdmin` = sessão do time da Macuxi; `tenant` já conferido pelo chamador. */
export function responderMonitorFalso(metodo: string, caminhoComQuery: string, tenant: string, superAdmin: boolean): Response {
  if (!superAdmin) return json(403, { codigo: 'PERFIL_SEM_ACESSO', mensagem: 'Só o time da Macuxi vê o monitor pelo portal.' });
  const caminho = caminhoComQuery.split('?')[0] ?? '';
  const m = MONITOR_FALSO_M.exec(caminho);
  const agora = Date.now();
  if (m?.[1] === 'monitor' && metodo === 'GET') return json(200, monitor(tenant, agora));
  if (m?.[1] === 'monitor/detalhes' && metodo === 'GET') return json(200, detalhes(tenant, agora));
  const loteId = decodeURIComponent(m?.[3] ?? '');
  const lote = lotesDe(tenant, agora).find((l) => l.lote_id === loteId);
  if (m?.[4] && !lote) return json(404, { codigo: 'lote_nao_encontrado', mensagem: 'Lote não encontrado.' });
  if (m?.[4] === 'erros' && metodo === 'GET') return json(200, erros(loteId, caminhoComQuery));
  if (m?.[4] === 'reprocessar' && metodo === 'POST' && lote) {
    if (lote.status !== 'falhou' && lote.status !== 'concluido_com_erros') return json(409, { codigo: 'lote_nao_reprocessavel', mensagem: 'Este lote não pode ser reprocessado.' });
    reprocessados.set(tenant, new Set([...(reprocessados.get(tenant) ?? []), loteId]));
    return json(200, ReprocessarLoteResposta.parse({ lote_id: loteId, reenfileiradas: lote.recebidas, status: 'recebido' }));
  }
  return json(404, { codigo: 'NAO_ENCONTRADO', mensagem: 'Rota não encontrada.' });
}
