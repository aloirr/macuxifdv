/**
 * Base de DEMONSTRAÇÃO — monitor da Integração ERP (schema integracao, 0010/0013/0037/0043; T-0051, pedido
 * R-20261102-125759-2-modulo-integracao). Dono: banco-dados. O demo.ts chama `gravarDemoIntegracao(admin)` na MESMA transação
 * do carregarDemo, depois do laço (plataforma.tenant e plataforma.perfil já gravados).
 *
 * Para o login de admin (ou analista) da demo abrir /integracao e ver Conectores, alertas, lotes e a inativação aguardando:
 *  1. Licença: plataforma.tenant_modulo `integracao` ativo e plataforma.perfil_modulo `integracao` para admin e analista
 *     (sem perfis de campo; a ação monitor.ver é desses dois perfis no manifesto da Integração).
 *  2. Conectores: "ERP Matriz" (erp-matriz) ativo, recebe pedidos, versão 1.2.1, último sinal 2 min antes do seed; "ERP
 *     Filial" (erp-filial) ativo, sem receber pedidos (a guarda P-7 permite um só por empresa), último sinal 3 h antes do seed
 *     (sem sinal há mais de 15 min = alerta). SEM credencial: nenhum dos dois autentica no Hub, nada sai da fila de pedidos.
 *  3. Política de versão: mínima e recomendada 1.2.1.
 *  4. Lotes (5): produto delta concluído, cliente completo concluído (o da inativação), preço delta concluído com 2 erros
 *     (lote_linha_erro só com external_id, código e mensagem — sem payload nem dado pessoal), estoque delta que falhou e
 *     título delta da filial concluído.
 *  5. Inativação aguardando: 3 clientes de 30 ativos (10%, limite 5%) na carga completa de cliente, validade de 7 dias.
 *  6. T-0155: a fila do ERP dos 3 pedidos faturados da demo (FATURAMENTOS_DEMO de demo.ts): pedido_fila_erp já entregue ao ERP
 *     Matriz e fechado em faturado_total/faturado_parcial, com a trilha pedido_retorno (integrado + faturado). Montada a partir
 *     das linhas do Vendedor pelas funções do Hub (decidirEntradaNaFila, aplicarRetornoPedido) — os instantes são os da linha do
 *     tempo do pedido, não o now(). Os demais pedidos aprovados da demo seguem sem linha na fila (o seed não publica aprovado@1).
 * Instantes relativos ao now() DO BANCO no momento do seed (nada de data fixa). Atenção para o roteiro: o "último sinal" do
 * ERP Matriz envelhece; rode o seed de novo (sem --recriar) antes da demonstração para ele voltar a "agora".
 *
 * Idempotente: upsert por id determinístico (`demo:integracao:<chave>`). Inativação já decidida no ensaio (confirmada ou
 * recusada pelo BKO) não volta a aguardar: o seed não regrava a pendência. Só tenant demo; só Postgres local ou servidor da
 * demo (exigirBancoDemo). Banco sem a 0043 (conector.aceita_cancelamento) = só falta a coluna; não é lida aqui.
 */
import { createHash } from 'node:crypto';
import type { ClientBase } from 'pg';
import { VERSAO_CONTRATO } from '../../../modules/integracao/contracts';
import { aplicarRetornoPedido, decidirEntradaNaFila, exigeConector, montarSnapshotParaFila, type Mapeamento, type PedidoNaFila } from '../../../modules/integracao/domain';
import { enderecoParaEvento, montarPedidoAprovado } from '../../../modules/vendedor/domain/aprovacao';
import { exigirBancoDemo, hostDoCliente } from '../../src/config';
import { arrayDeTexto, gravarLinhas, type Linha } from '../../src/gravar';
import { idDeterministico } from '../../src/ids';
// só TIPO de demo.ts: demo.ts importa este arquivo (import de valor aqui seria circular)
import type { DadosDemo } from './demo';

/** Tenant demo (= TENANT_DEMO de demo.ts; conferido em db/testes/seed-demo.test.ts). */
export const TENANT_DEMO_INTEGRACAO = 'dd000000-0000-4000-8000-000000000001';
const T = TENANT_DEMO_INTEGRACAO;
const idDemo = (chave: string) => idDeterministico(`demo:${chave}`);
const id = (chave: string) => idDemo(`integracao:${chave}`);
const comuns = { deleted_at: null, external_id: null } as const;
const sha = (x: string) => createHash('sha256').update(x).digest('hex');

