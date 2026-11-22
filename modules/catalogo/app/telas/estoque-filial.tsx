/**
 * Estoque por filial no Campo (docs/design/catalogo-campo-v2/spec.md §2.1, §3 e §4): o botão `pacote` do cartão e da ficha, a folha
 * "Estoque por filial" (tabela Filial | Estoque) e a folha "Filtrar" do Catálogo (sistema, categoria e filial). Só desenho: as
 * regras (quem vê quais filiais, texto, cor e ordem) vêm de `domain/estoque-campo.ts` e `lib/estoque-folha.ts`.
 */
import { Botao, Button, Chip, colors, Folha, fonte, Icon, type } from '@macuxi/ui/mobile';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
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

interface NoDoFiltro {
  id: string;
  nome: string;
  codigo: string;
  /** RN-CAT-22 (D1): quantas peças da lista de agora o chip tem; ausente = ainda não contada (sem número). */
  contagem?: number;
}

/** Chave "Só com estoque" logo abaixo da busca (RN-CAT-05: o estoque é visível a todo perfil): 48 dp, desligada mostra com e sem estoque. */
export function ChaveSoComEstoque({ ligada, onMudar }: { ligada: boolean; onMudar: (v: boolean) => void }) {
  return (
    <View style={e.chave}>
      <Text style={[e.opcaoTexto, { flex: 1 }]}>Só com estoque</Text>
      <Switch testID="catalogo-chave-estoque" accessibilityLabel="Só com estoque" value={ligada} onValueChange={onMudar} trackColor={{ true: colors.accent, false: colors.lineStrong }} thumbColor={colors.surface} ios_backgroundColor={colors.lineStrong} />
    </View>
  );
}

/** Folha "Filtrar" do Catálogo: sistema e categoria (chips), grupo Filial (quando há o que escolher). O "Só com estoque" fica na chave da tela. */
export function FolhaFiltroCatalogo({
  visivel,
  onFechar,
  opcoes,
  escolha,
  onEscolher,
  onLimpar,
  sistemas,
  categorias,
  sistemaId,
  categoriaId,
  onSistema,
  onCategoria,
}: {
  visivel: boolean;
  onFechar: () => void;
  opcoes: OpcaoFiltroFilial[];
  escolha: EscolhaFiltro;
  onEscolher: (e: EscolhaFiltro) => void;
  onLimpar: () => void;
  sistemas: readonly NoDoFiltro[];
  categorias: readonly NoDoFiltro[];
  sistemaId: string | null;
  categoriaId: string | null;
  onSistema: (id: string | null) => void;
  onCategoria: (id: string | null) => void;
}) {
  return (
    <Folha visivel={visivel} onFechar={onFechar} titulo="Filtrar" fechar={{ rotulo: 'Fechar', testID: 'catalogo-filtro-fechar' }} rotuloFechar="Fechar filtro" rolavel testID="catalogo-filtro">
      {sistemas.length > 0 ? (
        <View testID="catalogo-chips-sistema">
          <Text style={e.grupo}>Sistema</Text>
          <View style={e.chips}>
            <Chip label="Todos" active={sistemaId === null} onPress={() => onSistema(null)} testID="catalogo-chip-sistema-todos" />
            {sistemas.map((n) => (
              <Chip key={n.id} label={n.nome} {...(n.contagem !== undefined ? { contagem: n.contagem } : {})} active={sistemaId === n.id} onPress={() => onSistema(n.id)} testID={`catalogo-chip-sistema-${n.codigo}`} />
            ))}
          </View>
        </View>
      ) : null}
      {categorias.length > 0 ? (
        <View testID="catalogo-chips-categoria">
          <Text style={e.grupo}>Categoria</Text>
          <View style={e.chips}>
            <Chip label="Todas" active={categoriaId === null} onPress={() => onCategoria(null)} testID="catalogo-chip-categoria-todas" />
            {categorias.map((n) => (
              <Chip key={n.id} label={n.nome} {...(n.contagem !== undefined ? { contagem: n.contagem } : {})} active={categoriaId === n.id} onPress={() => onCategoria(n.id)} testID={`catalogo-chip-categoria-${n.codigo}`} />
            ))}
          </View>
        </View>
      ) : null}
      {opcoes.length > 0 ? (
        <View>
          <Text style={e.grupo}>Filial</Text>
          {opcoes.map((o, i) => (
            <Opcao key={o.valor} divisor={i > 0} rotulo={o.rotulo} marcada={(escolha.filial ?? 'todas') === o.valor} onPress={() => onEscolher({ ...escolha, filial: o.valor })} testID={`catalogo-filtro-filial-${o.valor}`} />
          ))}
        </View>
      ) : null}
      <Botao nivel="neutro" rotulo="Limpar" onPress={onLimpar} testID="catalogo-filtro-limpar" />
      <Botao nivel="principal" rotulo="Ver produtos" onPress={onFechar} testID="catalogo-filtro-ver" />
    </Folha>
  );
}

function Opcao({ divisor, rotulo, marcada, onPress, testID }: { divisor: boolean; rotulo: string; marcada: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable testID={testID} accessibilityRole="radio" accessibilityState={{ selected: marcada }} accessibilityLabel={rotulo} onPress={onPress} style={[e.opcao, divisor && e.divisor]}>
      <Text style={[e.opcaoTexto, { flex: 1 }, marcada && e.opcaoTextoOn]}>{rotulo}</Text>
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
  nome: type.body,
  sua: type.sub,
  valor: { ...fonte.semibold, fontSize: 16, fontVariant: ['tabular-nums'], textAlign: 'right' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chave: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  grupo: { ...fonte.semibold, fontSize: 14, color: colors.ink2, marginTop: 8, marginBottom: 4 },
  opcao: { minHeight: 48, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 4 },
  opcaoTexto: type.body,
  opcaoTextoOn: fonte.semibold,
  divisor: { borderTopWidth: 1, borderTopColor: colors.line },
});
