import { defineModule } from '@macuxi/platform-sdk';

export const manifest = defineModule({
  id: 'pesquisa',
  versao: '0.1.0',
  depende: ['core'],
  perfis: ['promotor', 'vendedor', 'supervisor', 'gerente', 'analista'],
  apps: { campo: { abas: ['Pesquisas'] }, gestao: { abas: ['Pesquisas'] }, web: { menus: ['Pesquisas'] } },
  sync: ['questionario', 'questionario_versao', 'pergunta', 'resposta_pesquisa'],
  publica: ['pesquisa.resposta.registrada@1'],
  consome: ['core.visita.checkout@1'],
  usaExtensoes: ['cliente.abas', 'visita.etapas_checkout'],
});

export default manifest;