export const MODULO_INTEGRACAO = 'integracao';
/** Perfis com a Integração na demo (monitor.ver: admin e analista; nenhum perfil de campo). */
export const PERFIS_INTEGRACAO_DEMO = ['admin', 'analista'] as const;
export const VERSAO_CONECTOR_DEMO = '1.2.1';

/** Ids e números da base do monitor (os testes conferem por eles). */
export const INTEGRACAO_DEMO = {
  conectores: { matriz: id('conector:erp-matriz'), filial: id('conector:erp-filial') },
  identificadores: { matriz: 'erp-matriz', filial: 'erp-filial' },
  sessaoCliente: id('sessao_carga:cliente'),
  lotes: {
    produto: id('lote:produto'),
    cliente: id('lote:cliente'),
    preco: id('lote:preco'),
    estoque: id('lote:estoque'),
    titulo: id('lote:titulo'),
  },
  pendencia: id('pendencia_inativacao:cliente'),
  /** minutos antes do now() do banco */
  sinalMatrizMin: 2,
  sinalFilialMin: 180,
  validadeDias: 7,
} as const;

const MIN = 60_000;
const DIA = 86_400_000;

export type DadosIntegracaoDemo = Record<
  | 'plataforma.tenant_modulo'
  | 'plataforma.perfil_modulo'
  | 'integracao.conector'
  | 'integracao.politica_versao'
  | 'integracao.sessao_carga'
  | 'integracao.lote'
  | 'integracao.lote_linha_erro'
  | 'integracao.pendencia_inativacao',
  Linha[]
>;

