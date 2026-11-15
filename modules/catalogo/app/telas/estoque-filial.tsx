/**
 * Estoque por filial no Campo (docs/design/catalogo-campo-v2/spec.md §2.1, §3 e §4): o botão `pacote` do cartão e da ficha, a folha
 * "Estoque por filial" (tabela Filial | Estoque) e a folha "Filtrar" do Catálogo (filial e itens sem estoque). Só desenho: as
 * regras (quem vê quais filiais, texto, cor e ordem) vêm de `domain/estoque-campo.ts` e `lib/estoque-folha.ts`.
 */
import { Button, colors, fonts, Folha, Icon } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { DadosDaFolha, OpcaoFiltroFilial } from '../lib/estoque-folha';

/** Botão só com o ícone `pacote`, à direita do "Estoque: N" no cartão: 32 dp, borda `lineStrong`, alvo de 48 dp (spec §3). */
export function BotaoEstoquePorFilial({ onPress, testID }: { onPress: () => void; testID?: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel="Estoque por filial" onPress={onPress} hitSlop={8} style={({ pressed }) => [e.botao, pressed && { backgroundColor: colors.ground }]}>
      <Icon name="pacote" size={18} color={colors.ink} />
    </Pressable>
  );
}

/** Botão "Por filial" da ficha: secundário claro de 48 dp com o ícone `pacote` (spec §2). */
export function BotaoPorFilialDaFicha({ onPress }: { onPress: () => void }) {
  return <Button testID="produto-estoque-por-filial" label="Por filial" accessibilityLabel="Estoque por filial" icon="pacote" variant="outline" height={48} onPress={onPress} />;
}

const COR_DA_LINHA = { sucesso: colors.success, erro: colors.danger } as const;

/** Folha "Estoque por filial": a mesma `Folha` do "Filtrar", só leitura, rolável (spec §2.1). */
export function FolhaEstoquePorFilial({ visivel, onFechar, dados }: { visivel: boolean; onFechar: () => void; dados: DadosDaFolha | null }) {
  return (
    <Folha visivel={visivel} onFechar={onFechar} titulo={dados?.titulo ?? 'Estoque por filial'} fechar={{ rotulo: 'Fechar', testID: 'estoque-folha-fechar' }} rotuloFechar="Fechar estoque por filial" rolavel testID="estoque-folha">
      {dados ? (
        <View>
          <Text style={e.apoio} testID="estoque-folha-apoio">
            {dados.apoio}
          </Text>
          <View style={e.cabecalho}>
            <Text style={e.cabecalhoTexto}>Filial</Text>
            <Text style={e.cabecalhoTexto}>Estoque</Text>
          </View>
          {dados.linhas.map((l, i) => (
            <View key={l.id} style={e.linha} accessible accessibilityLabel={dados.leitura[i]?.texto} testID={`estoque-folha-linha-${l.id}`}>
              <View style={{ flex: 1 }}>
                <Text style={e.nome}>{l.nome}</Text>
                {l.propria ? <Text style={e.sua}>sua filial</Text> : null}
              </View>
              <Text style={[e.valor, { color: COR_DA_LINHA[l.tom] }]}>{l.valor}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Folha>
  );
}

export type EscolhaFiltro = { filial: string | null; soComEstoque: boolean };

/** Folha "Filtrar" do Catálogo: grupo Filial (quando há o que escolher) e Itens sem estoque (spec §4). */
export function FolhaFiltroCatalogo({
  visivel,
  onFechar,
  opcoes,
  escolha,
  filialMarcada,
  onEscolher,
  onLimpar,
  textoVer,
}: {
  visivel: boolean;
  onFechar: () => void;
  opcoes: OpcaoFiltroFilial[];
  escolha: EscolhaFiltro;
  /** Opção do grupo Filial marcada: a escolhida ou o padrão do perfil (a filial do vendedor; `todas` = "Suas filiais"). */
  filialMarcada: string | null;
  onEscolher: (e: EscolhaFiltro) => void;
  onLimpar: () => void;
  /** "Ver 1.284 produtos". */
  textoVer: string;
}) {
  return (
    <Folha visivel={visivel} onFechar={onFechar} titulo="Filtrar" fechar={{ rotulo: 'Fechar', testID: 'catalogo-filtro-fechar' }} rotuloFechar="Fechar filtro" rodape={{ rotulo: textoVer, onPress: onFechar, testID: 'catalogo-filtro-ver' }} rolavel testID="catalogo-filtro">
      {opcoes.length > 0 ? (
        <View>
          <Text style={e.grupo}>Filial</Text>
          {opcoes.map((o) => (
            <Opcao key={o.valor} rotulo={o.rotulo} apoio={o.apoio} marcada={filialMarcada === o.valor} onPress={() => onEscolher({ ...escolha, filial: o.valor })} testID={`catalogo-filtro-filial-${o.valor}`} />
          ))}
        </View>
      ) : null}
      <View>
        <Text style={e.grupo}>Itens sem estoque</Text>
        <Opcao rotulo="Mostrar" apoio={null} marcada={!escolha.soComEstoque} onPress={() => onEscolher({ ...escolha, soComEstoque: false })} testID="catalogo-filtro-sem-estoque-mostrar" />
        <Opcao rotulo="Ocultar" apoio={null} marcada={escolha.soComEstoque} onPress={() => onEscolher({ ...escolha, soComEstoque: true })} testID="catalogo-filtro-sem-estoque-ocultar" />
      </View>
      <Pressable testID="catalogo-filtro-limpar" accessibilityRole="button" onPress={onLimpar} style={e.limpar}>
        <Text style={e.limparTexto}>Limpar</Text>
      </Pressable>
    </Folha>
  );
}

function Opcao({ rotulo, apoio, marcada, onPress, testID }: { rotulo: string; apoio: string | null; marcada: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: marcada }} accessibilityLabel={apoio ? `${rotulo}, ${apoio}` : rotulo} onPress={onPress} style={e.opcao}>
      <View style={{ flex: 1 }}>
        <Text style={e.opcaoTexto}>{rotulo}</Text>
        {apoio ? <Text style={e.sua}>{apoio}</Text> : null}
      </View>
      {marcada ? <Icon name="check" size={20} color={colors.accent} /> : null}
    </Pressable>
  );
}

const e = StyleSheet.create({
  botao: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong },
  apoio: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2, marginBottom: 8 },
  cabecalho: { height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, backgroundColor: colors.neutralBg },
  cabecalhoTexto: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2 },
  linha: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  nome: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  sua: { fontFamily: fonts.body, fontSize: 13, color: colors.ink2 },
  valor: { fontFamily: fonts.displayBold, fontSize: 16, fontVariant: ['tabular-nums'], textAlign: 'right' },
  grupo: { fontFamily: fonts.semibold, fontSize: 13, color: colors.ink2, marginTop: 8, marginBottom: 4 },
  opcao: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  opcaoTexto: { fontFamily: fonts.body, fontSize: 15, color: colors.ink },
  limpar: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  limparTexto: { fontFamily: fonts.semibold, fontSize: 15, color: colors.ink2 },
});
