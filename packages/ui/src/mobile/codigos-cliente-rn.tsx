/**
 * v1.0.30 (docs/design/telas/codigos-do-cliente.md §2 e §3): `ERP C5007 · FDV 00012` no app, valor em `fonte.mono` e sigla
 * no estilo do texto em volta. Não é selo (código é identificação, não estado). Partes puras em `codigos-cliente.ts`.
 */
import { Fragment } from 'react';
import { Text, type StyleProp, type TextStyle } from 'react-native';

import { leituraDosCodigos, partesDosCodigos, SEPARADOR_CODIGOS, type CodigosDoCliente } from './codigos-cliente';
import { fonte } from './theme';

/**
 * Só os trechos (sem `Text` em volta e sem leitura): para aninhar dentro de um `Text` que já tem estilo e `accessibilityLabel`
 * (o `CabecalhoTela` usa assim). `null` quando não há código.
 */
export function TrechosDosCodigos({ codigos, testID }: { codigos: CodigosDoCliente | null | undefined; testID?: string }) {
  const partes = partesDosCodigos(codigos);
  if (partes.length === 0) return null;
  return (
    <>
      {partes.map((p, i) => (
        <Fragment key={p.sigla}>
          {i > 0 ? SEPARADOR_CODIGOS : null}
          {`${p.sigla} `}
          <Text style={estiloMono} testID={testID ? `${testID}.${p.sigla.toLowerCase()}` : undefined}>
            {p.valor}
          </Text>
        </Fragment>
      ))}
    </>
  );
}

export interface PropsCodigosCliente extends CodigosDoCliente {
  /** Estilo do texto em volta (ex.: `type.sub` abaixo do título do formulário). A sigla usa este estilo; o valor, a mono. */
  style?: StyleProp<TextStyle>;
  testID?: string;
}

/**
 * Linha solta com os códigos (ex.: `FDV 00012` abaixo do título de "Corrigir e reenviar"). Lê `Código FDV 00012`.
 * Nada quando os dois códigos estão vazios.
 */
export function CodigosCliente({ erp, fdv, style, testID }: PropsCodigosCliente) {
  const leitura = leituraDosCodigos({ erp, fdv });
  if (!leitura) return null;
  return (
    <Text style={style} numberOfLines={1} accessible accessibilityLabel={leitura} testID={testID}>
      <TrechosDosCodigos codigos={{ erp, fdv }} testID={testID} />
    </Text>
  );
}

// a mono herda tamanho e cor do texto em volta (§2: "no tamanho e na cor do texto onde aparece")
const estiloMono: TextStyle = { fontFamily: fonte.mono.fontFamily, fontVariant: fonte.mono.fontVariant };
