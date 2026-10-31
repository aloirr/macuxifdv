/**
 * Manifestos de REFERÊNCIA dos 8 módulos (desenho T-0001, a partir de .coord/contratos/*.md e do doc 04).
 * Servem de modelo para os agentes de módulo e provam que o conjunto é consistente (dependências,
 * extensões oferecidas × usadas, sem ciclo). A fonte da verdade passa a ser `modules/<m>/manifest.ts`.
 * Espelho em dia com os manifestos reais em 2026-10-31 (T-0007/T-0010/T-0011/T-0012). Onde o espelho está à frente
 * do manifesto real (estado-alvo já decidido), o comentário do módulo diz qual recado aplica a mudança.
 * O registro legível fica em `.coord/contratos/modulos.md` e `.coord/contratos/eventos.md`.
 */
import { describe, expect, it } from 'vitest';
import { defineModule, ordenarPorDependencia, validarConjunto, type ManifestoEntrada } from './manifesto';
import { modulosEfetivos } from './modulos-efetivos';

const PEDIDO = ['vendedor', 'supervisor', 'gerente', 'analista', 'assistente'] as const;
const COLETA = ['promotor'] as const;
const CADASTRO = ['analista', 'admin'] as const;
const CAMPO = ['vendedor', 'promotor', 'supervisor', 'gerente'] as const;
const GESTAO = ['supervisor', 'gerente', 'analista', 'admin'] as const;

