/**
 * Estoque por filial no Campo (docs/design/catalogo-campo-v2/spec.md §2.1, §3 e §4): o botão `pacote` do cartão e da ficha, a folha
 * "Estoque por filial" (tabela Filial | Estoque) e a folha "Filtrar" do Catálogo (filial e itens sem estoque). Só desenho: as
 * regras (quem vê quais filiais, texto, cor e ordem) vêm de `domain/estoque-campo.ts` e `lib/estoque-folha.ts`.
 */
import { Botao, Button, colors, Folha, fonte, Icon, type } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import type { ItemVitrine } from '../../contracts';
import { mostraEstoquePorFilial, TITULO_FOLHA_ESTOQUE, type DadosDaFolha, type OpcaoFiltroFilial } from '../lib/estoque-folha';

/** Botão só com o ícone `pacote`, à direita do "Estoque: N" no cartão: 32 dp, borda `lineStrong`, alvo de 48 dp (spec §3); só com mais de uma filial. */
export function BotaoEstoquePorFilial({ availability, onPress, testID }: { availability: ItemVitrine['availability']; onPress: () => void; testID?: string }) {
  if (!mostraEstoquePorFilial(availability)) return null;
  return (
    <Pressable testID={testID} accessibilityRole="button" accessibilityLabel={TITULO_FOLHA_ESTOQUE} onPress={onPress} hitSlop={8} style={({ pressed }) => [e.botao, pressed && { backgroundColor: colors.ground }]}>
      <Icon name="pacote" size={18} color={colors.ink} />
    </Pressable>
  );
}

/** Botão "Por filial" da ficha: secundário claro de 48 dp com o ícone `pacote` (spec §2); só com mais de uma filial. */
export function BotaoPorFilialDaFicha({ availability, onPress }: { availability: ItemVitrine['availability']; onPress: () => void }) {
  if (!mostraEstoquePorFilial(availability)) return null;
  return <Button testID="produto-estoque-por-filial" label="Por filial" accessibilityLabel={TITULO_FOLHA_ESTOQUE} icon="pacote" variant="outline" height={48} onPress={onPress} />;
}

const COR_DA_LINHA = { sucesso: colors.success, erro: colors.danger } as const;

/** Folha "Estoque por filial": a mesma `Folha` do "Filtrar", só leitura, rolável (spec §2.1). */
export function FolhaEstoquePorFilial({ visivel, onFechar, dados }: { visivel: boolean; onFechar: () => void; dados: DadosDaFolha | null }) {
  return (
    <Folha visivel={visivel} onFechar={onFechar} titulo={TITULO_FOLHA_ESTOQUE} fechar={{ rotulo: 'Fechar', testID: 'estoque-folha-fechar' }} rotuloFechar="Fechar estoque por filial" rolavel testID="estoque-folha">
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
  onEscolher,
  onLimpar,
  textoVer,
}: {
  visivel: boolean;
  onFechar: () => void;
  opcoes: OpcaoFiltroFilial[];
  escolha: EscolhaFiltro;
  onEscolher: (e: EscolhaFiltro) => void;
  onLimpar: () => void;
  /** "Ver 1.284 produtos". */
  textoVer: string;
}) {
  return (
    <Folha visivel={visivel} onFechar={onFechar} titulo="Filtrar" fechar={{ rotulo: 'Fechar', testID: 'catalogo-filtro-fechar' }} rotuloFechar="Fechar filtro" rolavel testID="catalogo-filtro">
      {opcoes.length > 0 ? (
        <View>
          <Text style={e.grupo}>Filial</Text>
          {opcoes.map((o, i) => (
            <Opcao key={o.valor} divisor={i > 0} rotulo={o.rotulo} apoio={o.apoio} marcada={(escolha.filial ?? 'todas') === o.valor} onPress={() => onEscolher({ ...escolha, filial: o.valor })} testID={`catalogo-filtro-filial-${o.valor}`} />
          ))}
        </View>
      ) : null}
      <View>
        <Text style={e.grupo}>Itens sem estoque</Text>
        <Opcao divisor={false} rotulo="Mostrar" apoio={null} marcada={!escolha.soComEstoque} onPress={() => onEscolher({ ...escolha, soComEstoque: false })} testID="catalogo-filtro-sem-estoque-mostrar" />
        <Opcao divisor rotulo="Ocultar" apoio={null} marcada={escolha.soComEstoque} onPress={() => onEscolher({ ...escolha, soComEstoque: true })} testID="catalogo-filtro-sem-estoque-ocultar" />
      </View>
      <Botao nivel="neutro" rotulo="Limpar" onPress={onLimpar} testID="catalogo-filtro-limpar" />
      <Botao nivel="principal" rotulo={textoVer} onPress={onFechar} testID="catalogo-filtro-ver" />
    </Folha>
  );
}

function Opcao({ divisor, rotulo, apoio, marcada, onPress, testID }: { divisor: boolean; rotulo: string; apoio: string | null; marcada: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: marcada }} accessibilityLabel={apoio ? `${rotulo}, ${apoio}` : rotulo} onPress={onPress} style={[e.opcao, divisor && e.divisor]}>
      <View style={{ flex: 1 }}>
        <Text style={[e.opcaoTexto, marcada && e.opcaoTextoOn]}>{rotulo}</Text>
        {apoio ? <Text style={e.sua}>{apoio}</Text> : null}
      </View>
      {marcada ? <Icon name="check" size={18} color={colors.accent} strokeWidth={2.6} /> : null}
    </Pressable>
  );
}

const e = StyleSheet.create({
  botao: { width: 32, height: 32, alignItems: 'center', justifyContent: 'center', borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong },
  apoio: { ...type.sub, marginBottom: 8 },
  cabecalho: { height: 36, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 4, backgroundColor: colors.neutralBg },
  cabecalhoTexto: { ...fonte.semibold, fontSize: 14, color: colors.ink2 },
  linha: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: colors.lineSoft },
  nome: type.bodyStrong,
  sua: type.sub,
  valor: { ...fonte.semibold, fontSize: 16, fontVariant: ['tabular-nums'], textAlign: 'right' },
  grupo: { ...fonte.semibold, fontSize: 14, color: colors.ink2, marginTop: 8, marginBottom: 4 },
  opcao: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  opcaoTexto: type.body,
  opcaoTextoOn: fonte.semibold,
  divisor: { borderTopWidth: 1, borderTopColor: colors.line },
});
