/**
 * T-0182: `PlacaLogoCliente`, a logo da empresa (a distribuidora) numa placa branca. Spec: docs/design/telas/logo-cliente.md
 * §1, §3 e §5. Medidas, cores e leitura em `./placa-logo` (parte pura).
 *
 *   carga:  placa de 64 dp de altura, até 112 de largura; logo 48 × até 96. Borda só no Gestão (Pérola); no Campo
 *           (Azul noite) a placa fica sem borda (`borda={false}`).
 *   mais:   placa de 52 dp, até 176 de largura; logo 36 × até 152; com borda.
 *
 * A imagem é a cópia guardada no aparelho (`fonte` = uri local) e fica em `contain`: nunca recortada, esticada, recolorida,
 * com sombra ou filtro. Com `nomeFantasia`, o TalkBack lê "Logo da <nome fantasia>"; sem ele, a placa é decorativa e fica
 * fora da leitura. Sem logo guardada, a tela não monta a placa (nenhum espaço vazio).
 */
import { useState } from 'react';
import { Image, View, type ImageLoadEventData, type NativeSyntheticEvent } from 'react-native';

import { caixaDaPlacaLogo, ESTILO_PLACA_LOGO, PLACA_LOGO, rotuloDaPlacaLogo, type TamanhoPlacaLogo } from './placa-logo';

export function PlacaLogoCliente({
  fonte,
  tamanho,
  borda = true,
  nomeFantasia,
  proporcao,
  testID,
}: {
  /** Uri local da logo guardada no aparelho (`file://…`). */
  fonte: string;
  /** `carga` (64/48, tela de entrada) ou `mais` (52/36, fim do Mais). */
  tamanho: TamanhoPlacaLogo;
  /** Borda #DFE2E6 de 1 dp: `true` sobre o Pérola (Gestão, Mais); `false` sobre o Azul noite (carga do Campo). */
  borda?: boolean;
  /** Nome fantasia da empresa: o TalkBack lê "Logo da <nome>". Ausente = logo decorativa (fim do Mais). */
  nomeFantasia?: string | null;
  /** Largura ÷ altura da imagem, se a tela já souber; senão, vem do carregamento da imagem. */
  proporcao?: number | null;
  testID?: string;
}) {
  const [proporcaoLida, setProporcaoLida] = useState<number | null>(null);
  const m = PLACA_LOGO[tamanho];
  const caixa = caixaDaPlacaLogo(tamanho, proporcao ?? proporcaoLida);
  const rotulo = rotuloDaPlacaLogo(nomeFantasia);
  const aoCarregar = (e: NativeSyntheticEvent<ImageLoadEventData>) => {
    const { width, height } = e.nativeEvent.source;
    if (width > 0 && height > 0) setProporcaoLida(width / height);
  };
  return (
    <View
      testID={testID}
      accessible={rotulo !== null}
      accessibilityRole={rotulo ? 'image' : undefined}
      accessibilityLabel={rotulo ?? undefined}
      accessibilityElementsHidden={rotulo === null}
      importantForAccessibility={rotulo ? 'yes' : 'no-hide-descendants'}
      style={{
        height: m.altura,
        width: caixa.larguraPlaca,
        alignItems: 'center',
        justifyContent: 'center',
        backgroundColor: ESTILO_PLACA_LOGO.fundo,
        borderRadius: ESTILO_PLACA_LOGO.raio,
        borderWidth: borda ? ESTILO_PLACA_LOGO.larguraBorda : 0,
        borderColor: ESTILO_PLACA_LOGO.borda,
      }}>
      <Image source={{ uri: fonte }} resizeMode="contain" onLoad={aoCarregar} style={{ width: caixa.larguraLogo, height: caixa.alturaLogo }} />
    </View>
  );
}