/** Função pura: as linhas do monitor para o instante `agora` (o now() do banco no seed). */
export function dadosIntegracaoDemo(agora: Date): DadosIntegracaoDemo {
  const D = INTEGRACAO_DEMO;
  const antes = (min: number) => new Date(agora.getTime() - min * MIN).toISOString();
  const conector = (chave: 'matriz' | 'filial', nome: string, recebe: boolean, sinalMin: number, entidades: readonly string[]): Linha => ({
    id: D.conectores[chave], tenant_id: T, identificador: D.identificadores[chave], nome, tipo: 'conector', ativo: true, recebe_pedidos: recebe,
    entidades: arrayDeTexto(entidades), ips_permitidos: '{}', versao_conector: VERSAO_CONECTOR_DEMO, versao_contrato: 'v1',
    ultimo_sinal_em: antes(sinalMin), parado_por_versao: false, sinal_resumo: { fila_local: 0 }, deriva_relogio_s: 0, ...comuns,
  });
  const lote = (chave: keyof typeof D.lotes, conectorId: string, entidade: string, recebidoMin: number, extra: Partial<Linha>): Linha => {
    const completo = chave === 'cliente';
    return {
      id: D.lotes[chave], tenant_id: T, conector_id: conectorId, entidade, modo: completo ? 'completo' : 'delta', versao_contrato: 'v1',
      sessao_id: completo ? D.sessaoCliente : null, sessao_parte: completo ? 1 : null, sessao_ultimo: completo ? true : null,
      chave_idempotencia: sha(`demo:integracao:idem:${chave}`), hash_conteudo: sha(`demo:integracao:conteudo:${chave}`),
      status: 'concluido', recebidas: 1, duplicadas_no_lote: 0, com_erro: 0, novas: 0, atualizadas: 1, inalteradas: 0, obsoletas: 0, inativadas: 0,
      invalidas_omitidas: 0, aplicado_ate_indice: 0, cursor_declarado: null, cursor_resultante: null, versao_conector: VERSAO_CONECTOR_DEMO,
      bytes: 2048, avisos: null, tentativas: 1, ultimo_erro: null, recebido_em: antes(recebidoMin), iniciado_em: antes(recebidoMin - 0.1),
      concluido_em: antes(recebidoMin - 0.5), ...comuns, ...extra,
    };
  };
  const erro = (indice: number, codigo: string, campo: string, mensagem: string, externalId: string): Linha => ({
    id: id(`lote_linha_erro:preco:${indice}`), tenant_id: T, lote_id: D.lotes.preco, indice, origem: 'hub', codigo, campo, mensagem,
    reprocessavel: false, payload: null, resolvido_em: null, resolvido_no_lote_id: null, deleted_at: null, external_id: externalId,
  });
  const todas = ['vendedor', 'cliente', 'produto', 'preco', 'estoque', 'titulo', 'nota', 'rota'] as const;
  return {
    'plataforma.tenant_modulo': [
      { id: idDemo(`tenant_modulo:${MODULO_INTEGRACAO}`), tenant_id: T, modulo: MODULO_INTEGRACAO, ativo: true, plano: 'demonstracao', licencas: null, desativado_em: null, ...comuns },
    ],
    'plataforma.perfil_modulo': PERFIS_INTEGRACAO_DEMO.map((perfil) => ({ id: idDemo(`perfil_modulo:${perfil}:${MODULO_INTEGRACAO}`), tenant_id: T, perfil, modulo: MODULO_INTEGRACAO, ...comuns })),
    'integracao.conector': [
      conector('filial', 'ERP Filial Itacoatiara', false, D.sinalFilialMin, ['titulo', 'estoque']),
      conector('matriz', 'ERP Matriz', true, D.sinalMatrizMin, todas),
    ],
    'integracao.politica_versao': [
      {
        id: id('politica_versao'), tenant_id: T, versao_minima: VERSAO_CONECTOR_DEMO, versao_recomendada: VERSAO_CONECTOR_DEMO,
        mensagem: 'Mantenha o Conector na versão 1.2.1.', pacote: null, ...comuns,
      },
    ],
    'integracao.sessao_carga': [
      {
        id: D.sessaoCliente, tenant_id: T, sessao_uuid: id('sessao_carga:cliente:uuid'), conector_id: D.conectores.matriz, entidade: 'cliente',
        iniciada_em: antes(31), ultima_parte: 1, fechada_em: antes(30), situacao: 'completa', inativadas: 0, linhas_sem_identificacao: 0,
        invalidas_omitidas: 0, ...comuns,
      },
    ],
    'integracao.lote': [
      lote('produto', D.conectores.matriz, 'produto', 40, { recebidas: 12, atualizadas: 12 }),
      lote('cliente', D.conectores.matriz, 'cliente', 30, { recebidas: 27, atualizadas: 27, aplicado_ate_indice: 26 }),
      lote('preco', D.conectores.matriz, 'preco', 25, { status: 'concluido_com_erros', recebidas: 40, com_erro: 2, atualizadas: 38, aplicado_ate_indice: 39 }),
      lote('estoque', D.conectores.matriz, 'estoque', 20, {
        status: 'falhou', recebidas: 60, atualizadas: 0, aplicado_ate_indice: null, tentativas: 3, concluido_em: null,
        ultimo_erro: 'Tempo esgotado ao gravar o lote; o Conector reenvia no próximo ciclo.',
      }),
      lote('titulo', D.conectores.filial, 'titulo', D.sinalFilialMin + 5, { recebidas: 8, atualizadas: 8, aplicado_ate_indice: 7 }),
    ],
    'integracao.lote_linha_erro': [
      erro(7, 'referencia_ausente', 'produto_external_id', 'Produto não encontrado no Macuxi para este preço.', 'VAREJO:PRD-9001:20261101'),
      erro(19, 'valor_fora_da_faixa', 'preco_cents', 'Preço deve ser maior que zero.', 'ATACADO:PRD-1040:20261101'),
    ],
    'integracao.pendencia_inativacao': [
      {
        id: D.pendencia, tenant_id: T, sessao_id: D.sessaoCliente, entidade: 'cliente', conector_id: D.conectores.matriz, lote_id: D.lotes.cliente,
        estado: 'aguardando', candidatos: 3, total_ativos: 30, percentual: '10.00', limite_pct: '5.00', amostra: ['CLI-9101', 'CLI-9102', 'CLI-9103'],
        expira_em: new Date(agora.getTime() + D.validadeDias * DIA).toISOString(), decidida_em: null, decidida_por: null, decidida_por_perfil: null,
        motivo_decisao: null, ...comuns,
      },
    ],
  };
}

