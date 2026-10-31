import { defineModule } from '@macuxi/platform-sdk';

export const manifest = defineModule({
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
  // Pedido em nome: extensão opcional do Vendedor; some sem erro se o Vendedor estiver inativo.
  usaExtensoes: ['pedido.criar_em_nome', 'cliente.abas', 'inicio.cards'],
});

export default manifest;
