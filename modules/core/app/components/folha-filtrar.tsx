/**
 * Folha "Filtrar" do filtro padrão do Campo (spec `docs/design/filtro-padrao-campo/spec.md` §1): título, ✕, grupos com rótulo e,
 * com vários grupos, o rodapé `Limpar` (neutro) + `Ver N …` (principal, 52 dp), que fecha. Composição sobre a `Folha` do kit
 * enquanto o `FolhaFiltro` do kit (designer-ux) não chega; quando chegar, as telas trocam este arquivo por ele.
 * O campo de Data que abre a `FolhaPeriodo` é o `CampoAbrir` do kit (RD-0509). Sem regra e sem texto fixo: tudo por props.
 */
import { Botao, colors, fonts, Folha } from '@macuxi/ui/mobile';
import type { ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function FolhaFiltrar({
  visivel,
  onFechar,
  titulo,
  rotuloFechar,
  limpar,
  ver,
  children,
  testID,
}: {
  visivel: boolean;
  onFechar: () => void;
  /** "Filtrar". */
  titulo: string;
  /** ✕ e toque fora ("Fechar o filtro"). */
  rotuloFechar: string;
  /** "Limpar": volta ao padrão; a folha fica aberta. */
  limpar: { rotulo: string; onPress: () => void; desligado?: boolean };
  /** "Ver 4 visitas": aplica e fecha. */
  ver: { rotulo: string; onPress: () => void; /** A contagem ainda está sendo lida: botão ocupado. */ ocupado?: boolean };
  children: ReactNode;
  testID: string;
}) {
  return (
    <Folha visivel={visivel} onFechar={onFechar} rotuloFechar={rotuloFechar} titulo={titulo} fechar={{ rotulo: rotuloFechar }} rolavel evitarTeclado testID={testID}>
      <View style={s.grupos}>{children}</View>
      <View style={s.rodape}>
        <Botao nivel="neutro" alto rotulo={limpar.rotulo} onPress={limpar.onPress} desligado={limpar.desligado} style={s.limpar} testID={`${testID}-limpar`} />
        <Botao nivel="principal" rotulo={ver.rotulo} onPress={ver.onPress} ocupado={ver.ocupado} style={s.ver} testID={`${testID}-ver`} />
      </View>
    </Folha>
  );
}

/** Grupo da folha: rótulo (13/600 `ink2`) e o conteúdo (busca, campo de escolha ou chips). */
export function GrupoFiltro({ rotulo, children }: { rotulo: string; children: ReactNode }) {
  return (
    <View style={s.grupo}>
      <Text style={s.rotulo} accessibilityRole="header">
        {rotulo}
      </Text>
      {children}
    </View>
  );
}

const s = StyleSheet.create({
  grupos: { gap: 16 },
  grupo: { gap: 8 },
  rotulo: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  rodape: { flexDirection: 'row', gap: 10, marginTop: 16 },
  limpar: { flex: 2 },
  ver: { flex: 3 },
});