/**
 * T-0155: de-para da condição de pagamento com que os pedidos faturados da demo foram ao ERP (o payload da fila é o retrato da
 * entrega). Não vira linha de integracao.mapeamento: a tela de Mapeamento da demo continua como estava.
 */
export const DE_PARA_CONDICAO_DEMO: readonly Mapeamento[] = [
  { tipo: 'condicao_pagamento', codigo_macuxi: 'AVISTA', codigo_erp: '001', ativo: true },
  { tipo: 'condicao_pagamento', codigo_macuxi: '28D', codigo_erp: '028', ativo: true },
  { tipo: 'condicao_pagamento', codigo_macuxi: '28-56', codigo_erp: '056', ativo: true },
  { tipo: 'condicao_pagamento', codigo_macuxi: '30-60-90', codigo_erp: '090', ativo: true },
];

/** Status do Vendedor que já passaram pelo ERP na demo (têm linha na fila). */
const FATURADOS = new Set(['invoiced', 'invoiced_partial']);
type FilaDemo = Pick<
  DadosDemo,
  'core.cliente' | 'core.usuario' | 'core.produto' | 'vendedor.condicao_pagamento' | 'vendedor.transportadora' | 'vendedor.pedido' | 'vendedor.pedido_item' | 'vendedor.pedido_faturamento'
>;
const isoDe = (v: unknown) => new Date(String(v)).toISOString();
const textoOuNulo = (v: unknown) => (v === null || v === undefined ? null : String(v));

/**
 * T-0155 (função pura): fila do ERP e trilha dos retornos dos pedidos faturados da demo. O aprovado@1 sai do montarPedidoAprovado
 * do Vendedor; a entrada na fila, do decidirEntradaNaFila; os retornos (integrado e a nota de faturamento), do aplicarRetornoPedido.
 * Retorno recusado, repetido ou com item descartado = erro do seed (a fila nunca fica diferente do pedido).
 */
