/**
 * Fixture dois-tenants — parte do schema `promotor` (0015, T-0056). Dono: banco-dados. Separada de dois-tenants.ts para a
 * mudança lá ser mínima (import + tabelas no fim de ORDEM_TABELAS + dados).
 *
 * - Linha de A e de B em TODA tabela do schema (os testes de vazamento exigem), UUIDs `aaaaaaaa-`/`bbbbbbbb-` nos grupos
 *   0x70–0x83 (sem colidir com os de dois-tenants.ts).
 * - A (Manaus): a visita de loja do promotor ligada à visita do Core `promotorC1Hoje` (c1, hoje 15:00Z–15:30Z, sem GPS),
 *   fechada como `realizada`, com uma coleta de cada tipo dentro da janela da visita (RN-PRO-02) e os cadastros de trade
 *   vigentes (categoria Freios/Filtros, checklist com 1 etapa obrigatória, mix, meta de share 40%, concorrente, foto de
 *   referência, tarefa de campanha e ponto extra negociado em c1).
 * - B (São Paulo) NÃO licencia o Promotor: as linhas existem só para o isolamento (RN-CORE-05). A visita de loja de B fica
 *   na visita do Core `c1Hoje` de B (12:00Z–12:30Z) e o promotor_id é o vendedor-B (sem FK: o banco não confere perfil).
 * - Payloads = contratos de modules/promotor/contracts/coletas.ts com todos os defaults explícitos (o teste estático faz
 *   `Contrato.parse(payload)` e compara); instantes ISO "…Z" derivados do "hoje" de cada tenant (mesma linha do tempo
 *   da visita do Core da fixture). Cadastros com as colunas de contracts/cadastros.ts.
 */
import { idFixo } from '../../src/ids';
import { instante, somarDias } from '../../src/datas';
import type { Linha } from '../../src/gravar';

const G = {
  categoria_gondola: 0x70,
  checklist_loja: 0x71,
  mix_obrigatorio: 0x72,
  meta_share: 0x73,
  concorrente: 0x74,
  produto_concorrente: 0x75,
  foto_referencia: 0x76,
  tarefa_trade: 0x77,
  ponto_extra_negociado: 0x78,
  visita_loja: 0x79,
  foto_coleta: 0x7a,
  checklist_resposta: 0x7b,
  gondola_registro: 0x7c,
  medicao_share: 0x7d,
  coleta_preco: 0x7e,
  ruptura_item: 0x7f,
  validade_item: 0x80,
  ponto_extra: 0x81,
  acao_concorrencia: 0x82,
  tarefa_execucao: 0x83,
} as const;

const a = (grupo: keyof typeof G, seq: number) => idFixo('aaaaaaaa', G[grupo], seq);
const b = (grupo: keyof typeof G, seq: number) => idFixo('bbbbbbbb', G[grupo], seq);

/** Tabelas do schema promotor (0015), na ordem das FKs: cadastros (categoria antes de mix/meta/produto/foto), visita e coletas. */
export const ORDEM_PROMOTOR = [
  'promotor.categoria_gondola',
  'promotor.checklist_loja',
  'promotor.mix_obrigatorio',
  'promotor.meta_share',
  'promotor.concorrente',
  'promotor.produto_concorrente',
  'promotor.foto_referencia',
  'promotor.tarefa_trade',
  'promotor.ponto_extra_negociado',
  'promotor.visita_loja',
  'promotor.foto_coleta',
  'promotor.checklist_resposta',
  'promotor.gondola_registro',
  'promotor.medicao_share',
  'promotor.coleta_preco',
  'promotor.ruptura_item',
  'promotor.validade_item',
  'promotor.ponto_extra',
  'promotor.acao_concorrencia',
  'promotor.tarefa_execucao',
] as const;
export type TabelaPromotor = (typeof ORDEM_PROMOTOR)[number];

