/**
 * Rodapé legal da tela Entrar do Campo e da Gestão (docs/design/telas/rodape-legal.md §2; R-20261114-221000-alexandre):
 * até três linhas centralizadas (empresa, direitos, versão e site), `type.small` em `ink2`; o site é link sublinhado em
 * `accentInk` e abre no navegador do aparelho, com área de toque de 48 dp por `hitSlop`. As linhas vêm de
 * `linhasDoRodapeLegal` (pura); os dados, de `useDadosLegais` (cache + rota pública).
 * Pendência: a spec põe este componente no kit (`packages/ui/src/mobile/rodape-legal.tsx`, designer-ux).
 */
import { colors, fonts, Pressionavel } from '@macuxi/ui/mobile';
import { Linking, StyleSheet, Text, View } from 'react-native';

import { linhasDoRodapeLegal, type DadosDoRodape } from '@/lib/rodape-legal';

export function RodapeLegal({ dados, versao, ano = new Date().getFullYear() }: { dados: DadosDoRodape | null; versao: string | null | undefined; ano?: number }) {
  const l = linhasDoRodapeLegal({ dados, versao, ano });
  return (
    <View style={styles.bloco} testID="login.rodape-legal">
      {l.empresa ? (
        <View style={styles.linhaQuebra} accessible accessibilityRole="text" accessibilityLabel={l.empresa.leitor} testID="login.rodape-empresa">
          {l.empresa.razaoSocial ? (
            <Text style={styles.texto}>
              {l.empresa.razaoSocial}
              {l.empresa.cnpj ? ' · ' : ''}
            </Text>
          ) : null}
          {l.empresa.cnpj ? <Text style={styles.texto}>{l.empresa.cnpj}</Text> : null}
        </View>
      ) : null}
      <Text style={styles.texto} accessibilityRole="text" accessibilityLabel={l.direitos.leitor}>
        {l.direitos.texto}
      </Text>
      <View style={styles.linha}>
        {l.versao ? <Text style={styles.texto}>{`${l.versao} · `}</Text> : null}
        <Pressionavel
          testID="login.site"
          accessibilityRole="link"
          accessibilityLabel={`Abrir o site ${l.site}`}
          hitSlop={{ top: 16, bottom: 16, left: 8, right: 8 }}
          onPress={() => void Linking.openURL(l.url).catch(() => undefined)}>
          <Text style={styles.link}>{l.site}</Text>
        </Pressionavel>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bloco: { alignSelf: 'stretch', alignItems: 'center', gap: 2 },
  linha: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center' },
  // razão social longa: o CNPJ desce inteiro (cada parte é um Text; a linha quebra entre eles)
  linhaQuebra: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center' },
  texto: { fontFamily: fonts.body, fontSize: 12, lineHeight: 16, color: colors.ink2, textAlign: 'center' },
  link: { fontFamily: fonts.semibold, fontSize: 12, lineHeight: 16, color: colors.accentInk, textDecorationLine: 'underline' },
});
