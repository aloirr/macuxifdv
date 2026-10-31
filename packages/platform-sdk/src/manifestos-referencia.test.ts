/**
 * Manifestos de REFERÊNCIA dos 8 módulos (desenho T-0001, a partir de .coord/contratos/*.md e do doc 04).
 * Servem de modelo para os agentes de módulo e provam que o conjunto é consistente (dependências,
 * extensões oferecidas × usadas, sem ciclo). A fonte da verdade passa a ser `modules/<m>/manifest.ts`.
 */
import { describe, expect, it } from 'vitest';
import { defineModule, ordenarPorDependencia, validarConjunto, type ManifestoEntrada } from './manifesto';
import { modulosEfetivos } from './modulos-efetivos';

export const REFERENCIA: ManifestoEntrada[] = [
  {
    id: 'core',
    versao: '0.1.0',
    perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
    apps: { campo: { abas: ['Início', 'Rota', 'Clientes'] }, gestao: { abas: ['Início', 'Clientes'] }, web: { menus: ['Clientes', 'Rotas', 'Metas', 'Usuários e módulos'] } },
    sync: ['cliente', 'cliente_contato', 'carteira', 'cliente_financeiro', 'titulo', 'historico_compra', 'rota', 'rota_parada', 'visita', 'visita_etapa', 'motivo', 'meta', 'indicador_diario', 'notificacao'],
    publica: ['core.cliente.atualizado@1', 'core.visita.checkin@1', 'core.visita.checkout@1', 'core.usuario.modulos_alterados@1'],
    consome: ['vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'treinamento.medalha.conquistada@1', 'integracao.cliente.atualizado@1'],
    ofereceExtensoes: ['cliente.abas', 'cliente.acoes', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'],
  },
  {
    id: 'catalogo',
    versao: '0.1.0',
    depende: ['core'],
    perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista'],
    apps: { campo: { abas: ['Catálogo'] }, gestao: { abas: ['Catálogo'] }, web: { menus: ['Catálogo'] } },
    sync: ['produto', 'categoria', 'marca', 'produto_atributo', 'produto_midia', 'produto_conteudo', 'sinonimo', 'tabela_preco', 'tabela_preco_item', 'deposito', 'estoque_saldo'],
    publica: ['catalogo.produto.visualizado@1', 'catalogo.busca.realizada@1'],
    consome: ['integracao.produto.atualizado@1', 'integracao.estoque.atualizado@1', 'integracao.preco.atualizado@1', 'catalogo.busca.realizada@1'],
    ofereceExtensoes: ['produto.acoes'],
  },
  {
    id: 'vendedor',
    versao: '0.1.0',
    depende: ['core'],
    opcionais: ['catalogo'],
    perfis: ['vendedor', 'analista', 'assistente'],
    apps: { campo: { abas: ['Pedidos'] }, web: { menus: ['Pedidos', 'Alçadas'] } },
    sync: ['pedido', 'pedido_item', 'pedido_evento', 'condicao_pagamento', 'cliente_condicao', 'alerta_ruptura'],
    // vendedor.pedido.faturado@1: decisão T-0004 (registro em .coord/contratos/eventos.md); entra no manifesto real depois da T-0007
    publica: ['vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'vendedor.pedido.aprovacao_solicitada@1', 'vendedor.pedido.faturado@1'],
    consome: ['promotor.ruptura.registrada@1', 'integracao.pedido.retorno_erp@1'],
    ofereceExtensoes: ['pedido.criar_em_nome'],
    usaExtensoes: ['produto.acoes', 'cliente.abas', 'cliente.acoes', 'visita.etapas_checkout', 'inicio.cards'],
  },
  {
    id: 'promotor',
    versao: '0.1.0',
    depende: ['core'],
    opcionais: ['catalogo', 'pesquisa', 'vendedor'],
    // admin: cadastros de trade no BKO (doc 03 §2; T-0010, ADR 0004)
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
    id: 'pesquisa',
    versao: '0.1.0',
    depende: ['core'],
    perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista'],
    apps: { campo: { abas: ['Pesquisas'] }, gestao: { abas: ['Pesquisas'] }, web: { menus: ['Pesquisas'] } },
    sync: ['questionario', 'questionario_versao', 'pergunta', 'opcao', 'regra_condicional', 'resposta'],
    publica: ['pesquisa.resposta.registrada@1'],
    consome: ['core.visita.checkin@1'],
    usaExtensoes: ['visita.etapas_checkout', 'cliente.abas'],
  },
  {
    // Espelho de modules/treinamento/manifest.ts (T-0011; atualizado na T-0004): admin + ações do aluno, da gestão e do BKO.
    // consome: `vendedor.pedido.faturado@1` (decisão T-0004, R-20261031-103502 item 10: o desafio paga no FATURADO);
    // o manifesto real troca `vendedor.pedido.criado@1` por ele quando o Vendedor publicar o evento (pedido ao modulo-treinamento).
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
      'trilha.baixar_offline': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente'] },
      'licao.concluir': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente'] },
      'quiz.responder': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente'] },
      'ranking.ver': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'] },
      'adesao.ver': { perfis: ['supervisor', 'gerente', 'analista', 'admin'] },
      'notas.ver': { perfis: ['supervisor', 'gerente', 'analista', 'admin'] },
      'trilha.criar': { perfis: ['analista', 'admin'] },
      'trilha.editar': { perfis: ['analista', 'admin'] },
      'trilha.publicar': { perfis: ['analista', 'admin'] },
      'quiz.gerenciar': { perfis: ['analista', 'admin'] },
      'desafio.gerenciar': { perfis: ['analista', 'admin'] },
      'medalha.gerenciar': { perfis: ['analista', 'admin'] },
    },
  },
  {
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
      'integracao.pedido.retorno_erp@1',
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
});
