/**
 * RN-VEN-38 (T-0128): peças da saída do Novo pedido. A folha "Sair do pedido?" é a do kit (`FolhaSairDoFormulario`); aqui só
 * entram os textos do domain; o Voltar do cabeçalho (`aoVoltar` do `CabecalhoTela`) chama a folha antes de sair.
 */
import { FolhaSairDoFormulario } from '@macuxi/ui/mobile';

import { TEXTOS_DA_SAIDA, TITULO_SAIR_DO_PEDIDO, type OpcoesDaSaida, opcoesDaSaidaEdicao } from '../../domain/sair-do-pedido';

export function FolhaSaidaDoPedido({ visivel, opcoes, edicao, onAcao }: { visivel: boolean; opcoes: OpcoesDaSaida; edicao?: ReturnType<typeof opcoesDaSaidaEdicao> | null; onAcao: (acao: 'salvar' | 'apenas_salvar' | 'salvar_alternativo' | 'descartar' | 'continuar') => void }) {
  // v1.0.1: na edição de pedido salvo a folha só oferece salvar as alterações e descartar as alterações
  if (edicao) {
    return (
      <FolhaSairDoFormulario
        visivel={visivel}
        titulo={TITULO_SAIR_DO_PEDIDO}
        salvar={{ ...edicao.salvar, testID: 'sair-salvar' }}
        descartar={{ ...edicao.descartar, testID: 'sair-descartar', confirmacao: edicao.confirmacao }}
        continuar={TEXTOS_DA_SAIDA.continuar}
        onAcao={onAcao}
        testID="folha-sair"
      />
    );
  }
  return (
    <FolhaSairDoFormulario
      visivel={visivel}
      titulo={TITULO_SAIR_DO_PEDIDO}
      salvar={opcoes.salvar ? { ...TEXTOS_DA_SAIDA.salvar, testID: 'sair-salvar' } : undefined}
      apenasSalvar={opcoes.apenasSalvar ? { ...TEXTOS_DA_SAIDA.apenasSalvar, testID: 'sair-apenas-salvar' } : undefined}
      salvarAlternativo={opcoes.orcamento ? { rotulo: TEXTOS_DA_SAIDA.orcamento.rotulo, testID: 'sair-orcamento' } : undefined}
      descartar={{ ...TEXTOS_DA_SAIDA.descartar, testID: 'sair-descartar', confirmacao: TEXTOS_DA_SAIDA.confirmacao }}
      continuar={TEXTOS_DA_SAIDA.continuar}
      onAcao={onAcao}
      testID="folha-sair"
    />
  );
}
