/** Estado de erro das consultas online (notas, NF e documentos): o texto e a ação seguinte, "Tentar de novo". */
import { Botao, Icon, colors, type as t } from '@macuxi/ui/mobile';
import { Text, View } from 'react-native';

import { FALHA_SEM_INTERNET, type FalhaOnline } from '../lib/ficha-online';

export function ErroOnline({ falha, titulo, onTentar, testID }: { falha: FalhaOnline | null; titulo: string; onTentar: () => void; testID?: string }) {
  return (
    <View style={{ gap: 10, alignItems: 'flex-start' }} testID={testID} accessibilityLiveRegion="polite">
      {falha?.semInternet !== false ? <Icon name="wifiOff" size={28} color={colors.ink2} /> : null}
      <Text style={t.bodyStrong}>{falha?.mensagem ?? FALHA_SEM_INTERNET.mensagem}</Text>
      {falha?.semInternet !== false ? <Botao rotulo="Tentar de novo" nivel="principal" onPress={onTentar} testID={`${testID ?? 'erro'}-tentar`} rotuloAcessivel={`Tentar de novo: ${titulo}`} /> : null}
    </View>
  );
}