export const REFERENCIA: ManifestoEntrada[] = [
  {
    // Alvo (ADR 0005, revisão da T-0007): o Core consome `integracao.produto.atualizado@1` (dono do cadastro base de
    // produto); o manifesto real ainda não declara (pedido ao modulo-core).
    id: 'core',
    versao: '0.1.0',
    perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
    apps: {
      campo: { abas: ['Início', 'Rota', 'Clientes', 'Metas'] },
      gestao: { abas: ['Início', 'Clientes'] },
      web: { menus: ['Clientes', 'Rotas', 'Metas', 'Plano de RV', 'Usuários e módulos'] },
    },
    sync: ['cliente', 'cliente_contato', 'carteira', 'cliente_financeiro', 'titulo', 'historico_compra', 'rota', 'rota_parada', 'visita', 'visita_etapa', 'motivo', 'meta', 'indicador_diario', 'notificacao'],
    publica: ['core.cliente.atualizado@1', 'core.visita.checkin@1', 'core.visita.checkout@1', 'core.usuario.modulos_alterados@1'],
    consome: ['vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'treinamento.medalha.conquistada@1', 'integracao.cliente.atualizado@1', 'integracao.produto.atualizado@1'],
    acoes: {
      'rota.editar': { perfis: ['gerente', 'analista', 'admin'] },
      'meta.fechar_periodo': { perfis: ['gerente', 'analista', 'admin'] },
      'plano_rv.editar': { perfis: ['analista'] },
    },
    ofereceExtensoes: ['cliente.abas', 'cliente.acoes', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'],
  },
  {
    // ADR 0005 (T-0007): sem `produto` no sync (o cadastro base é do Core); `assistente` porque o Vendedor depende do
    // Catálogo. Alvo: deixa de consumir `integracao.produto.atualizado@1` (só preço e estoque); o manifesto real ainda
    // consome (pedido ao modulo-catalogo).
    id: 'catalogo',
    versao: '0.1.0',
    depende: ['core'],
    perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente'],
    apps: { campo: { abas: ['Catálogo'] }, gestao: { abas: ['Catálogo'] }, web: { menus: ['Catálogo'] } },
    sync: ['tabela_preco', 'tabela_preco_item', 'deposito', 'estoque_saldo', 'categoria', 'marca', 'produto_atributo', 'produto_midia', 'produto_conteudo', 'sinonimo'],
    publica: ['catalogo.produto.visualizado@1', 'catalogo.busca.realizada@1'],
    consome: ['integracao.estoque.atualizado@1', 'integracao.preco.atualizado@1', 'catalogo.busca.realizada@1'],
    ofereceExtensoes: ['produto.acoes'],
  },
  {
    // ADR 0005 (T-0007): depende do Catálogo (RN-CORE-03). Publica `vendedor.pedido.faturado@1` a partir do retorno do
    // ERP (desenho T-0011). RN-PRO-01: `promotor` nunca entra em `perfis` nem em ação de ESCRITA de pedido; lê pedidos
    // da carteira por `pedido.ver` (doc 03 §2 "Ver pedidos", O-3, T-0015 — recado R-20261031-151439 ao modulo-vendedor).
    id: 'vendedor',
    versao: '0.1.0',
    depende: ['core', 'catalogo'],
    perfis: ['vendedor', 'analista', 'assistente'],
    apps: { campo: { abas: ['Pedidos'] }, web: { menus: ['Pedidos', 'Alçadas'] } },
    sync: ['pedido', 'pedido_item', 'pedido_evento', 'condicao_pagamento', 'cliente_condicao', 'alerta_ruptura'],
    publica: ['vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'vendedor.pedido.aprovacao_solicitada@1', 'vendedor.pedido.faturado@1'],
    consome: ['promotor.ruptura.registrada@1', 'integracao.pedido.retorno_erp@1'],
    acoes: {
      'pedido.ver': { perfis: [...PEDIDO, 'promotor'] },
      'pedido.criar': { perfis: [...PEDIDO] },
      'pedido.editar': { perfis: [...PEDIDO] },
      'pedido.cancelar': { perfis: [...PEDIDO] },
      'pedido.excluir': { perfis: [...PEDIDO] },
      'pedido.aprovar': { perfis: ['supervisor', 'gerente', 'analista'] },
      'pedido.criar_em_nome': { perfis: ['supervisor', 'gerente'] },
    },
    ofereceExtensoes: ['pedido.criar_em_nome'],
    usaExtensoes: ['produto.acoes', 'cliente.abas', 'cliente.acoes', 'visita.etapas_checkout', 'inicio.cards'],
  },
  {
    // Espelho de modules/promotor/manifest.ts (T-0010, ADR 0004): coletas só do promotor; cadastros de trade para analista e admin.
    id: 'promotor',
    versao: '0.1.0',
    depende: ['core'],
    opcionais: ['catalogo', 'pesquisa', 'vendedor'],
    perfis: ['promotor', 'supervisor', 'gerente', 'analista', 'admin'],
    apps: { campo: { abas: ['Loja'] }, gestao: { abas: ['Trade'] }, web: { menus: ['Trade marketing'] } },
    sync: ['checklist_loja', 'mix_obrigatorio', 'meta_share', 'concorrente', 'produto_concorrente', 'foto_referencia', 'tarefa_trade'],
    publica: [
      'promotor.visita_loja.concluida@1',
      'promotor.gondola.registrada@1',
      'promotor.share.medido@1',
      'promotor.preco.coletado@1',
      'promotor.ruptura.registrada@1',
      'promotor.tarefa.concluida@1',
    ],
    consome: ['core.visita.checkin@1', 'core.visita.checkout@1'],
    usaExtensoes: ['cliente.abas', 'visita.etapas_checkout', 'inicio.cards'],
    acoes: {
      'coleta.registrar': { perfis: [...COLETA] },
      'checklist_loja.responder': { perfis: [...COLETA] },
      'gondola.registrar': { perfis: [...COLETA] },
      'share.registrar': { perfis: [...COLETA] },
      'preco.registrar': { perfis: [...COLETA] },
      'ruptura.registrar': { perfis: [...COLETA] },
      'validade.registrar': { perfis: [...COLETA] },
      'ponto_extra.registrar': { perfis: [...COLETA] },
      'concorrencia.registrar': { perfis: [...COLETA] },
      'tarefa_trade.concluir': { perfis: [...COLETA] },
      'mix_obrigatorio.gerenciar': { perfis: [...CADASTRO] },
      'meta_share.gerenciar': { perfis: [...CADASTRO] },
      'categoria_gondola.gerenciar': { perfis: [...CADASTRO] },
      'concorrente.gerenciar': { perfis: [...CADASTRO] },
      'foto_referencia.gerenciar': { perfis: [...CADASTRO] },
      'checklist_modelo.gerenciar': { perfis: [...CADASTRO] },
      'ponto_extra_negociado.gerenciar': { perfis: [...CADASTRO] },
      'tarefa_trade.gerenciar': { perfis: [...CADASTRO] },
    },
  },
  {
    id: 'gestor',
    versao: '0.1.0',
    depende: ['core'],
    opcionais: ['vendedor', 'promotor', 'pesquisa', 'treinamento'],
    perfis: ['supervisor', 'gerente'],
    apps: { gestao: { abas: ['Equipe', 'Aprovações'] }, web: { menus: ['Painel da equipe'] } },
    sync: ['painel_vendedor_dia', 'alerta'],
    consome: [
      'core.cliente.atualizado@1',
      'core.visita.checkin@1',
      'core.visita.checkout@1',
      'vendedor.pedido.criado@1',
      'vendedor.pedido.status_alterado@1',
      'vendedor.pedido.aprovacao_solicitada@1',
      'promotor.visita_loja.concluida@1',
      'promotor.gondola.registrada@1',
      'promotor.share.medido@1',
      'promotor.preco.coletado@1',
      'promotor.ruptura.registrada@1',
      'promotor.tarefa.concluida@1',
      'pesquisa.resposta.registrada@1',
      'treinamento.licao.concluida@1',
      'treinamento.medalha.conquistada@1',
    ],
    usaExtensoes: ['pedido.criar_em_nome', 'cliente.abas', 'inicio.cards'],
  },
  {
    // Espelho de modules/pesquisa/manifest.ts (T-0012).
    id: 'pesquisa',
    versao: '0.1.0',
    depende: ['core'],
    perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'],
    apps: { campo: { abas: ['Pesquisas'] }, gestao: { abas: ['Pesquisas'] }, web: { menus: ['Pesquisas'] } },
    sync: ['questionario', 'questionario_versao', 'pergunta', 'resposta_pesquisa'],
    publica: ['pesquisa.resposta.registrada@1'],
    consome: ['core.visita.checkout@1'],
    usaExtensoes: ['cliente.abas', 'visita.etapas_checkout'],
    acoes: {
      'pesquisa.responder': { perfis: [...CAMPO] },
      'questionario.criar': { perfis: [...CADASTRO] },
      'questionario.editar': { perfis: [...CADASTRO] },
      'questionario.publicar': { perfis: [...CADASTRO] },
      'questionario.arquivar': { perfis: [...CADASTRO] },
      'resultado.ver': { perfis: [...GESTAO] },
      'resultado.exportar': { perfis: [...GESTAO] },
    },
  },
  {
    // Espelho de modules/treinamento/manifest.ts (T-0011, conferido na revisão final): consome só
    // `vendedor.pedido.faturado@1` (o desafio paga no FATURADO, RN-TRE-08; desenho T-0011), não `vendedor.pedido.criado@1`.
    id: 'treinamento',
    versao: '0.1.0',
    depende: ['core'],
    opcionais: ['vendedor'],
    perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'],
    apps: { campo: { abas: ['Treinar'] }, gestao: { abas: ['Treinar'] }, web: { menus: ['Trilhas'] } },
    sync: ['trilha', 'modulo_trilha', 'licao', 'quiz', 'questao', 'alternativa', 'progresso', 'tentativa', 'medalha', 'xp_lancamento', 'medalha_usuario', 'ranking_periodo'],
    publica: ['treinamento.licao.concluida@1', 'treinamento.medalha.conquistada@1'],
    consome: ['vendedor.pedido.faturado@1'],
    usaExtensoes: ['inicio.cards'],
    acoes: {
      'trilha.baixar_offline': { perfis: [...CAMPO] },
      'licao.concluir': { perfis: [...CAMPO] },
      'quiz.responder': { perfis: [...CAMPO] },
      'ranking.ver': { perfis: [...CAMPO, ...CADASTRO] },
      'adesao.ver': { perfis: [...GESTAO] },
      'notas.ver': { perfis: [...GESTAO] },
      'trilha.criar': { perfis: [...CADASTRO] },
      'trilha.editar': { perfis: [...CADASTRO] },
      'trilha.publicar': { perfis: [...CADASTRO] },
      'quiz.gerenciar': { perfis: [...CADASTRO] },
      'desafio.gerenciar': { perfis: [...CADASTRO] },
      'medalha.gerenciar': { perfis: [...CADASTRO] },
    },
  },
  {
    // Espelho de modules/integracao/manifest.ts (T-0009): um evento `integracao.<entidade>.atualizado@1` por entidade.
    id: 'integracao',
    versao: '0.1.0',
    depende: ['core'],
    perfis: ['admin', 'analista'],
    apps: { web: { menus: ['Integração ERP'] }, conector: {} },
    publica: [
      'integracao.cliente.atualizado@1',
      'integracao.produto.atualizado@1',
      'integracao.preco.atualizado@1',
      'integracao.estoque.atualizado@1',
      'integracao.vendedor.atualizado@1',
      'integracao.titulo.atualizado@1',
      'integracao.nota.atualizado@1',
      'integracao.rota.atualizado@1',
      'integracao.pedido.retorno_erp@1',
      'integracao.lote.concluido@1',
      'integracao.reconciliacao.divergente@1',
    ],
    consome: ['vendedor.pedido.status_alterado@1'],
  },
];

describe('manifestos de referência dos 8 módulos (desenho T-0001)', () => {
  const manifestos = REFERENCIA.map(defineModule);

  it('todos passam no defineModule e o conjunto é consistente', () => {
    expect(manifestos.map((m) => m.id)).toEqual(['core', 'catalogo', 'vendedor', 'promotor', 'gestor', 'pesquisa', 'treinamento', 'integracao']);
    expect(validarConjunto(manifestos)).toEqual([]);
    expect(ordenarPorDependencia(manifestos)[0]!.id).toBe('core');
  });

  it('todo evento consumido é publicado por algum módulo', () => {
    const publicados = new Set(manifestos.flatMap((m) => m.publica));
    const orfaos = manifestos.flatMap((m) => m.consome.filter((e) => !publicados.has(e)).map((e) => `${m.id} ← ${e}`));
    expect(orfaos).toEqual([]);
  });

  it('cenário: tenant com core + vendedor + gestor; supervisor com perfil gestor', () => {
    expect(modulosEfetivos({ manifestos, ativosNoTenant: ['vendedor', 'gestor'], doPerfil: ['gestor'] })).toEqual(['core', 'gestor']);
  });

  it('RN-CORE-03 / ADR 0005: sem o Catálogo o Vendedor não fica efetivo; com ele, entra depois do Catálogo', () => {
    expect(modulosEfetivos({ manifestos, ativosNoTenant: ['vendedor'], doPerfil: ['catalogo', 'vendedor'] })).toEqual(['core']);
    expect(modulosEfetivos({ manifestos, ativosNoTenant: ['catalogo', 'vendedor'], doPerfil: ['catalogo', 'vendedor'] })).toEqual(['core', 'catalogo', 'vendedor']);
  });

  it('vendedor.pedido.faturado@1: o Vendedor publica a partir do retorno do ERP e o Treinamento consome (desenho T-0011)', () => {
    const porId = new Map(manifestos.map((m) => [m.id, m]));
    expect(porId.get('vendedor')!.publica).toContain('vendedor.pedido.faturado@1');
    expect(porId.get('vendedor')!.consome).toContain('integracao.pedido.retorno_erp@1');
    expect(porId.get('treinamento')!.consome).toContain('vendedor.pedido.faturado@1');
  });
});
