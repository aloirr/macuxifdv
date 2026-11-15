/**
 * T-0181 (spec docs/design/carga-aviso-frases/spec.md §1 item 5; ajuste R-20261115-080500): aviso da tela de carga, 10 dp
 * acima da linha da barra (o espaço é da `TelaEntrada`). Só durante a carga (estados 4 e 5); no erro sai (quem decide é a
 * `TelaCarga`). Sem destaque: fonte do sistema, regular, 14/20 em `textoClaro`, à esquerda, sem caixa, sem borda, sem negrito, sem
 * ícone. Nunca cortado: 1 linha na escala de fonte 1,0; com fonte grande quebra em 2 (`linhasDoAviso`, que a altura conta). Lido uma vez, na ordem da tela, antes da barra (não é região viva).
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
