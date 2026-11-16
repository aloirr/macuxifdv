/**
 * Faixa do login (T-0172; quadro 3 de docs/marca/propostas/2026-11-12-entrada-sync/entrada-sync.png; manual da marca:
 * "Login, splash e portal: o logo negativo fica na faixa Azul noite, e o formulário fica no Pérola"). Faixa Azul noite
 * de largura total no topo, cobrindo também a barra de status (`useCorDaFaixa`), com o logo horizontal negativo à
 * esquerda. O formulário segue embaixo, no fundo Pérola do app.
 */
import { colors } from '@macuxi/ui/mobile';
import { StatusBar } from 'expo-status-bar';
import { StyleSheet, View } from 'react-native';
import { SvgXml } from 'react-native-svg';

import { useCorDaFaixa } from '@/components/area-segura';
import { LOGO_HORIZONTAL_NEGATIVO, PROPORCAO_LOGO_HORIZONTAL, svgParaDesenho } from '@/lib/logo-marca';

/** Altura do logo na faixa (dp); a largura sai da proporção do viewBox. */
const ALTURA_LOGO = 44;

export function FaixaDoLogin() {
  useCorDaFaixa(colors.accent);
  return (
    <View style={styles.faixa}>
      <StatusBar style="light" />
      <View testID="login.faixa" accessible accessibilityRole="image" accessibilityLabel="Macuxi Força de Vendas">
        <SvgXml xml={svgParaDesenho(LOGO_HORIZONTAL_NEGATIVO)} width={Math.round(ALTURA_LOGO * PROPORCAO_LOGO_HORIZONTAL)} height={ALTURA_LOGO} />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  faixa: { alignSelf: 'stretch', backgroundColor: colors.accent, paddingHorizontal: 24, paddingVertical: 26, alignItems: 'flex-start' },
});
