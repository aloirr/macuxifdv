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
    campo: { abas: ['Início', 'Rota', 'Clientes', 'Metas'] },
    gestao: { abas: ['Início', 'Clientes'] },
    web: { menus: ['Clientes', 'Rotas', 'Visitas', 'Coordenadas sugeridas', 'Motivos', 'Produtos', 'Recados', 'Carteira', 'Metas', 'Plano de RV', 'Usuários e módulos', 'Usuários', 'Perfis de acesso', 'Aparelhos', 'Indicadores'] },
  },
  sync: ['cliente', 'cliente_contato', 'carteira', 'cliente_financeiro', 'titulo', 'historico_compra', 'rota', 'rota_parada', 'visita', 'visita_checkout', 'visita_etapa', 'motivo', 'parametro', 'meta', 'indicador_diario', 'notificacao', 'notificacao_leitura', 'produto', 'produto_unidade', 'medida', 'cliente_endereco'],
  publica: ['core.cliente.atualizado@1', 'core.visita.checkin@1', 'core.visita.checkout@1', 'core.usuario.modulos_alterados@1', 'core.notificacao.criada@1', 'core.meta.definida@1'],
  consome: ['core.notificacao.criada@1', 'core.meta.definida@1', 'vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'vendedor.pedido.aprovacao_solicitada@1', 'treinamento.medalha.conquistada@1', 'integracao.cliente.atualizado@1', 'integracao.produto.atualizado@1', 'integracao.vendedor.atualizado@1', 'integracao.titulo.atualizado@1', 'integracao.nota.atualizado@1', 'integracao.rota.atualizado@1', 'integracao.produto_unidade.atualizado@1', 'integracao.cliente_endereco.atualizado@1', 'pesquisa.resposta.registrada@1'],
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
    'parametro.inicio': { perfis: ['analista', 'admin'], descricao: 'Editar os parâmetros do Início: metas.dias_uteis_semana, inicio.recado_do_dia_padrao e inicio.parado_min (RN-CORE-26)' },
    'visita.dispensar_etapa': { perfis: ['supervisor', 'admin'], descricao: 'Dispensar à mão, com justificativa, a etapa pendente de uma visita da própria equipe (supervisor) ou do tenant (admin); auditado (RN-CORE-12, T-0039 §2.5a)' },
    'parametro.checkout_pendencia': { perfis: ['admin'], descricao: 'Editar o prazo do alerta de etapa pendente do checkout, parâmetro checkout_pendencia_alerta_h, 1 a 168 h (padrão 24; RN-CORE-12)' },
    'plano_rv.editar': { perfis: ['analista', 'admin'], descricao: 'Criar, editar e excluir o plano de RV e a vigência; plano que já valeu para mês fechado não muda; auditado (RN-CORE-30, RN-AUD-01)' },
    'plano_rv.ver': { perfis: ['supervisor', 'gerente', 'analista', 'admin'], descricao: 'Ver o plano de RV vigente e as versões (RN-CORE-30)' },
    'rv.ver': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'admin'], descricao: 'Ver a RV calculada, recortada pelo escopo: a própria (vendedor, promotor), equipe (supervisor), equipes abaixo (gerente), tenant (analista, admin); o assistente não vê (RN-CORE-29/30; T-0082 app)' },
  },
  // ADR 0019: consulta opcional não cria aresta de dependência (sem ciclo core ↔ vendedor); sem o dono, cai no indicador_diario
  usaConsultasOpcionais: ['vendedor.pedidos_da_meta@1', 'pesquisa.etapas_checkout@1', 'vendedor.formas_pagamento@1'],
  ofereceConsultas: ['core.cadastro_resumo@1', 'core.financeiro_cliente@1', 'core.cadastro_cliente@1', 'core.medidas@1', 'core.promotor_ve_pedidos@1', 'core.usuarios_resumo@1', 'core.calendario_metas@1'],
  ofereceExtensoes: ['cliente.abas', 'cliente.acoes', 'cliente.avisos', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'],
});
