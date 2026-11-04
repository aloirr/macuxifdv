/**
 * Base de DEMONSTRAÇÃO — parte do Promotor (trade marketing; schema `promotor`, migração 0015, T-0056). Dono: banco-dados.
 * Arquivo próprio: o demo.ts chama `gravarDemoPromotor(admin, { hoje })` DENTRO da transação do `carregarDemo`.
 *
 * - Licença: módulo `promotor` ativo no tenant demo e para promotor, supervisor, gerente, analista e admin (upsert com os
 *   MESMOS ids do demo.ts: `demo:tenant_modulo:promotor` e `demo:perfil_modulo:<perfil>:promotor`). O promotor nunca
 *   ganha o Vendedor (RN-PRO-01) — aqui nada fala de pedido.
 * - Cadastros de trade (BKO, RF-PRO-11), vigentes desde o 1º dia do mês anterior: 3 categorias de gôndola (Mercearia,
 *   Bebidas e Limpeza, categorias de produto do demo), mix obrigatório de 5 produtos do demo, metas de share (gerais por
 *   categoria + Mercearia específica do Supermercado Bom Preço, loja 0), 1 checklist vigente com 5 etapas (2 obrigatórias,
 *   RN-PRO-06), 2 concorrentes fictícios com 4 produtos comparados (um por categoria, T-0070: o BKO de trade da T-0069 mostra
 *   as 3 categorias), 1 tarefa de campanha e 1 ponto extra negociado na loja 0.
 * - Histórico da Joana (promotor): as visitas de loja das visitas do Core `v-pr1` (loja 0, 2 dias úteis atrás) e `v-pr2`
 *   (loja 4, 1 dia útil atrás) do demo.ts — mesmo check-in/checkout/coordenada (lidos de `dadosDemo`, função pura) — com
 *   fotos, gôndola (antes/depois), share das 3 categorias calculado pelo domain (calcularShare/atingimentoShare, meta
 *   vigente guardada, RN-PRO-03/10), ruptura do mix (1 item na v-pr1, 2 na v-pr2, RN-PRO-05), preços nosso × concorrente
 *   com índice (RN-PRO-04), respostas do checklist, validade, ponto extra, ação da concorrência e a tarefa executada.
 *   Todo payload = contrato de modules/promotor/contracts/coletas.ts (conferido em db/testes/seed-demo-promotor.test.ts).
 *
 * Idempotente (upsert por id determinístico `demo:promotor:<chave>`); em outro dia as datas andam junto com as visitas do
 * Core (mesmos ids). Só tenant demo; só Postgres local ou servidor da demo (exigirBancoDemo). Exige a 0015 (`to_regclass`).
 * CICLO DE IMPORT: o demo.ts importa este arquivo e este importa o demo.ts. Nada do './demo' é lido no topo do módulo
 * (só dentro das funções), senão dá TDZ quando o demo.ts é o ponto de entrada.
 */
import type { ClientBase } from 'pg';
import { indicePreco, precoEfetivoCents } from '../../../modules/promotor/domain/preco';
import { atingimentoShare, calcularShare } from '../../../modules/promotor/domain/share';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { anoMes, hojeNoFuso, somarDias } from '../../src/datas';
import { gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico } from '../../src/ids';
import { ORDEM_PROMOTOR } from '../fixtures/promotor';
import { dadosDemo, FUSO_DEMO, idClienteDemo, idUsuarioDemo, TENANT_DEMO } from './demo';

/** Tabelas gravadas por este seed, na ordem das FKs (licença primeiro; depois o schema promotor). */
export const ORDEM_DEMO_PROMOTOR = ['plataforma.tenant_modulo', 'plataforma.perfil_modulo', ...ORDEM_PROMOTOR] as const;
export type TabelaDemoPromotor = (typeof ORDEM_DEMO_PROMOTOR)[number];
export type DadosDemoPromotor = Record<TabelaDemoPromotor, Linha[]>;

