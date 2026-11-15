/**
 * T-0181 (spec docs/design/carga-aviso-frases/spec.md §1 item 5; ajuste R-20261115-080500): aviso da tela de carga, acima da
 * linha da barra (o espaço é da `TelaEntrada`). Medidas em `MEDIDAS_FRASE_CARGA.aviso` (spec §1). Só durante a carga (estados 4
 * e 5); no erro sai (quem decide é a `TelaCarga`). Sem destaque: regular, à esquerda, sem caixa, sem borda, sem negrito, sem
 * ícone. Nunca cortado: com fonte grande quebra (`linhasDoAviso`, que a altura conta). Lido uma vez, na ordem da tela, antes da barra (não é região viva).
 */
import { fonts, temaDaEntrada } from '@macuxi/ui/mobile';
import { MEDIDAS_FRASE_CARGA } from '@macuxi/ui/mobile/puro';
import { StyleSheet, Text } from 'react-native';

import type { Variante } from '@/lib/variante-tipo';

export const TEXTO_AVISO_CARGA = 'Baixando os dados do servidor. Não desligue.';

export function AvisoCarga({ variante }: { variante: Variante }) {
  const tema = temaDaEntrada(variante);
  return (
    <Text testID="carga-aviso" style={[styles.aviso, { color: tema.textoClaro }]}>
      {TEXTO_AVISO_CARGA}
    </Text>
  );
}

const { aviso } = MEDIDAS_FRASE_CARGA;
const styles = StyleSheet.create({
  aviso: { fontFamily: fonts[aviso.fonte], fontSize: aviso.tamanho, lineHeight: aviso.linha, textAlign: 'left' },
});