/** Tabelas de coleta (push): payload jsonb + colunas derivadas pelo gatilho (a fixture grava só as colunas de base). */
export const COLETAS_PROMOTOR = [
  'promotor.visita_loja',
  'promotor.foto_coleta',
  'promotor.checklist_resposta',
  'promotor.gondola_registro',
  'promotor.medicao_share',
  'promotor.coleta_preco',
  'promotor.ruptura_item',
  'promotor.validade_item',
  'promotor.ponto_extra',
  'promotor.acao_concorrencia',
  'promotor.tarefa_execucao',
] as const satisfies readonly TabelaPromotor[];

/** Ids da parte do promotor, para asserts determinísticos. */
export const PROMOTOR_FIXTURE = {
  A: {
    categorias: { freios: a('categoria_gondola', 1), filtros: a('categoria_gondola', 2) },
    checklist: a('checklist_loja', 1),
    /** Etapas do checklist de A: a 1ª é obrigatória (RN-PRO-06). */
    etapas: { gondola: a('checklist_loja', 101), fotoFachada: a('checklist_loja', 102) },
    mix: a('mix_obrigatorio', 1),
    metaShare: a('meta_share', 1),
    concorrente: a('concorrente', 1),
    produtoConcorrente: a('produto_concorrente', 1),
    fotoReferencia: a('foto_referencia', 1),
    tarefa: a('tarefa_trade', 1),
    pontoNegociado: a('ponto_extra_negociado', 1),
    visitaLoja: a('visita_loja', 1),
    fotos: { antes: a('foto_coleta', 1), depois: a('foto_coleta', 2), ponto: a('foto_coleta', 3), tarefa: a('foto_coleta', 4) },
  },
  B: {
    categoria: b('categoria_gondola', 1),
    checklist: b('checklist_loja', 1),
    etapa: b('checklist_loja', 101),
    mix: b('mix_obrigatorio', 1),
    metaShare: b('meta_share', 1),
    concorrente: b('concorrente', 1),
    produtoConcorrente: b('produto_concorrente', 1),
    fotoReferencia: b('foto_referencia', 1),
    tarefa: b('tarefa_trade', 1),
    pontoNegociado: b('ponto_extra_negociado', 1),
    visitaLoja: b('visita_loja', 1),
    fotos: { antes: b('foto_coleta', 1), depois: b('foto_coleta', 2), tarefa: b('foto_coleta', 3) },
  },
} as const;

/** O que a parte do promotor usa de dois-tenants.ts (passado por quem chama: sem import circular). */
export interface BasePromotorFixture {
  A: { tenantId: string; promotor: string; cliente: string; visitaCore: string; produto: string; produto2: string };
  B: { tenantId: string; promotor: string; cliente: string; visitaCore: string; produto: string };
}

const comuns = { deleted_at: null, external_id: null } as const;