export function dadosFilaErpDemo(dados: FilaDemo): { 'integracao.pedido_fila_erp': Linha[]; 'integracao.pedido_retorno': Linha[] } {
  const fila: Linha[] = [];
  const retornos: Linha[] = [];
  const conectorId = INTEGRACAO_DEMO.conectores.matriz;
  const porId = (linhas: readonly Linha[]) => new Map(linhas.map((l) => [String(l.id), l]));
  const clientes = porId(dados['core.cliente']);
  const usuarios = porId(dados['core.usuario']);
  const produtos = porId(dados['core.produto']);
  const condicoes = porId(dados['vendedor.condicao_pagamento']);
  const transportadoras = porId(dados['vendedor.transportadora']);
  for (const p of dados['vendedor.pedido'].filter((x) => FATURADOS.has(String(x.status)))) {
    const pedidoId = String(p.id);
    const itens = dados['vendedor.pedido_item'].filter((i) => i.pedido_id === p.id).sort((a, b) => Number(a.sequencia) - Number(b.sequencia));
    const skuDaSequencia = new Map(itens.map((i) => [Number(i.sequencia), String(produtos.get(String(i.produto_id))?.external_id)]));
    const transp = p.transportadora_id ? transportadoras.get(String(p.transportadora_id)) : undefined;
    const aprovado = montarPedidoAprovado({
      pedido_uuid: pedidoId,
      cliente_external_id: textoOuNulo(clientes.get(String(p.cliente_id))?.external_id),
      vendedor_external_id: textoOuNulo(usuarios.get(String(p.vendedor_id))?.external_id),
      condicao_pagamento_codigo: textoOuNulo(condicoes.get(String(p.condicao_pagamento_id))?.codigo),
      pagamento: null,
      criado_em: isoDe(p.criado_no_aparelho_em),
      // dentro da alçada: aprovado na chegada (sem decisão)
      aprovado_em: isoDe(p.decidido_em ?? p.created_at),
      observacao: textoOuNulo(p.observacao),
      desconto_pct: Number(p.desconto_pct),
      acrescimo_pct: 0,
      frete: transp
        ? {
            modalidade: 'FOB',
            transportadora: { tipo: 'cadastrada', id: String(transp.id), external_id: textoOuNulo(transp.external_id), nome: String(transp.nome), cnpj: textoOuNulo(transp.documento), telefone: textoOuNulo(transp.telefone) },
          }
        : { modalidade: 'CIF' },
      endereco_entrega: enderecoParaEvento(p.endereco_entrega as Record<string, unknown> | null),
      itens: itens.map((i) => ({
        produto_external_id: textoOuNulo(produtos.get(String(i.produto_id))?.external_id),
        quantidade: Number(i.quantidade),
        preco_tabela_cents: Number(i.preco_tabela_cents),
        total_cents: Number(i.total_cents),
        unidade: textoOuNulo(i.unidade),
        fator: 1,
        quantidade_venda: Number(i.quantidade),
        desconto_pct: Number(i.desconto_pct),
        acrescimo_pct: 0,
        aplicacao: null,
      })),
    });
    const snap = montarSnapshotParaFila(aprovado);
    if (!snap.ok) throw new Error(`[db] seed demo integração: pedido faturado retido na fila (${snap.mensagem})`);
    const entrada = decidirEntradaNaFila({ existente: null, statusPedido: 'aprovado', snapshot: snap.snapshot, invalido: null, mapeamentos: DE_PARA_CONDICAO_DEMO });
    if (entrada.acao !== 'criar') throw new Error(`[db] seed demo integração: o pedido faturado não entraria na fila (${entrada.acao})`);
    // o Conector já o retirou (GET /pedidos/pendentes) na hora do "Enviado ao ERP"
    let item: PedidoNaFila = {
      pedido_uuid: pedidoId, estado: 'enviado', payload: entrada.pedido, retencao_codigo: null, enviado_em: isoDe(p.enviado_erp_em), tentativas: 1,
      numero_erp: null, motivo: null, notas_aplicadas: [], itens_faturados_acumulados: {}, removido_em: null,
    };
    const notas = dados['vendedor.pedido_faturamento'].filter((f) => f.pedido_id === p.id).sort((a, b) => String(a.faturado_em).localeCompare(String(b.faturado_em)));
    if (notas.length === 0) throw new Error('[db] seed demo integração: pedido faturado sem nota de faturamento');
    const recebidos = [
      { versao_contrato: VERSAO_CONTRATO, pedido_uuid: pedidoId, status: 'integrado' as const, numero_erp: String(p.numero_erp), motivo: null, nota: null, itens_faturados: null, ocorrido_em: isoDe(p.integrado_em) },
      ...notas.map((f) => ({
        versao_contrato: VERSAO_CONTRATO,
        pedido_uuid: pedidoId,
        status: f.parcial === true ? ('faturado_parcial' as const) : ('faturado_total' as const),
        numero_erp: String(f.numero_erp),
        motivo: null,
        nota: { numero: String(f.nota_numero), serie: textoOuNulo(f.nota_serie), emitida_em: isoDe(f.nota_emitida_em), total_cents: Number(f.nota_total_cents) },
        itens_faturados: (f.itens as Array<{ sequencia: number; quantidade: number; total_cents: number }>).map((i) => ({
          sequencia: i.sequencia, produto_external_id: skuDaSequencia.get(i.sequencia)!, quantidade: i.quantidade, valor_cents: i.total_cents,
        })),
        ocorrido_em: isoDe(f.faturado_em),
      })),
    ];
    for (const [k, ret] of recebidos.entries()) {
      const r = aplicarRetornoPedido(item, ret);
      if (!r.ok || r.repetido || r.itens_descartados.length > 0) throw new Error(`[db] seed demo integração: retorno ${ret.status} recusado pela fila do ERP`);
      const a = r.atualizacao;
      item = { ...item, estado: a.estado, numero_erp: a.numero_erp, motivo: a.motivo, notas_aplicadas: a.notas_aplicadas, itens_faturados_acumulados: a.itens_faturados_acumulados };
      retornos.push({
        id: id(`pedido_retorno:${pedidoId}:${k + 1}`), tenant_id: T, pedido_uuid: pedidoId, status: ret.status, numero_erp: a.numero_erp, motivo: null,
        nota_numero: ret.nota?.numero ?? null, nota_serie: ret.nota?.serie ?? null, nota_emitida_em: ret.nota?.emitida_em ?? null, nota_total_cents: ret.nota?.total_cents ?? null,
        itens_faturados: r.evento.itens_faturados ?? null, ocorrido_em: ret.ocorrido_em, conector_id: conectorId, ...comuns,
      });
    }
    const ultimo = recebidos[recebidos.length - 1]!;
    fila.push({
      id: id(`pedido_fila_erp:${pedidoId}`), tenant_id: T, pedido_uuid: pedidoId, estado: item.estado, payload: item.payload, payload_origem: aprovado,
      retencao_codigo: null, retencao_mensagem: null, conector_id: conectorId, enviado_em: item.enviado_em, tentativas: item.tentativas, numero_erp: item.numero_erp,
      motivo: item.motivo, nota_numero: ultimo.nota?.numero ?? null, nota_serie: ultimo.nota?.serie ?? null, nota_emitida_em: ultimo.nota?.emitida_em ?? null,
      nota_total_cents: ultimo.nota?.total_cents ?? null, notas_aplicadas: item.notas_aplicadas, itens_faturados_acumulados: item.itens_faturados_acumulados,
      ultimo_retorno_em: ultimo.ocorrido_em, aprovado_em: aprovado.aprovado_em, exige_conector: exigeConector(entrada.pedido), ...comuns,
    });
  }
  return { 'integracao.pedido_fila_erp': fila, 'integracao.pedido_retorno': retornos };
}


