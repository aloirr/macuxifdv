/**
 * Folha de opções (R-20261124-114951, RN-VEN-38 e RN-VEN-48): uma lista de linhas de toque ≥ 48 dp, usada na escolha do Salvar
 * (Orçamento ou Pedido) e nas Ações de cada item da aba Pedidos. Só desenha: quem decide o que aparece é o domain.
 */
import { colors, Folha, Pressionavel, type as t } from '@macuxi/ui/mobile';
import { StyleSheet, Text, View } from 'react-native';

export interface OpcaoDaFolha {
  id: string;
  rotulo: string;
  /** ação destrutiva (Excluir) */
  perigo?: boolean;
  testID?: string;
}

export function FolhaDeOpcoes({ visivel, titulo, opcoes, onEscolher, onFechar, rotuloFechar = 'Fechar', testID }: { visivel: boolean; titulo: string; opcoes: readonly OpcaoDaFolha[]; onEscolher: (id: string) => void; onFechar: () => void; rotuloFechar?: string; testID: string }) {
  return (
    <Folha visivel={visivel} onFechar={onFechar} rotuloFechar={rotuloFechar} titulo={titulo} fechar={{ rotulo: rotuloFechar, testID: `${testID}-fechar` }} testID={testID}>
      <View>
        {opcoes.map((o, i) => (
          <Pressionavel
            key={o.id}
            testID={o.testID ?? `${testID}-${o.id}`}
            accessibilityRole="button"
            accessibilityLabel={o.rotulo}
            onPress={() => onEscolher(o.id)}
            style={[s.linha, i > 0 && s.traco]}>
            <Text style={[t.bodyStrong, o.perigo && { color: colors.danger }]}>{o.rotulo}</Text>
          </Pressionavel>
        ))}
      </View>
    </Folha>
  );
}

const s = StyleSheet.create({
  linha: { minHeight: 52, justifyContent: 'center', paddingHorizontal: 4 },
  traco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
});
