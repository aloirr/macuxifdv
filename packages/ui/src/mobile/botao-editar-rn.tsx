/**
 * T-0165 (pedido-v4.md §5.8; R-20261112-082212): `BotaoEditar`, o lápis do item que já está no pedido.
 *   aba Itens:  [ nome - marca / código · Emb. · Est. ]  [✎]   ← `linha`, 44 dp, no lugar do "+"
 *   Resumo:     AGU-1500  FD c/ 6  3  59,76  −5,0%  56,76 [✎]  ← `tabela`, 32 dp, depois do Total (alvo de 48 dp)
 * Borda `accent` 1,5, fundo `accentSoft`, ícone `edit` em `accentInk`. O toque abre a folha do item reaberta (o módulo decide).
 * Nenhum texto fixo além da leitura do TalkBack, montada com o nome que o módulo passa.
 */
import { StyleSheet } from 'react-native';

import { BOTAO_EDITAR, folgaDoBotaoEditar, leituraDoBotaoEditar, type TamanhoBotaoEditar } from './botao-editar';
import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';

export function BotaoEditar({
  item,
  onPress,
  tamanho = 'linha',
  rotuloAcessivel,
  testID,
}: {
  /** Nome do item na leitura do TalkBack: o nome do produto (aba Itens) ou o código (Resumo). */
  item: string;
  onPress: () => void;
  /** `linha` (44 dp, aba Itens) ou `tabela` (32 dp, fim da linha do Resumo). */
  tamanho?: TamanhoBotaoEditar;
  /** Substitui a leitura padrão ("<nome>, no pedido. Editar" / "Editar <código>"). */
  rotuloAcessivel?: string;
  testID?: string;
}) {
  const m = BOTAO_EDITAR[tamanho];
  const f = folgaDoBotaoEditar(tamanho);
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={rotuloAcessivel ?? leituraDoBotaoEditar(item, tamanho)}
      onPress={onPress}
      hitSlop={{ top: f, bottom: f, left: f, right: f }}
      style={[s.base, { width: m.lado, height: m.lado, borderRadius: m.raio }]}>
      <Icon name="edit" size={m.icone} color={BOTAO_EDITAR.icone} strokeWidth={2.2} />
    </Pressionavel>
  );
}

const s = StyleSheet.create({
  base: {
    borderWidth: BOTAO_EDITAR.larguraBorda,
    borderColor: BOTAO_EDITAR.borda,
    backgroundColor: BOTAO_EDITAR.fundo,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
