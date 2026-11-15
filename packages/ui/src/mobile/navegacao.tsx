/**
 * Navegação comum das telas (pedido R-20261102-174719 do modulo-catalogo, RF-CAT-04):
 * - `Trilha`: trilha clicável (breadcrumb). Itens anteriores são botões; o último é o lugar atual (não clicável, lido
 *   pelo leitor de tela como "atual"). Quebra de linha quando não cabe; alvo de toque de 48 dp.
 * - `LinhaChips`: uma linha de chips com rolagem horizontal (não empurra a lista para baixo quando há muitos filtros).
 * - `ListaNiveis` (T-0142): os níveis do catálogo com a contagem de produtos ativos, um nível por tela.
 * - `LinhaAtalho` (T-0085): linha tocável que leva a outra vista da mesma aba (ex.: "Rascunhos (2)" em Pedidos). Fundo Azul
 *   suave para não ser confundida com as linhas brancas da lista; ícone, rótulo, apoio e seta. Ver docs/design/pedido-v3.md §F.1.
 * Só apresentação: quem decide o que entra na trilha ou nos chips é a tela/domain do módulo.
 */
import type { ReactNode } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { leituraDoAtalho, leituraDoNivel, textoDaContagem } from './componentes';
import { Icon, type IconName } from './icon';
import { Pressionavel } from './movimento-rn';
import { colors, fonte, radius } from './theme';

/** Alvo de toque mínimo destas peças (48 dp, Material). */
const ALVO = 48;

export interface ItemTrilha {
  /** Chave estável (id do nó). */
  id: string;
  rotulo: string;
  /**
   * Item sem toque fora o atual (T-0142): nível que a navegação pulou por ter um item só. Aparece em `ink2`, porque tocar
   * nele levaria à mesma tela.
   */
  desligado?: boolean;
  testID?: string;
}