/** Linhas do schema promotor dos dois tenants. `hojeA`/`hojeB` = o "hoje" de cada fuso que a fixture já usa. */
export function dadosPromotorFixture(base: BasePromotorFixture, hojeA: string, hojeB: string): Record<TabelaPromotor, Linha[]> {
  const { A, B } = base;
  const PA = PROMOTOR_FIXTURE.A;
  const PB = PROMOTOR_FIXTURE.B;
  const tA = A.tenantId;
  const tB = B.tenantId;
  // A: visita do Core promotorC1Hoje (15:00Z–15:30Z); B: c1Hoje (12:00Z–12:30Z) — coletas dentro da janela (RN-PRO-02)
  const emA = (hhmm: string) => instante(hojeA, hhmm);
  const emB = (hhmm: string) => instante(hojeB, hhmm);
  const vigA = somarDias(hojeA, -30);
  const vigB = somarDias(hojeB, -30);

  /** Linha de coleta: só as colunas de base; as tipadas vêm do gatilho promotor.derivar_<tabela>. */
  const coleta = (id: string, tenant_id: string, promotor_id: string, cliente_id: string, payload: Record<string, unknown>, recebido_em: string): Linha => ({
    id, tenant_id, promotor_id, cliente_id, payload: { id, ...payload }, recebido_em, ...comuns,
  });
  const foto = (id: string, tenant_id: string, promotor_id: string, cliente_id: string, visita_loja_id: string, tipo: string, tirada_em: string, recebido: string): Linha =>
    coleta(id, tenant_id, promotor_id, cliente_id, {
      visita_loja_id, tipo, origem: 'camera', tirada_em, latitude: null, longitude: null, sem_gps: true, arquivo_ref: null, enviada_em: null,
    }, recebido);

  return {
    'promotor.categoria_gondola': [
      { id: PA.categorias.freios, tenant_id: tA, nome: 'Freios', ordem: 1, ativo: true, ...comuns },
      { id: PA.categorias.filtros, tenant_id: tA, nome: 'Filtros', ordem: 2, ativo: true, ...comuns },
      { id: PB.categoria, tenant_id: tB, nome: 'Lubrificantes', ordem: 1, ativo: true, ...comuns },
    ],
    'promotor.checklist_loja': [
      {
        id: PA.checklist, tenant_id: tA, cliente_id: null, segmento: null, vigencia_inicio: vigA, vigencia_fim: null, nome: 'Checklist padrão Alfa',
        itens: [
          { id: PA.etapas.gondola, rotulo: 'Arrumar a gôndola de freios', tipo: 'gondola', obrigatoria: true, ordem: 1, categoria_gondola_id: PA.categorias.freios },
          { id: PA.etapas.fotoFachada, rotulo: 'Foto da fachada', tipo: 'foto', obrigatoria: false, ordem: 2, categoria_gondola_id: null },
        ],
        ...comuns,
      },
      {
        id: PB.checklist, tenant_id: tB, cliente_id: null, segmento: null, vigencia_inicio: vigB, vigencia_fim: null, nome: 'Checklist Beta',
        itens: [{ id: PB.etapa, rotulo: 'Conferir preços', tipo: 'preco', obrigatoria: true, ordem: 1, categoria_gondola_id: null }],
        ...comuns,
      },
    ],
    'promotor.mix_obrigatorio': [
      { id: PA.mix, tenant_id: tA, cliente_id: null, segmento: null, vigencia_inicio: vigA, vigencia_fim: null, produto_id: A.produto, categoria_gondola_id: PA.categorias.freios, ...comuns },
      { id: PB.mix, tenant_id: tB, cliente_id: null, segmento: null, vigencia_inicio: vigB, vigencia_fim: null, produto_id: B.produto, categoria_gondola_id: PB.categoria, ...comuns },
    ],
    'promotor.meta_share': [
      { id: PA.metaShare, tenant_id: tA, cliente_id: null, segmento: null, vigencia_inicio: vigA, vigencia_fim: null, categoria_gondola_id: PA.categorias.freios, meta_pct: 40, ...comuns },
      { id: PB.metaShare, tenant_id: tB, cliente_id: B.cliente, segmento: null, vigencia_inicio: vigB, vigencia_fim: null, categoria_gondola_id: PB.categoria, meta_pct: 30, ...comuns },
    ],
    'promotor.concorrente': [
      { id: PA.concorrente, tenant_id: tA, nome: 'Freios Rivais', ativo: true, ...comuns },
      { id: PB.concorrente, tenant_id: tB, nome: 'Lubri Rival', ativo: true, ...comuns },
    ],
    'promotor.produto_concorrente': [
      { id: PA.produtoConcorrente, tenant_id: tA, concorrente_id: PA.concorrente, nome: 'Pastilha Rival dianteira', produto_id: A.produto, categoria_gondola_id: PA.categorias.freios, ativo: true, ...comuns },
      { id: PB.produtoConcorrente, tenant_id: tB, concorrente_id: PB.concorrente, nome: 'Óleo Rival 5W30 1 L', produto_id: B.produto, categoria_gondola_id: PB.categoria, ativo: true, ...comuns },
    ],
    'promotor.foto_referencia': [
      // arquivo_id sem FK (ADR 0010; fronteira): arquivo de referência fictício, ainda não enviado
      { id: PA.fotoReferencia, tenant_id: tA, cliente_id: null, segmento: null, vigencia_inicio: vigA, vigencia_fim: null, categoria_gondola_id: PA.categorias.freios, arquivo_id: a('foto_referencia', 101), descricao: 'Planograma de freios', ...comuns },
      { id: PB.fotoReferencia, tenant_id: tB, cliente_id: null, segmento: 'Linha leve', vigencia_inicio: vigB, vigencia_fim: null, categoria_gondola_id: PB.categoria, arquivo_id: b('foto_referencia', 101), descricao: null, ...comuns },
    ],
    'promotor.tarefa_trade': [
      { id: PA.tarefa, tenant_id: tA, cliente_id: A.cliente, segmento: null, vigencia_inicio: vigA, vigencia_fim: null, titulo: 'Cartaz da campanha de freios', instrucao: 'Fixar o cartaz na ponta de gôndola e fotografar.', prazo: somarDias(hojeA, 7), ...comuns },
      { id: PB.tarefa, tenant_id: tB, cliente_id: null, segmento: null, vigencia_inicio: vigB, vigencia_fim: null, titulo: 'Display de óleo', instrucao: null, prazo: null, ...comuns },
    ],
    'promotor.ponto_extra_negociado': [
      { id: PA.pontoNegociado, tenant_id: tA, cliente_id: A.cliente, tipo: 'ponta_gondola', local_combinado: 'Ponta do corredor 3', produto_id: A.produto, vigencia_inicio: vigA, vigencia_fim: null, ...comuns },
      { id: PB.pontoNegociado, tenant_id: tB, cliente_id: B.cliente, tipo: 'display', local_combinado: 'Entrada da loja', produto_id: null, vigencia_inicio: vigB, vigencia_fim: somarDias(hojeB, 30), ...comuns },
    ],
    'promotor.visita_loja': [
      coleta(PA.visitaLoja, tA, A.promotor, A.cliente, {
        visita_id: A.visitaCore, cliente_id: A.cliente, checklist_modelo_id: PA.checklist, checkin_em: emA('15:00'), checkout_em: emA('15:30'),
        permanencia_min: 30, desfecho: 'realizada', foto_fachada_id: null, observacao: null,
      }, emA('15:31')),
      coleta(PB.visitaLoja, tB, B.promotor, B.cliente, {
        visita_id: B.visitaCore, cliente_id: B.cliente, checklist_modelo_id: PB.checklist, checkin_em: emB('12:00'), checkout_em: emB('12:30'),
        permanencia_min: 30, desfecho: 'realizada', foto_fachada_id: null, observacao: 'Gerente da loja ausente',
      }, emB('12:31')),
    ],
    'promotor.foto_coleta': [
      foto(PA.fotos.antes, tA, A.promotor, A.cliente, PA.visitaLoja, 'gondola_antes', emA('15:03'), emA('15:31')),
      foto(PA.fotos.depois, tA, A.promotor, A.cliente, PA.visitaLoja, 'gondola_depois', emA('15:12'), emA('15:31')),
      foto(PA.fotos.ponto, tA, A.promotor, A.cliente, PA.visitaLoja, 'ponto_extra', emA('15:18'), emA('15:31')),
      foto(PA.fotos.tarefa, tA, A.promotor, A.cliente, PA.visitaLoja, 'tarefa', emA('15:22'), emA('15:31')),
      foto(PB.fotos.antes, tB, B.promotor, B.cliente, PB.visitaLoja, 'gondola_antes', emB('12:03'), emB('12:31')),
      foto(PB.fotos.depois, tB, B.promotor, B.cliente, PB.visitaLoja, 'gondola_depois', emB('12:10'), emB('12:31')),
      foto(PB.fotos.tarefa, tB, B.promotor, B.cliente, PB.visitaLoja, 'tarefa', emB('12:20'), emB('12:31')),
    ],
    'promotor.checklist_resposta': [
      coleta(a('checklist_resposta', 1), tA, A.promotor, A.cliente, {
        visita_loja_id: PA.visitaLoja, checklist_item_id: PA.etapas.gondola, obrigatoria: true, concluida: true, respondido_em: emA('15:13'), valor: null, foto_id: PA.fotos.depois,
      }, emA('15:31')),
      coleta(b('checklist_resposta', 1), tB, B.promotor, B.cliente, {
        visita_loja_id: PB.visitaLoja, checklist_item_id: PB.etapa, obrigatoria: true, concluida: true, respondido_em: emB('12:15'), valor: 'ok', foto_id: null,
      }, emB('12:31')),
    ],
    'promotor.gondola_registro': [
      coleta(a('gondola_registro', 1), tA, A.promotor, A.cliente, {
        visita_loja_id: PA.visitaLoja, categoria_gondola_id: PA.categorias.freios, foto_antes_id: PA.fotos.antes, foto_depois_id: PA.fotos.depois,
        foto_referencia_id: PA.fotoReferencia, conformidade: 'conforme', motivo: null, registrado_em: emA('15:12'),
      }, emA('15:31')),
      coleta(b('gondola_registro', 1), tB, B.promotor, B.cliente, {
        visita_loja_id: PB.visitaLoja, categoria_gondola_id: PB.categoria, foto_antes_id: PB.fotos.antes, foto_depois_id: PB.fotos.depois,
        foto_referencia_id: null, conformidade: 'parcial', motivo: 'Faltou espaço na prateleira', registrado_em: emB('12:10'),
      }, emB('12:31')),
    ],
    'promotor.medicao_share': [
      // A: 4 de 10 frentes = 40% com meta 40% (atingimento 100%); B: 3 de 12 = 25% com meta 30% (83,33%)
      coleta(a('medicao_share', 1), tA, A.promotor, A.cliente, {
        visita_loja_id: PA.visitaLoja, categoria_gondola_id: PA.categorias.freios, frentes_nossas: 4, frentes_total: 10, cm_nossos: null, cm_total: null,
        share_pct: 40, meta_share_id: PA.metaShare, meta_pct: 40, atingimento_pct: 100, medido_em: emA('15:14'),
      }, emA('15:31')),
      coleta(b('medicao_share', 1), tB, B.promotor, B.cliente, {
        visita_loja_id: PB.visitaLoja, categoria_gondola_id: PB.categoria, frentes_nossas: 3, frentes_total: 12, cm_nossos: null, cm_total: null,
        share_pct: 25, meta_share_id: PB.metaShare, meta_pct: 30, atingimento_pct: 83.33, medido_em: emB('12:12'),
      }, emB('12:31')),
    ],
    'promotor.coleta_preco': [
      coleta(a('coleta_preco', 1), tA, A.promotor, A.cliente, {
        visita_loja_id: PA.visitaLoja, produto_id: A.produto, concorrente_id: null, produto_concorrente_id: null, preco_cents: 4_590, em_promocao: false,
        em_encarte: false, preco_promocional_cents: null, preco_nosso_ref_cents: null, indice_preco: null, preco_anterior_cents: null,
        variacao_confirmada: false, coletado_em: emA('15:15'),
      }, emA('15:31')),
      // concorrente em promoção: índice = nosso 4.590 ÷ promocional 4.250 × 100 = 108 (RN-PRO-04)
      coleta(a('coleta_preco', 2), tA, A.promotor, A.cliente, {
        visita_loja_id: PA.visitaLoja, produto_id: A.produto, concorrente_id: PA.concorrente, produto_concorrente_id: PA.produtoConcorrente, preco_cents: 4_490,
        em_promocao: true, em_encarte: false, preco_promocional_cents: 4_250, preco_nosso_ref_cents: 4_590, indice_preco: 108, preco_anterior_cents: null,
        variacao_confirmada: false, coletado_em: emA('15:16'),
      }, emA('15:31')),
      coleta(b('coleta_preco', 1), tB, B.promotor, B.cliente, {
        visita_loja_id: PB.visitaLoja, produto_id: B.produto, concorrente_id: null, produto_concorrente_id: null, preco_cents: 3_290, em_promocao: false,
        em_encarte: false, preco_promocional_cents: null, preco_nosso_ref_cents: null, indice_preco: null, preco_anterior_cents: 3_190,
        variacao_confirmada: false, coletado_em: emB('12:13'),
      }, emB('12:31')),
    ],
    'promotor.ruptura_item': [
      coleta(a('ruptura_item', 1), tA, A.promotor, A.cliente, {
        visita_loja_id: PA.visitaLoja, produto_id: A.produto, mix_obrigatorio_id: PA.mix, status: 'ruptura_gondola', quantidade_reposta: 6, foto_id: null,
        registrado_em: emA('15:17'),
      }, emA('15:31')),
      coleta(b('ruptura_item', 1), tB, B.promotor, B.cliente, {
        visita_loja_id: PB.visitaLoja, produto_id: B.produto, mix_obrigatorio_id: PB.mix, status: 'ruptura_total', quantidade_reposta: 0, foto_id: null,
        registrado_em: emB('12:14'),
      }, emB('12:31')),
    ],
    'promotor.validade_item': [
      coleta(a('validade_item', 1), tA, A.promotor, A.cliente, {
        visita_loja_id: PA.visitaLoja, produto_id: A.produto2, tipo: 'validade', validade: somarDias(hojeA, 20), lote: 'L2026A', quantidade: 6,
        motivo_avaria: null, foto_id: null, registrado_em: emA('15:19'),
      }, emA('15:31')),
      coleta(b('validade_item', 1), tB, B.promotor, B.cliente, {
        visita_loja_id: PB.visitaLoja, produto_id: B.produto, tipo: 'avaria', validade: null, lote: null, quantidade: 2, motivo_avaria: 'Embalagem amassada',
        foto_id: PB.fotos.depois, registrado_em: emB('12:16'),
      }, emB('12:31')),
    ],
    'promotor.ponto_extra': [
      coleta(a('ponto_extra', 1), tA, A.promotor, A.cliente, {
        visita_loja_id: PA.visitaLoja, ponto_extra_negociado_id: PA.pontoNegociado, tipo: 'ponta_gondola', existe: true, no_lugar: true, abastecido: true,
        foto_id: PA.fotos.ponto, observacao: null, registrado_em: emA('15:18'),
      }, emA('15:31')),
      coleta(b('ponto_extra', 1), tB, B.promotor, B.cliente, {
        visita_loja_id: PB.visitaLoja, ponto_extra_negociado_id: PB.pontoNegociado, tipo: 'display', existe: false, no_lugar: false, abastecido: false,
        foto_id: null, observacao: 'Display retirado pela loja', registrado_em: emB('12:17'),
      }, emB('12:31')),
    ],
    'promotor.acao_concorrencia': [
      coleta(a('acao_concorrencia', 1), tA, A.promotor, A.cliente, {
        visita_loja_id: PA.visitaLoja, concorrente_id: PA.concorrente, tipo: 'promocao', descricao: 'Leve 2 pague 1 na pastilha rival', foto_id: null,
        registrado_em: emA('15:20'),
      }, emA('15:31')),
      coleta(b('acao_concorrencia', 1), tB, B.promotor, B.cliente, {
        visita_loja_id: PB.visitaLoja, concorrente_id: PB.concorrente, tipo: 'acao_pdv', descricao: 'Degustação na entrada', foto_id: null,
        registrado_em: emB('12:18'),
      }, emB('12:31')),
    ],
    'promotor.tarefa_execucao': [
      coleta(a('tarefa_execucao', 1), tA, A.promotor, A.cliente, {
        tarefa_trade_id: PA.tarefa, visita_loja_id: PA.visitaLoja, cliente_id: A.cliente, foto_ids: [PA.fotos.tarefa], observacao: null, concluida_em: emA('15:22'),
      }, emA('15:31')),
      coleta(b('tarefa_execucao', 1), tB, B.promotor, B.cliente, {
        tarefa_trade_id: PB.tarefa, visita_loja_id: PB.visitaLoja, cliente_id: B.cliente, foto_ids: [PB.fotos.tarefa], observacao: 'Display montado', concluida_em: emB('12:20'),
      }, emB('12:31')),
    ],
  };
}