/** Perfis com o módulo Promotor na demo (doc 03 §2: só o promotor coleta; os demais leem). Nunca o Vendedor para o promotor. */
export const PERFIS_PROMOTOR_DEMO = ['promotor', 'supervisor', 'gerente', 'analista', 'admin'] as const;
/** Carteira de promotor da Joana no demo.ts (clientes com a flag de promotor) e a rota de hoje dela. */
export const CARTEIRA_PROMOTOR_DEMO = [0, 4, 9, 10, 14, 19, 22] as const;
export const ROTA_HOJE_PROMOTOR_DEMO = [0, 4, 9, 22] as const;
/** Visitas do Core da Joana no demo.ts (VISITAS_SEM_PEDIDO) que ganham a visita de loja: [chave, loja]. */
export const VISITAS_LOJA_DEMO = [
  ['v-pr1', 0],
  ['v-pr2', 4],
] as const;

type Categoria = 'mercearia' | 'bebidas' | 'limpeza';
/** Categorias de gôndola = categorias de produto do demo. */
export const CATEGORIAS_DEMO: Record<Categoria, { nome: string; ordem: number }> = {
  mercearia: { nome: 'Mercearia', ordem: 1 },
  bebidas: { nome: 'Bebidas', ordem: 2 },
  limpeza: { nome: 'Limpeza', ordem: 3 },
};
/** Mix obrigatório: [sku do demo, categoria]. */
export const MIX_DEMO: ReadonlyArray<readonly [string, Categoria]> = [
  ['CAF-500', 'mercearia'],
  ['ARR-5K', 'mercearia'],
  ['OLE-900', 'mercearia'],
  ['REF-2L', 'bebidas'],
  ['SAB-1K', 'limpeza'],
];
/** Metas de share (%): gerais por categoria e a específica da loja 0 (Supermercado Bom Preço) em Mercearia. */
export const METAS_SHARE_DEMO = { geral: { mercearia: 35, bebidas: 30, limpeza: 25 } as Record<Categoria, number>, loja0Mercearia: 40 };

/** Frentes medidas por visita e categoria: [nossas, total]. */
const FRENTES: Record<string, Record<Categoria, [number, number]>> = {
  'v-pr1': { mercearia: [12, 30], bebidas: [6, 24], limpeza: [5, 20] },
  'v-pr2': { mercearia: [9, 30], bebidas: [8, 20], limpeza: [3, 15] },
};
/** Ruptura do mix por visita (os demais itens do mix ficam presentes): [sku, status, quantidade reposta]. */
const RUPTURAS: Record<string, Array<[string, 'ruptura_gondola' | 'ruptura_total', number]>> = {
  'v-pr1': [['OLE-900', 'ruptura_gondola', 12]],
  'v-pr2': [['SAB-1K', 'ruptura_total', 0], ['CAF-500', 'ruptura_gondola', 6]],
};