export function Trilha({
  itens,
  onEscolher,
  compacta,
  rotuloAcessivel,
  testID = 'trilha',
}: {
  /** Do mais geral ao atual; o último é o lugar atual. */
  itens: readonly ItemTrilha[];
  onEscolher: (id: string) => void;
  /**
   * Visual curto da referência do Novo pedido (T-0071): "Mercearia › Bebidas" em 13, anteriores em cinza e o atual em
   * Azul noite. O alvo de toque continua 48 dp.
   */
  compacta?: boolean;
  /** Leitura de cada item no leitor de tela; sem ela, "Ir para X" / "X, você está aqui". */
  rotuloAcessivel?: (item: ItemTrilha, atual: boolean) => string;
  testID?: string;
}) {
  if (itens.length === 0) return null;
  return (
    <View style={s.trilha} testID={testID}>
      {itens.map((item, i) => {
        const atual = i === itens.length - 1;
        const pulado = !atual && Boolean(item.desligado);
        const desligado = atual || pulado;
        return (
          <View key={item.id} style={s.item}>
            {i > 0 ? <Icon name="chevron" size={compacta ? 12 : 14} color={colors.ink3} /> : null}
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={rotuloAcessivel ? rotuloAcessivel(item, atual) : pulado ? item.rotulo : desligado ? `${item.rotulo}, você está aqui` : `Ir para ${item.rotulo}`}
              accessibilityState={{ disabled: desligado, selected: desligado && !pulado }}
              disabled={desligado}
              onPress={() => onEscolher(item.id)}
              style={({ pressed }) => [s.passo, compacta && s.passoCompacto, pressed && { opacity: 0.6 }]}
              testID={item.testID ?? `${testID}-${item.id}`}>
              <Text style={compacta ? (atual ? s.atualCompacto : s.linkCompacto) : atual ? s.atual : pulado ? s.pulado : s.link}>{item.rotulo}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/**
 * Linha de chips com rolagem horizontal. Encosta nas bordas da tela (`sangria` = respiro lateral do `Screen`, 20) para o
 * último chip não ficar cortado no meio do respiro.
 */
export function LinhaChips({ children, sangria = 20, testID }: { children: ReactNode; sangria?: number; testID?: string }) {
  return (
    <ScrollView
      horizontal
      testID={testID}
      showsHorizontalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      style={{ marginHorizontal: -sangria, flexGrow: 0 }}
      contentContainerStyle={{ gap: 8, paddingHorizontal: sangria, alignItems: 'center', minHeight: ALVO }}>
      {children}
    </ScrollView>
  );
}

/**
 * Atalho para outra vista da mesma aba (padrão em docs/design/pedido-v3.md §F.1: "Rascunhos (2)" em Pedidos). Sem regra: a tela decide
 * quando mostrar e para onde vai. Alvo de 48 dp (56 com apoio), afunda 0,97 ao toque (só esmaece com "reduzir movimento").
 * Texto cresce com a fonte do sistema (sem altura fixa): rótulo e apoio quebram em até 2 linhas.
 */
export function LinhaAtalho({
  rotulo,
  apoio,
  icone,
  onPress,
  rotuloAcessivel,
  testID = 'linha-atalho',
}: {
  /** Rótulo curto (até 24 caracteres): "Rascunhos (2)". */
  rotulo: string;
  /** Uma linha que diz o que a vista mostra (até 36 caracteres): "Somem 24 h após a última alteração". */
  apoio?: string;
  icone?: IconName;
  onPress: () => void;
  /** Sem ela, "rótulo. apoio" com o "›" lido como vírgula (`leituraDoAtalho`). */
  rotuloAcessivel?: string;
  testID?: string;
}) {
  return (
    <Pressionavel accessibilityRole="button" accessibilityLabel={rotuloAcessivel ?? leituraDoAtalho(rotulo, apoio)} onPress={onPress} style={[s.atalho, apoio ? s.atalhoComApoio : null]} testID={testID}>
      {icone ? <Icon name={icone} size={20} color={colors.accentInk} /> : null}
      <View style={s.atalhoTexto}>
        <Text style={s.atalhoRotulo} numberOfLines={2}>
          {rotulo}
        </Text>
        {apoio ? (
          <Text style={s.atalhoApoio} numberOfLines={2}>
            {apoio}
          </Text>
        ) : null}
      </View>
      <Icon name="chevron" size={16} color={colors.accentInk} />
    </Pressionavel>
  );
}

export interface NivelDaLista {
  /** Id do nó (ou uma chave da tela para "Outros produtos" e "Sem classificação"). */
  id: string;
  nome: string;
  /** Produtos ativos do nível, somando os de baixo (o domain conta; aqui só mostra). */
  contagem: number;
  /** Linha extra do fim ("Outros produtos", "Sem classificação"): nome em `ink2`. */
  secundario?: boolean;
  testID?: string;
}

/**
 * Lista de níveis do catálogo (T-0142; spec docs/design/catalogo-por-linha.md §2): cabeçalho com o nome do nível no plural à
 * esquerda ("Sistemas") e o da contagem à direita ("Produtos"); um cartão branco com traço entre as linhas; linha de 56 dp com o
 * nome (16/600, até 2 linhas), a contagem em negrito (700) tabular e a seta. A linha inteira é o toque (afunda 0,97). Quem
 * decide quais níveis entram, quais pular e a contagem é a função do domain do Catálogo.
 */
export function ListaNiveis({
  rotulo,
  rotuloContagem,
  itens,
  onEscolher,
  singular = 'produto',
  plural = 'produtos',
  testID = 'lista-niveis',
}: {
  /** "Sistemas", "Grupos", "Linhas" (o domain devolve; sem nome, "Categorias"). */
  rotulo: string;
  /** "Produtos". */
  rotuloContagem: string;
  itens: readonly NivelDaLista[];
  onEscolher: (id: string) => void;
  /** Leitura do TalkBack: "Alimentos, 16 produtos". */
  singular?: string;
  plural?: string;
  testID?: string;
}) {
  if (itens.length === 0) return null;
  return (
    <View style={s.niveis} testID={testID}>
      <View style={s.niveisCabecalho} accessibilityRole="header">
        <Text style={s.niveisRotulo}>{rotulo}</Text>
        <Text style={s.niveisRotulo}>{rotuloContagem}</Text>
      </View>
      <View style={s.niveisCartao}>
        {itens.map((n, i) => (
          <Pressionavel
            key={n.id}
            accessibilityRole="button"
            accessibilityLabel={leituraDoNivel(n.nome, n.contagem, singular, plural)}
            onPress={() => onEscolher(n.id)}
            style={[s.nivel, i > 0 && s.nivelTraco]}
            testID={n.testID ?? `${testID}-${n.id}`}>
            <Text style={[s.nivelNome, n.secundario && s.nivelNomeSecundario]} numberOfLines={2}>
              {n.nome}
            </Text>
            <Text style={s.nivelContagem}>{textoDaContagem(n.contagem)}</Text>
            <Icon name="chevron" size={16} color={colors.ink3} />
          </Pressionavel>
        ))}
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  trilha: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center' },
  item: { flexDirection: 'row', alignItems: 'center' },
  passo: { minHeight: ALVO, justifyContent: 'center', paddingHorizontal: 6 },
  // accentInk (Azul noite): 11,82:1 no fundo Pérola (T-0172)
  link: { ...fonte.medium, fontSize: 14, color: colors.accentInk },
  atual: { ...fonte.semibold, fontSize: 14, color: colors.ink },
  // nível pulado (T-0142): ink2 7,6:1 no branco, 6,9:1 no fundo; sem toque
  pulado: { ...fonte.medium, fontSize: 14, color: colors.ink2 },
  // .crumb / .crumb b da referência do Novo pedido
  passoCompacto: { paddingHorizontal: 4 },
  linkCompacto: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  atualCompacto: { ...fonte.semibold, fontSize: 14, color: colors.accentInk },
  // LinhaAtalho: Azul suave com ink 12,68:1, ink2 5,84:1 e accentInk 9,83:1 (todos ≥ 4,5:1)
  atalho: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: ALVO, paddingHorizontal: 14, paddingVertical: 8, backgroundColor: colors.accentSoft, borderRadius: radius.md },
  atalhoComApoio: { minHeight: 56 },
  atalhoTexto: { flex: 1, gap: 2 },
  atalhoRotulo: { ...fonte.semibold, fontSize: 16, color: colors.ink },
  atalhoApoio: { ...fonte.body, fontSize: 14, color: colors.ink2 },
  // ListaNiveis (T-0142): ink 16,5:1, ink2 7,6:1 e ink3 5,8:1 no branco
  niveis: { gap: 8 },
  niveisCabecalho: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingHorizontal: 2 },
  niveisRotulo: { ...fonte.semibold, fontSize: 12, letterSpacing: 0.6, textTransform: 'uppercase', color: colors.ink2 },
  niveisCartao: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.line, borderRadius: radius.lg, overflow: 'hidden' },
  nivel: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: 14, paddingVertical: 8 },
  nivelTraco: { borderTopWidth: 1, borderTopColor: colors.lineSoft },
  nivelNome: { flex: 1, minWidth: 0, ...fonte.semibold, fontSize: 16, color: colors.ink },
  nivelNomeSecundario: { color: colors.ink2 },
  nivelContagem: { ...fonte.semibold, fontSize: 16, color: colors.ink, fontVariant: ['tabular-nums'] },
});
