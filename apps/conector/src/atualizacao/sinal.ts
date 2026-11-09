/**
 * Resultado da atualização automática no sinal de vida (T-0100 item 3): converte o `ResultadoAtualizacao` local no resumo aditivo
 * `SinalConector.atualizacao` do contrato (aprovado em R-20261109-003706). Só códigos, versões e o texto curto que o Conector já
 * mostra no `status`; nunca URL do pacote, caminho de pasta, usuário nem exceção crua (o schema local já proíbe).
 */
import type { AtualizacaoConector } from '@macuxi/integracao/contracts';
import type { ResultadoAtualizacao } from './resultado';

export function atualizacaoParaSinal(r: ResultadoAtualizacao | null): AtualizacaoConector | null {
  if (!r) return null;
  switch (r.resultado) {
    case 'atualizado':
      return { resultado: 'atualizado', codigo: null, versao_de: r.de, versao_para: r.para, em: r.em, mensagem: r.mensagem };
    case 'mantido':
      return { resultado: 'mantido', codigo: r.motivo, versao_de: r.versao, versao_para: r.oferecida, em: r.em, mensagem: r.mensagem };
    case 'revertido':
      return { resultado: 'revertido', codigo: r.motivo, versao_de: r.de, versao_para: r.tentou, em: r.em, mensagem: r.mensagem };
  }
}
