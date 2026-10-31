import { defineModule } from '@macuxi/platform-sdk';

export const manifest = defineModule({
  id: 'treinamento',
  versao: '0.1.0',
  depende: ['core'],
  opcionais: ['vendedor'],
  perfis: ['vendedor', 'promotor', 'supervisor', 'gerente', 'analista'],
  apps: { campo: { abas: ['Treinar'] }, gestao: { abas: ['Treinar'] }, web: { menus: ['Trilhas'] } },
  sync: ['trilha', 'modulo_trilha', 'licao', 'quiz', 'questao', 'alternativa', 'progresso', 'tentativa', 'medalha'],
  publica: ['treinamento.licao.concluida@1', 'treinamento.medalha.conquistada@1'],
  consome: ['vendedor.pedido.criado@1'],
  usaExtensoes: ['inicio.cards'],
});

export default manifest;
