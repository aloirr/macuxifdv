import { defineModule } from '@macuxi/platform-sdk';

// RN-PRO-01: o promotor nunca cria/edita/exclui pedido; este manifesto não declara nenhuma ação de pedido.
export const manifest = defineModule({
  id: 'promotor',
  versao: '0.1.0',
  depende: ['core'],
  opcionais: ['catalogo', 'pesquisa', 'vendedor'],
  perfis: ['promotor', 'supervisor', 'gerente', 'analista'],
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
});

export default manifest;
