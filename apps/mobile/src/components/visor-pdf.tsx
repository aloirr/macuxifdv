/**
 * Páginas do PDF no visor (T-0186, v1.0.16): o react-native-pdf desenha o temporário local (`fonteDoPdf`, sem o cache da
 * biblioteca), com rolagem e zoom dela. O topo, o carregando e as mensagens são os do visor de foto comum (`VisorDeFoto`);
 * o carregando da biblioteca troca o "0.00%" pelo mesmo indicador (MC-0159).
 */
import { colors } from '@macuxi/ui/mobile';
import { ActivityIndicator, StyleSheet } from 'react-native';
import Pdf from 'react-native-pdf';

import { fonteDoPdf } from '@/lib/visor-pdf';

export function PaginasDoPdf({ uri, aoFalhar }: { uri: string; aoFalhar: () => void }) {
  return (
    <Pdf
      source={fonteDoPdf(uri)}
      trustAllCerts={false}
      renderActivityIndicator={() => <ActivityIndicator color={colors.surface} />}
      style={s.pdf}
      onError={aoFalhar}
    />
  );
}

const s = StyleSheet.create({
  pdf: { flex: 1, width: '100%', backgroundColor: colors.ink },
});
