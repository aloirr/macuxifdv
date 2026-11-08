/**
 * RN-VEN-38 (T-0128): peças da saída do Novo pedido. A folha "Sair do pedido?" é a do kit (`FolhaSairDoFormulario`); aqui só
 * entram os textos do domain e o Voltar do cabeçalho, que precisa passar pela folha antes de sair.
 */
import { colors, FolhaSairDoFormulario, fonts, Icon, Pressionavel } from '@macuxi/ui/mobile';
import { StyleSheet, Text } from 'react-native';

import { TEXTOS_DA_SAIDA, TITULO_SAIR_DO_PEDIDO, type OpcoesDaSaida } from '../../domain/sair-do-pedido';

export function FolhaSaidaDoPedido({ visivel, opcoes, onAcao }: { visivel: boolean; opcoes: OpcoesDaSaida; onAcao: (acao: 'salvar' | 'apenas_salvar' | 'salvar_alternativo' | 'descartar' | 'continuar') => void }) {
  return (
    <FolhaSairDoFormulario
      visivel={visivel}
      titulo={TITULO_SAIR_DO_PEDIDO}
      aviso={opcoes.aviso ?? undefined}
      salvar={opcoes.salvar ? { ...TEXTOS_DA_SAIDA.salvar, testID: 'sair-salvar' } : undefined}
      apenasSalvar={opcoes.apenasSalvar ? { ...TEXTOS_DA_SAIDA.apenasSalvar, testID: 'sair-apenas-salvar' } : undefined}
      salvarAlternativo={opcoes.orcamento ? { rotulo: TEXTOS_DA_SAIDA.orcamento.rotulo, subtitulo: opcoes.subtituloOrcamento, testID: 'sair-orcamento' } : undefined}
      descartar={{ ...TEXTOS_DA_SAIDA.descartar, testID: 'sair-descartar', confirmacao: TEXTOS_DA_SAIDA.confirmacao }}
      continuar={TEXTOS_DA_SAIDA.continuar}
      onAcao={onAcao}
      testID="folha-sair"
    />
  );
}

/** Voltar do cabeçalho com a mesma aparência do `BackLink`, mas que passa pela folha de saída quando o pedido está alterado. */
export function VoltarDoFormulario({ rotulo, onPress }: { rotulo: string; onPress: () => void }) {
  return (
    <Pressionavel testID="voltar-formulario" accessibilityRole="link" accessibilityLabel={rotulo} onPress={onPress} escala={false} style={s.voltar}>
      <Icon name="back" size={18} color={colors.ink2} />
      <Text style={s.texto} numberOfLines={1}>
        {rotulo}
      </Text>
    </Pressionavel>
  );
}

const s = StyleSheet.create({
  voltar: { alignSelf: 'flex-start', height: 48, flexDirection: 'row', alignItems: 'center', gap: 4, maxWidth: '100%' },
  texto: { fontFamily: fonts.medium, fontSize: 14, color: colors.ink2 },
});