/** Grava a base do monitor da Integração (dentro da transação do carregarDemo). Devolve a hora (now() do banco) usada. */
export async function gravarDemoIntegracao(admin: ClientBase, dados: FilaDemo): Promise<{ agora: Date; pendenciaGravada: boolean }> {
  exigirBancoDemo(hostDoCliente(admin), 'Seed do monitor da Integração ERP da demo');
  const existe = await admin.query<{ ok: boolean }>("select to_regclass('integracao.pendencia_inativacao') is not null as ok");
  if (!existe.rows[0]?.ok) throw new Error('[db] base de demo da Integração precisa da migração 0010_integracao: rode "banco migrar up" antes.');
  const agora = (await admin.query<{ agora: Date }>('select now() as agora')).rows[0]!.agora;
  const d = dadosIntegracaoDemo(agora);
  for (const linhas of Object.values(d)) for (const l of linhas) if (l.tenant_id !== T) throw new Error('[db] seed demo integração: linha fora do tenant demo');
  await gravarLinhas(admin, 'plataforma.tenant_modulo', d['plataforma.tenant_modulo']);
  await gravarLinhas(admin, 'plataforma.perfil_modulo', d['plataforma.perfil_modulo']);
  // a filial (sem pedidos) antes da matriz; a guarda P-7 (um só Conector ativo que recebe pedidos) vale com os dois
  await gravarLinhas(admin, 'integracao.conector', d['integracao.conector']);
  await gravarLinhas(admin, 'integracao.politica_versao', d['integracao.politica_versao']);
  await gravarLinhas(admin, 'integracao.sessao_carga', d['integracao.sessao_carga']);
  await gravarLinhas(admin, 'integracao.lote', d['integracao.lote']);
  await gravarLinhas(admin, 'integracao.lote_linha_erro', d['integracao.lote_linha_erro']);
  // T-0155: fila do ERP dos pedidos faturados (depois do Conector: FK conector_id), a trilha depois da fila (FK pedido_uuid)
  const f = dadosFilaErpDemo(dados);
  for (const linhas of Object.values(f)) for (const l of linhas) if (l.tenant_id !== T) throw new Error('[db] seed demo integração: linha fora do tenant demo');
  await gravarLinhas(admin, 'integracao.pedido_fila_erp', f['integracao.pedido_fila_erp']);
  await gravarLinhas(admin, 'integracao.pedido_retorno', f['integracao.pedido_retorno']);
  // inativação decidida no ensaio (confirmada/recusada/expirada) fica como está
  const decidida = await admin.query("select 1 from integracao.pendencia_inativacao where tenant_id = $1 and id = $2 and estado <> 'aguardando'", [T, INTEGRACAO_DEMO.pendencia]);
  if ((decidida.rowCount ?? 0) > 0) return { agora, pendenciaGravada: false };
  await gravarLinhas(admin, 'integracao.pendencia_inativacao', d['integracao.pendencia_inativacao']);
  return { agora, pendenciaGravada: true };
}
