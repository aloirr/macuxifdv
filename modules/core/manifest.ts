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
    web: { menus: ['Clientes', 'Rotas', 'Metas', 'Plano de RV', 'Usuários e módulos'] },
  },
  sync: ['cliente', 'cliente_contato', 'carteira', 'cliente_financeiro', 'titulo', 'historico_compra', 'rota', 'rota_parada', 'visita', 'visita_etapa', 'motivo', 'meta', 'indicador_diario', 'notificacao'],
  publica: ['core.cliente.atualizado@1', 'core.visita.checkin@1', 'core.visita.checkout@1', 'core.usuario.modulos_alterados@1'],
  consome: ['vendedor.pedido.criado@1', 'vendedor.pedido.status_alterado@1', 'treinamento.medalha.conquistada@1', 'integracao.cliente.atualizado@1'],
  acoes: {
    // Equivalem a canEditRoutes / canManagePeriod / canEditParams da Fase M (web/lib/rules.ts); a API revalida (RN-CORE-04).
    'rota.editar': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Montar e alterar a rota da semana (BKO)' },
    'meta.fechar_periodo': { perfis: ['gerente', 'analista', 'admin'], descricao: 'Fechar/reabrir o mês e exportar para o RH' },
    'plano_rv.editar': { perfis: ['analista'], descricao: 'Editar o plano de RV (vigência futura)' },
  },
  ofereceExtensoes: ['cliente.abas', 'cliente.acoes', 'visita.etapas_checkout', 'inicio.cards', 'menu.itens'],
});
