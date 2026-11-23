/**
 * v1.0.30 (docs/design/telas/codigos-do-cliente.md §2 e §3): `ERP C5007 · FDV 00012` no app, valor em `fonte.mono` e sigla
 * no estilo do texto em volta. Não é selo (código é identificação, não estado). Partes puras em `codigos-cliente.ts`. Os códigos
 * aparecem no `CabecalhoTela` (`codigos`), nunca numa linha solta no corpo (§3.3).
 */
import { Fragment } from 'react';
import { Text, type TextStyle } from 'react-native';

import { partesDosCodigos, SEPARADOR_CODIGOS, type CodigosDoCliente } from '../comum/codigos-cliente';
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

// a mono herda tamanho e cor do texto em volta (§2: "no tamanho e na cor do texto onde aparece")
const estiloMono: TextStyle = { fontFamily: fonte.mono.fontFamily, fontVariant: fonte.mono.fontVariant };
