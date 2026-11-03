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
    web: { menus: ['Clientes', 'Rotas', 'Visitas', 'Coordenadas sugeridas', 'Motivos', 'Produtos', 'Recados', 'Carteira', 'Metas', 'Plano de RV', 'Usuários e módulos', 'Aparelhos', 'Indicadores'] },
  },
  sync: ['cliente', 'cliente_contato', 'carteira', 'cliente_financeiro', 'titulo', 'historico_compra', 'rota', 'rota_parada', 'visita', 'visita_checkout', 'visita_etapa', 'motivo', 'parametro', 'meta', 'indicador_diario', 'notificacao', 'notificacao_leitura', 'produto', 'produto_unidade', 'cliente_endereco'],
  publica: ['core.cliente.atualizado@1', 'core.visita.checkin@1', 'core.visita.checkout@1', 'core.usuario.modulos_alterados@1', 'core.notificacao.criada@1', 'core.meta.definida@1'],
  consome: ['core.notificacao.criada@1', 'core.meta.definida@1', 'vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'vendedor.pedido.aprovacao_solicitada@1', 'treinamento.medalha.conquistada@1', 'integracao.cliente.atualizado@1', 'integracao.produto.atualizado@1', 'integracao.vendedor.atualizado@1', 'integracao.titulo.atualizado@1', 'integracao.nota.atualizado@1', 'integracao.rota.atualizado@1', 'integracao.produto_unidade.atualizado@1', 'integracao.cliente_endereco.atualizado@1'],
  acoes: {
    // Equivalem a canEditRoutes / canManagePeriod / canEditParams da Fase M (web/lib/rules.ts); a API revalida (RN-CORE-04).
    'rota.editar': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Montar e alterar a rota da semana (BKO)' },
    'meta.ver': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Ver metas e indicadores do próprio escopo (RF-CORE-08)' },
    'meta.editar': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Definir a meta mensal de um usuário do escopo; publica core.meta.definida@1 (RN-CORE-20)' },
    'meta.fechar_periodo': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Fechar/reabrir o mês e exportar para o RH' },
    'modulo.gerir_licencas': { perfis: ['admin'], descricao: 'Ativar/desativar módulos por tenant, perfil e usuário (tela Usuários e módulos)' },
    'carteira.editar': { perfis: ['analista', 'admin'], descricao: 'Vincular/desvincular clientes a vendedor ou promotor, com vigência e frequência de visita (BKO)' },
    'dispositivo.bloquear': { perfis: ['admin', 'analista'], descricao: 'Bloquear/desbloquear aparelho no BKO; vale para o tenant inteiro (RN-CORE-15)' },
    'motivo.editar': { perfis: ['analista', 'admin'], descricao: 'Cadastrar e ativar/desativar motivos de não venda; motivos de sistema não mudam (RN-CORE-14)' },
    'produto.editar_preco': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Ver custo e editar custo, preço de venda e desconto máximo do produto no BKO; o custo nunca vai ao app (RN-CORE-18)' },
    'produto.parametros': { perfis: ['analista', 'admin'], descricao: 'Definir o desconto máximo padrão do produto do tenant, parâmetro desconto_maximo_produto_pct (RN-VEN-11)' },
    'parametro.promotor_ve_pedidos': { perfis: ['admin'], descricao: 'Ligar/desligar a leitura de pedidos pelo perfil Promotor no tenant, parâmetro promotor_ve_pedidos (padrão ligado; RN-CORE-01, RN-PRO-01). A escrita de pedido pelo promotor segue sempre negada' },
    'cliente.aprovar_coordenada': { perfis: ['analista', 'admin'], descricao: 'Aprovar a coordenada sugerida no 1º check-in de cliente sem coordenada (RN-CORE-10)' },
    'notificacao.enviar': { perfis: ['supervisor', 'gerente', 'analista', 'admin'], descricao: 'Enviar recado a usuários do próprio escopo (RF-CORE-09)' },
    'notificacao.ler': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Marcar como lida uma notificação própria (RF-CORE-09)' },
    'dispositivo.registrar_push': { perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista', 'assistente', 'admin'], descricao: 'Gravar o token de push do próprio aparelho (RF-CORE-09)' },
    'plano_rv.editar': { perfis: ['analista'], descricao: 'Editar o plano de RV (vigência futura)' },
  },
  // Vendedor é opcional (ADR 0012): sem ele a meta cai no read-model indicador_diario.
  opcionais: ['vendedor'],
  usaConsultas: ['vendedor.pedidos_da_meta@1'],
  ofereceConsultas: ['core.cadastro_resumo@1', 'core.cadastro_cliente@1', 'core.promotor_ve_pedidos@1'],
  ofereceExtensoes: ['cliente.abas', 'cliente.acoes', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'],
});
