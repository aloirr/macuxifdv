import { defineModule } from '@macuxi/platform-sdk';

/**
 * Manifesto do módulo Core (fonte da verdade; modelo em platform-sdk/manifestos-referencia.test.ts).
 * Extensões oferecidas documentadas em contracts/extensoes.ts (a criar na etapa de contratos da API).
 */
export const manifest = defineModule({
  id: 'core',
  versao: '0.1.0',
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'],
  apps: {
    campo: { abas: ['Início', 'Rota', 'Clientes', 'Performance'] },
    gestao: { abas: ['Início', 'Clientes'] },
    web: { menus: ['Clientes', 'Rotas', 'Visitas', 'Coordenadas sugeridas', 'Motivos', 'Preço e custo', 'Recados', 'Carteira', 'Metas', 'Plano de RV', 'Perfis de acesso', 'Usuários', 'Aparelhos', 'Filiais', 'Fotos do PDV', 'Indicadores', 'Tarefas'] },
  },
  sync: ['cliente', 'cliente_contato', 'carteira', 'cliente_financeiro', 'titulo', 'historico_compra', 'rota', 'rota_parada', 'visita', 'visita_checkout', 'visita_etapa', 'motivo', 'parametro', 'meta', 'indicador_diario', 'notificacao', 'notificacao_leitura', 'produto', 'produto_unidade', 'medida', 'cliente_endereco', 'filial', 'foto_tipo', 'cliente_foto', 'usuario', 'cliente_visita_resumo', 'tarefa', 'tarefa_conclusao', 'frase_dia', 'usuario_avatar', 'meta_produtividade', 'deslocamento_dia'],
  publica: ['core.cliente.atualizado@1', 'core.visita.checkin@1', 'core.visita.checkout@1', 'core.usuario.modulos_alterados@1', 'core.notificacao.criada@1', 'core.meta.definida@1', 'core.tarefa.criada@1', 'core.tarefa.concluida@1', 'core.tarefa.cancelada@1'],
  consome: ['core.notificacao.criada@1', 'core.meta.definida@1', 'vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'vendedor.pedido.aprovacao_solicitada@1', 'treinamento.medalha.conquistada@1', 'integracao.cliente.atualizado@1', 'integracao.filial.atualizado@1', 'integracao.produto.atualizado@1', 'integracao.vendedor.atualizado@1', 'integracao.titulo.atualizado@1', 'integracao.nota.atualizado@1', 'integracao.rota.atualizado@1', 'integracao.produto_unidade.atualizado@1', 'integracao.cliente_endereco.atualizado@1', 'pesquisa.resposta.registrada@1'],
  acoes: {
    // Equivalem a canEditRoutes / canManagePeriod / canEditParams da Fase M (web/lib/rules.ts); a API revalida (RN-CORE-04).
    'rota.editar': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Montar e alterar a rota da semana (BKO)' },
    'meta.ver': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Ver metas e indicadores do próprio escopo (RF-CORE-08)' },
    'meta.editar': { perfis: ['supervisor', 'gerente', 'analista', 'admin'], descricao: 'Definir a meta mensal de um usuário do escopo; publica core.meta.definida@1 (RN-CORE-20)' },
    'meta.fechar_periodo': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Fechar/reabrir o mês e exportar para o RH' },
    'modulo.gerir_licencas': { perfis: ['admin'], descricao: 'Ativar/desativar módulos por tenant, perfil e usuário (tela Usuários e módulos)' },
    'usuario.ver': { perfis: ['gerente', 'admin'], descricao: 'Ver a lista de usuários no BKO, recortada pelo escopo: equipes abaixo (gerente), tenant (admin); o supervisor não usa o BKO (RF-CORE-02, RN-CORE-04, RN-CORE-33)' },
    'cliente.pagamento_editar': { perfis: ['analista', 'admin'], descricao: 'Editar no cliente o prazo médio máximo e as formas de pagamento permitidas (RN-VEN-25); auditado (BKO)' },
    'carteira.editar': { perfis: ['analista', 'admin'], descricao: 'Vincular/desvincular clientes a vendedor ou promotor, com vigência e frequência de visita (BKO)' },
    'dispositivo.bloquear': { perfis: ['admin', 'analista'], descricao: 'Bloquear/desbloquear aparelho no BKO; vale para o tenant inteiro (RN-CORE-15)' },
    'motivo.editar': { perfis: ['analista', 'admin'], descricao: 'Cadastrar e ativar/desativar motivos de não venda; motivos de sistema não mudam (RN-CORE-14)' },
    'produto.editar_preco': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Ver custo e editar custo, preço de venda e desconto máximo do produto no BKO; o custo nunca vai ao app (RN-CORE-18)' },
    'produto.parametros': { perfis: ['analista', 'admin'], descricao: 'Definir o desconto máximo padrão do produto do tenant, parâmetro desconto_maximo_produto_pct (RN-VEN-11)' },
    'cliente_foto.ver': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Ver o resumo tem/falta das fotos do PDV do cliente da própria carteira; o arquivo de documento sensível só abre para admin, analista, gerente e supervisor (RN-CORE-38)' },
    'cliente_foto.enviar': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'], descricao: 'Enviar a foto do PDV que falta (câmera ou galeria) pelo aparelho; vendedor e promotor só o que falta, supervisor, analista e admin também substituem (RN-CORE-38)' },
    'foto_tipo.editar': { perfis: ['admin'], descricao: 'Cadastrar, editar, inativar e apagar os tipos de foto do PDV (fachada, CNH, contrato social) e dizer quais são obrigatórios e sensíveis; auditado (RN-CORE-38)' },
    'filial.ver': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Ver as filiais do tenant e a filial do cliente (RN-CORE-39); o promotor só lê' },
    'filial.editar': { perfis: ['analista', 'admin'], descricao: 'Cadastrar, editar, inativar e apagar filiais e marcar a filial padrão, em Cadastros › Filiais; auditado (RN-CORE-39)' },
    'cliente.filial_editar': { perfis: ['analista', 'admin'], descricao: 'Trocar no BKO a filial de cliente que não veio do ERP; cliente do ERP recusa com 422 (RN-CORE-39); auditado' },
    'medida.gerenciar': { perfis: ['analista', 'admin'], descricao: 'Cadastrar, editar, inativar e apagar (só sem uso) medidas do tenant e definir a medida da unidade e a embalagem do produto, em Parâmetros → Produtos (RN-CORE-19)' },
    'parametro.promotor_ve_pedidos': { perfis: ['admin'], descricao: 'Ligar/desligar a leitura de pedidos pelo perfil Promotor no tenant, parâmetro promotor_ve_pedidos (padrão ligado; RN-CORE-01, RN-PRO-01). A escrita de pedido pelo promotor segue sempre negada' },
    'cliente.aprovar_coordenada': { perfis: ['analista', 'admin'], descricao: 'Aprovar a coordenada sugerida no 1º check-in de cliente sem coordenada (RN-CORE-10)' },
    'notificacao.enviar': { perfis: ['supervisor', 'gerente', 'analista', 'admin'], descricao: 'Enviar recado a usuários do próprio escopo (RF-CORE-09)' },
    'notificacao.ler': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Marcar como lida uma notificação própria (RF-CORE-09)' },
    'dispositivo.registrar_push': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Gravar o token de push do próprio aparelho (RF-CORE-09)' },
    'inicio.ver': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente'], descricao: 'Ver o Início de boas-vindas: meta do dia, recado do dia, rota e equipe agora; analista e admin não têm Início (RN-CORE-26)' },
    'notificacao.recado_do_dia': { perfis: ['supervisor', 'gerente'], descricao: 'Marcar/desmarcar um recado enviado como recado do dia de hoje para a equipe destinatária do próprio escopo (RN-CORE-26)' },
    'farol.ver': { perfis: ['supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Ver o farol de clientes no BKO (dias sem compra e positivação do mês), recortado pelo escopo: equipe (supervisor), equipes abaixo (gerente), tenant (analista, assistente, admin) (RN-CORE-28)' },
    'parametro.farol': { perfis: ['analista', 'admin'], descricao: 'Editar os parâmetros do farol de clientes: farol.verde_ate_dias, farol.amarelo_ate_dias, farol.positivacao_verde_pct e farol.positivacao_amarelo_pct (RN-CORE-28)' },
    'parametro.inicio': { perfis: ['analista', 'admin'], descricao: 'Editar os parâmetros do Início: metas.dias_uteis_semana e inicio.parado_min (RN-CORE-26)' },
    'parametro.curva_abc': { perfis: ['analista', 'admin'], descricao: 'Editar as faixas das curvas ABC do cliente (faturamento, volume e frequência): cliente.curva_abc.<dimensão> com a_min_pct e b_min_pct (RN-CORE-49)' },
    'visita.checkin_fora_de_rota': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Fazer check-in em cliente da carteira que não está na rota do dia; sem a ação, só check-in nos clientes da rota. Padrão ligado em todos os perfis (preserva o comportamento anterior); o BKO desliga por perfil de acesso (RN-CORE-52)' },
    'visita.dispensar_etapa': { perfis: ['supervisor', 'admin'], descricao: 'Dispensar à mão, com justificativa, a etapa pendente de uma visita da própria equipe (supervisor) ou do tenant (admin); auditado (RN-CORE-12, T-0039 §2.5a)' },
    'parametro.checkout_pendencia': { perfis: ['admin'], descricao: 'Editar o prazo do alerta de etapa pendente do checkout, parâmetro checkout_pendencia_alerta_h, 1 a 168 h (padrão 24; RN-CORE-12)' },
    'plano_rv.editar': { perfis: ['analista', 'admin'], descricao: 'Criar, editar e excluir o plano de RV e a vigência; plano que já valeu para mês fechado não muda; auditado (RN-CORE-30, RN-AUD-01)' },
    'plano_rv.ver': { perfis: ['supervisor', 'gerente', 'analista', 'admin'], descricao: 'Ver o plano de RV vigente e as versões (RN-CORE-30)' },
    // T-0170: tarefas do consultor (desenho tarefas-consultor.md), frase do dia (RN-CORE-41), foto ou avatar (RN-CORE-42) e metas de produtividade (RN-CORE-45)
    'tarefa.criar': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Criar tarefa para usuários do escopo no BKO; publica core.tarefa.criada@1' },
    'tarefa.editar': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Editar o prazo e a descrição de tarefa aberta; auditado (RN-AUD-01)' },
    'tarefa.cancelar': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Cancelar tarefa; publica core.tarefa.cancelada@1; auditado' },
    'tarefa.acompanhar': { perfis: ['gerente', 'analista', 'assistente', 'admin'], descricao: 'Acompanhar no BKO as tarefas do escopo e a situação de cada destinatário' },
    'tarefa.concluir': { perfis: ['vendedor', 'promotor'], descricao: 'Concluir no app a própria tarefa (push tarefa_conclusao); publica core.tarefa.concluida@1' },
    'frase_dia.editar': { perfis: ['analista', 'admin'], descricao: 'Criar, editar, ordenar e remover as frases do dia do tenant (RN-CORE-41); auditado' },
    'usuario_avatar.trocar': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Trocar a própria foto ou avatar no app (push usuario_avatar; RN-CORE-42)' },
    'usuario_avatar.trocar_outro': { perfis: ['admin'], descricao: 'Trocar no BKO a foto ou o avatar de outro usuário do tenant (RN-CORE-42); auditado' },
    'meta_produtividade.editar': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Definir as metas de produtividade por tenant, equipe ou usuário, com vigência (RN-CORE-45); auditado' },
    'rv.ver': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'], descricao: 'Ver a RV calculada, recortada pelo escopo: a própria (vendedor, promotor), equipe (supervisor), equipes abaixo (gerente), tenant (analista, admin); o assistente não vê (RN-CORE-29/30; T-0082 app)' },
  },
  // ADR 0019: consulta opcional não cria aresta de dependência (sem ciclo core ↔ vendedor); sem o dono, cai no indicador_diario
  usaConsultasOpcionais: ['vendedor.pedidos_da_meta@1', 'pesquisa.etapas_checkout@1', 'vendedor.formas_pagamento@1'],
  // 'pesquisa.questionarios_para_tarefa@1' entra junto com o ofereceConsultas da Pesquisa (pedido ao modulo-pesquisa, T-0170)
  ofereceConsultas: ['core.cadastro_resumo@1', 'core.financeiro_cliente@1', 'core.cadastro_cliente@1', 'core.medidas@1', 'core.promotor_ve_pedidos@1', 'core.usuarios_resumo@1', 'core.calendario_metas@1', 'core.filiais@1'],
  ofereceExtensoes: ['cliente.abas', 'cliente.acoes', 'cliente.avisos', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'],
});