const T = () => TENANT_DEMO;
const id = (chave: string) => idDeterministico(`demo:promotor:${chave}`);
/** Mesmo id dos produtos/visitas do demo.ts (`demo:<chave>`). */
const idDemo = (chave: string) => idDeterministico(`demo:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;
const mais = (iso: string, minutos: number) => new Date(Date.parse(iso) + minutos * 60_000).toISOString().replace('.000Z', 'Z');

export interface OpcoesDemoPromotor {
  /** "Hoje" (AAAA-MM-DD) da demonstração; padrão: hoje em America/Manaus. Use o mesmo do carregarDemo. */
  hoje?: string;
}

/** Monta as linhas do Promotor na base de demo (função pura). */
export function dadosDemoPromotor(opcoes: OpcoesDemoPromotor = {}): DadosDemoPromotor {
  const t = T();
  const hoje = opcoes.hoje ?? hojeNoFuso(FUSO_DEMO);
  const vigencia = `${anoMes(hoje, -1)}-01`;
  const c = idClienteDemo;
  const joana = idUsuarioDemo('promotor');
  const cat = (k: Categoria) => id(`categoria_gondola:${k}`);
  const produto = (sku: string) => idDemo(`produto:${sku}`);
  const alvo = (cliente_id: string | null = null) => ({ cliente_id, segmento: null, vigencia_inicio: vigencia, vigencia_fim: null });
  // visitas do Core da Joana (mesma linha do tempo do demo.ts; dadosDemo é puro e o hash da senha não importa aqui)
  const visitasCore = new Map(dadosDemo('', { hoje })['core.visita'].map((v) => [v.id as string, v]));

  const etapas = [
    { chave: 'fachada', rotulo: 'Foto da fachada e da entrada da loja', tipo: 'foto', obrigatoria: false, categoria: null },
    { chave: 'gondola', rotulo: 'Arrumar a gôndola de Mercearia (fotos antes e depois)', tipo: 'gondola', obrigatoria: true, categoria: 'mercearia' },
    { chave: 'share', rotulo: 'Medir o share de Bebidas', tipo: 'share', obrigatoria: true, categoria: 'bebidas' },
    { chave: 'ruptura', rotulo: 'Conferir a ruptura do mix obrigatório', tipo: 'ruptura', obrigatoria: false, categoria: null },
    { chave: 'preco', rotulo: 'Coletar os preços do concorrente', tipo: 'preco', obrigatoria: false, categoria: null },
  ] as const;
  const checklistId = id('checklist_loja:padrao');
  const concorrentes = { saborReal: id('concorrente:sabor-real'), limpaMais: id('concorrente:limpa-mais') };
  const produtosConcorrentes = [
    { chave: 'cafe', concorrente: concorrentes.saborReal, nome: 'Café Sabor Real 500 g', sku: 'CAF-500', categoria: 'mercearia' as Categoria },
    { chave: 'oleo', concorrente: concorrentes.saborReal, nome: 'Óleo de soja Sabor Real 900 ml', sku: 'OLE-900', categoria: 'mercearia' as Categoria },
    { chave: 'sabao', concorrente: concorrentes.limpaMais, nome: 'Sabão em pó Limpa Mais 1 kg', sku: 'SAB-1K', categoria: 'limpeza' as Categoria },
    // T-0070: Bebidas também com produto comparado (cadastro; sem coleta de preço nas visitas antigas)
    { chave: 'guarana', concorrente: concorrentes.saborReal, nome: 'Guaraná Sabor Real 2 L', sku: 'REF-2L', categoria: 'bebidas' as Categoria },
  ];
  const tarefaId = id('tarefa_trade:campanha-guarana');
  const pontoNegociadoId = id('ponto_extra_negociado:loja0');
  const metaId = (k: Categoria, loja: number | null) => id(`meta_share:${k}:${loja ?? 'geral'}`);
  /** Meta vigente da loja/categoria (RN-PRO-10): a específica da loja vence a geral. */
  const metaVigente = (k: Categoria, loja: number) =>
    loja === 0 && k === 'mercearia' ? { meta_share_id: metaId(k, 0), meta_pct: METAS_SHARE_DEMO.loja0Mercearia } : { meta_share_id: metaId(k, null), meta_pct: METAS_SHARE_DEMO.geral[k] };

  const linhas: DadosDemoPromotor = {
    'plataforma.tenant_modulo': [
      { id: idDemo('tenant_modulo:promotor'), tenant_id: t, modulo: 'promotor', ativo: true, plano: 'demonstracao', licencas: null, desativado_em: null, ...comuns },
    ],
    'plataforma.perfil_modulo': PERFIS_PROMOTOR_DEMO.map((perfil) => ({ id: idDemo(`perfil_modulo:${perfil}:promotor`), tenant_id: t, perfil, modulo: 'promotor', ...comuns })),
    'promotor.categoria_gondola': (Object.keys(CATEGORIAS_DEMO) as Categoria[]).map((k) => ({
      id: cat(k), tenant_id: t, nome: CATEGORIAS_DEMO[k].nome, ordem: CATEGORIAS_DEMO[k].ordem, ativo: true, ...comuns,
    })),
    'promotor.checklist_loja': [
      {
        id: checklistId, tenant_id: t, ...alvo(), nome: 'Visita padrão de loja',
        itens: etapas.map((e, i) => ({
          id: id(`checklist_item:${e.chave}`), rotulo: e.rotulo, tipo: e.tipo, obrigatoria: e.obrigatoria, ordem: i + 1, categoria_gondola_id: e.categoria ? cat(e.categoria) : null,
        })),
        ...comuns,
      },
    ],
    'promotor.mix_obrigatorio': MIX_DEMO.map(([sku, k]) => ({ id: id(`mix_obrigatorio:${sku}`), tenant_id: t, ...alvo(), produto_id: produto(sku), categoria_gondola_id: cat(k), ...comuns })),
    'promotor.meta_share': [
      ...(Object.keys(METAS_SHARE_DEMO.geral) as Categoria[]).map((k) => ({
        id: metaId(k, null), tenant_id: t, ...alvo(), categoria_gondola_id: cat(k), meta_pct: METAS_SHARE_DEMO.geral[k], ...comuns,
      })),
      { id: metaId('mercearia', 0), tenant_id: t, ...alvo(c(0)), categoria_gondola_id: cat('mercearia'), meta_pct: METAS_SHARE_DEMO.loja0Mercearia, ...comuns },
    ],
    'promotor.concorrente': [
      { id: concorrentes.saborReal, tenant_id: t, nome: 'Sabor Real Alimentos', ativo: true, ...comuns },
      { id: concorrentes.limpaMais, tenant_id: t, nome: 'Limpa Mais', ativo: true, ...comuns },
    ],
    'promotor.produto_concorrente': produtosConcorrentes.map((p) => ({
      id: id(`produto_concorrente:${p.chave}`), tenant_id: t, concorrente_id: p.concorrente, nome: p.nome, produto_id: produto(p.sku), categoria_gondola_id: cat(p.categoria), ativo: true, ...comuns,
    })),
    'promotor.foto_referencia': [],
    'promotor.tarefa_trade': [
      {
        id: tarefaId, tenant_id: t, cliente_id: null, segmento: null, vigencia_inicio: somarDias(hoje, -10), vigencia_fim: somarDias(hoje, 20),
        titulo: 'Campanha Guaraná da Floresta: cartaz na entrada', instrucao: 'Fixe o cartaz da campanha na entrada da loja e fotografe com o produto ao lado.',
        prazo: somarDias(hoje, 7), ...comuns,
      },
    ],
    'promotor.ponto_extra_negociado': [
      {
        id: pontoNegociadoId, tenant_id: t, cliente_id: c(0), tipo: 'ponta_gondola', local_combinado: 'Ponta do corredor 2, ao lado das bebidas',
        produto_id: produto('REF-2L'), vigencia_inicio: vigencia, vigencia_fim: null, ...comuns,
      },
    ],
    'promotor.visita_loja': [],
    'promotor.foto_coleta': [],
    'promotor.checklist_resposta': [],
    'promotor.gondola_registro': [],
    'promotor.medicao_share': [],
    'promotor.coleta_preco': [],
    'promotor.ruptura_item': [],
    'promotor.validade_item': [],
    'promotor.ponto_extra': [],
    'promotor.acao_concorrencia': [],
    'promotor.tarefa_execucao': [],
  };

  for (const [chave, loja] of VISITAS_LOJA_DEMO) {
    const core = visitasCore.get(idDemo(`visita:${chave}`));
    if (!core || core.usuario_id !== joana || core.cliente_id !== c(loja)) throw new Error(`[db] seed demo promotor: visita ${chave} da Joana na loja ${loja} não está no demo.ts`);
    const checkin = String(core.checkin_em);
    const checkout = String(core.checkout_em);
    const recebido_em = checkout;
    const vl = id(`visita_loja:${chave}`);
    const em = (min: number) => mais(checkin, min);
    const coleta = (tabela: TabelaDemoPromotor, sufixo: string, payload: Record<string, unknown>) => {
      const cid = id(`${tabela.split('.')[1]}:${chave}:${sufixo}`);
      linhas[tabela].push({ id: cid, tenant_id: t, promotor_id: joana, cliente_id: c(loja), payload: { id: cid, visita_loja_id: vl, ...payload }, recebido_em, ...comuns });
      return cid;
    };
    const foto = (sufixo: string, tipo: string, min: number) =>
      coleta('promotor.foto_coleta', sufixo, {
        tipo, origem: 'camera', tirada_em: em(min), latitude: Number(core.checkin_lat), longitude: Number(core.checkin_lng), sem_gps: false, arquivo_ref: null, enviada_em: null,
      });

    linhas['promotor.visita_loja'].push({
      id: vl, tenant_id: t, promotor_id: joana,
      payload: {
        id: vl, visita_id: core.id, cliente_id: c(loja), checklist_modelo_id: checklistId, checkin_em: checkin, checkout_em: checkout,
        permanencia_min: (Date.parse(checkout) - Date.parse(checkin)) / 60_000, desfecho: 'realizada', foto_fachada_id: null, observacao: null,
      },
      recebido_em, ...comuns,
    });
    const fachada = foto('fachada', 'fachada', 2);
    const antes = foto('gondola-antes', 'gondola_antes', 5);
    const depois = foto('gondola-depois', 'gondola_depois', 18);
    coleta('promotor.gondola_registro', 'mercearia', {
      categoria_gondola_id: cat('mercearia'), foto_antes_id: antes, foto_depois_id: depois, foto_referencia_id: null,
      conformidade: loja === 0 ? 'parcial' : 'conforme', motivo: loja === 0 ? 'Faltou espaço para o óleo na prateleira de baixo.' : null, registrado_em: em(18),
    });
    (Object.keys(CATEGORIAS_DEMO) as Categoria[]).forEach((k, i) => {
      const [nossas, total] = FRENTES[chave]![k];
      const share = calcularShare({ frentes_nossas: nossas, frentes_total: total });
      const meta = metaVigente(k, loja);
      coleta('promotor.medicao_share', k, {
        categoria_gondola_id: cat(k), frentes_nossas: nossas, frentes_total: total, cm_nossos: null, cm_total: null, share_pct: share.share_pct,
        ...meta, atingimento_pct: atingimentoShare(share.share_pct, meta.meta_pct).atingimento_pct, medido_em: em(20 + i),
      });
    });
    for (const [sku] of MIX_DEMO) {
      const r = RUPTURAS[chave]!.find(([s]) => s === sku);
      coleta('promotor.ruptura_item', sku, {
        produto_id: produto(sku), mix_obrigatorio_id: id(`mix_obrigatorio:${sku}`), status: r?.[1] ?? 'presente', quantidade_reposta: r?.[2] ?? 0, foto_id: null, registrado_em: em(25),
      });
    }
    // preços de prateleira: nosso e do concorrente (índice = nosso ÷ concorrente efetivo × 100, RN-PRO-04)
    const precos: Array<{ sku: string; nosso: number; conc: number; promo: number | null; chavePc: string; concorrente: string }> = [
      { sku: 'CAF-500', nosso: loja === 0 ? 2_290 : 2_190, conc: 2_150, promo: null, chavePc: 'cafe', concorrente: concorrentes.saborReal },
      { sku: 'OLE-900', nosso: 899, conc: 849, promo: loja === 0 ? 799 : null, chavePc: 'oleo', concorrente: concorrentes.saborReal },
    ];
    for (const p of precos) {
      const base = { produto_id: produto(p.sku), em_encarte: false, preco_anterior_cents: null, variacao_confirmada: false };
      coleta('promotor.coleta_preco', `${p.sku}:nosso`, {
        ...base, concorrente_id: null, produto_concorrente_id: null, preco_cents: p.nosso, em_promocao: false, preco_promocional_cents: null,
        preco_nosso_ref_cents: null, indice_preco: null, coletado_em: em(28),
      });
      const conc = { preco_cents: p.conc, em_promocao: p.promo !== null, em_encarte: false, preco_promocional_cents: p.promo };
      coleta('promotor.coleta_preco', `${p.sku}:concorrente`, {
        ...base, concorrente_id: p.concorrente, produto_concorrente_id: id(`produto_concorrente:${p.chavePc}`), ...conc,
        preco_nosso_ref_cents: p.nosso, indice_preco: indicePreco(p.nosso, precoEfetivoCents(conc)), coletado_em: em(29),
      });
    }
    etapas.forEach((e, i) => {
      coleta('promotor.checklist_resposta', e.chave, {
        checklist_item_id: id(`checklist_item:${e.chave}`), obrigatoria: e.obrigatoria, concluida: true, respondido_em: em(30 + i),
        valor: null, foto_id: e.chave === 'fachada' ? fachada : e.chave === 'gondola' ? depois : null,
      });
    });
    if (loja === 0) {
      const fotoPonto = foto('ponto-extra', 'ponto_extra', 36);
      coleta('promotor.ponto_extra', 'negociado', {
        ponto_extra_negociado_id: pontoNegociadoId, tipo: 'ponta_gondola', existe: true, no_lugar: true, abastecido: false, foto_id: fotoPonto,
        observacao: 'Ponta montada, mas com metade das frentes vazias.', registrado_em: em(36),
      });
      const fotoTarefa = foto('tarefa', 'tarefa', 40);
      coleta('promotor.tarefa_execucao', 'campanha', {
        tarefa_trade_id: tarefaId, cliente_id: c(loja), foto_ids: [fotoTarefa], observacao: 'Cartaz fixado na entrada.', concluida_em: em(40),
      });
    } else {
      const fotoConc = foto('concorrencia', 'concorrencia', 38);
      coleta('promotor.acao_concorrencia', 'promocao', {
        concorrente_id: concorrentes.saborReal, tipo: 'promocao', descricao: 'Café Sabor Real com 15% de desconto na ponta de gôndola.', foto_id: fotoConc,
        registrado_em: em(38),
      });
      coleta('promotor.validade_item', 'leite', {
        produto_id: produto('LEI-1L'), tipo: 'validade', validade: somarDias(String(core.data_local), 6), lote: 'L-0921', quantidade: 18, motivo_avaria: null,
        foto_id: null, registrado_em: em(42),
      });
    }
  }
  return linhas;
}

/** Trava de isolamento: toda linha é do tenant demo. */
export function conferirSoTenantDemoPromotor(dados: DadosDemoPromotor): void {
  for (const tabela of ORDEM_DEMO_PROMOTOR) {
    for (const l of dados[tabela]) if (l.tenant_id !== T()) throw new Error(`[db] seed demo promotor: linha de ${tabela} fora do tenant demo`);
  }
}

/**
 * Grava o Promotor da base de demo com cliente ADMIN, DENTRO da transação de quem chama (sem begin/commit: o carregarDemo
 * abre e fecha). Exige a 0015 e o tenant demo já gravado. Rodar 2× não duplica (upsert por id).
 */
export async function gravarDemoPromotor(admin: ClientBase, opcoes: OpcoesDemoPromotor = {}): Promise<DadosDemoPromotor> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed do Promotor na base de demonstração');
  const r = await admin.query<{ ok: boolean }>("select to_regclass('promotor.visita_loja') is not null as ok");
  if (!r.rows[0]?.ok) throw new Error('[db] seed demo promotor: falta o schema promotor — rode "banco migrar up" até a 0015_promotor antes.');
  const tenant = await admin.query('select 1 from plataforma.tenant where id = $1', [T()]);
  if (tenant.rowCount === 0) throw new Error('[db] seed demo promotor: o tenant demo não existe — carregue a base demo (carregarDemo) antes.');
  const dados = dadosDemoPromotor(opcoes);
  conferirSoTenantDemoPromotor(dados);
  for (const tabela of ORDEM_DEMO_PROMOTOR) await gravarLinhas(admin, tabela, dados[tabela]);
  return dados;
}
