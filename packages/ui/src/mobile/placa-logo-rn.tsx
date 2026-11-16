/**
 * T-0182: `PlacaLogoCliente`, a logo da empresa (a distribuidora) numa placa branca. Spec: docs/design/telas/logo-cliente.md
 * §1, §3 e §5. Medidas, cores e leitura em `./placa-logo` (parte pura).
 *
 *   carga:  placa de 64 dp de altura, até 112 de largura; logo 48 × até 96. Borda só no Gestão (Pérola); no Campo
 *           (Azul noite) a placa fica sem borda (`borda={false}`).
 *   mais:   placa de 52 dp, até 176 de largura; logo 36 × até 152; com borda.
 *
 * A imagem é a cópia guardada no aparelho (`fonte` = uri local) e fica em `contain`: nunca recortada, esticada, recolorida,
 * com sombra ou filtro. A `proporcao` vem de `proporcaoDaLogo(logo)` do SDK (RD-0921): a placa não mede a imagem. Com
 * `nomeEmpresa`, o TalkBack lê "Logo da <nome da empresa>"; sem ele, a placa é decorativa e fica fora da leitura. Sem logo
 * guardada, a tela não monta a placa (nenhum espaço vazio).
 */
import { Image, View } from 'react-native';

import { caixaDaPlacaLogo, ESTILO_PLACA_LOGO, PLACA_LOGO, rotuloDaPlacaLogo, type TamanhoPlacaLogo } from './placa-logo';

export function PlacaLogoCliente({
  fonte,
  tamanho,
  borda = true,
  nomeEmpresa,
  proporcao,
  testID,
}: {
  /** Uri local da logo guardada no aparelho (`file://…`). */
  fonte: string;
  /** `carga` (64/48, tela de entrada) ou `mais` (52/36, fim do Mais). */
  tamanho: TamanhoPlacaLogo;
  /** Borda #DFE2E6 de 1 dp: `true` sobre o Pérola (Gestão, Mais); `false` sobre o Azul noite (carga do Campo). */
  borda?: boolean;
  /** Nome da empresa (fantasia ou razão social): o TalkBack lê "Logo da <nome>". Ausente = logo decorativa (fim do Mais). */
  nomeEmpresa?: string | null;
  /** Largura ÷ altura da logo: `proporcaoDaLogo(logo)` do SDK (px gravados pela API). */
  proporcao: number;
  testID?: string;
}) {
  const m = PLACA_LOGO[tamanho];
  const caixa = caixaDaPlacaLogo(tamanho, proporcao);
  const rotulo = rotuloDaPlacaLogo(nomeEmpresa);
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
      <Image source={{ uri: fonte }} resizeMode="contain" style={{ width: caixa.larguraLogo, height: caixa.alturaLogo }} />
    </View>
  );
}
