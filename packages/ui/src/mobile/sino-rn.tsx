/**
 * `SinoNotificacoes`: o sino padrão do kit (medidas e cores em `sino.ts`; spec docs/design/componentes.md §5.4). Só apresentação:
 * o shell passa o total (recados não lidos + tarefas novas) e o toque (abre o balão); o `CabecalhoTela` o recebe pelo
 * `ProvedorSinoCabecalho`.
 */
import { StyleSheet, View } from 'react-native';

import { Icon } from './icon';
import { Pressionavel } from './movimento-rn';
import { coresDoSino, leituraDoSino, SINO, temNovoNoSino } from './sino';
import { colors } from './theme';

export interface PropsSinoNotificacoes {
  /** recados não lidos + tarefas novas; 0 = sem bolinha */
  total: number;
  onPress: () => void;
  /** padrão `true`: o sino fica na faixa Azul noite do cabeçalho */
  sobreFaixa?: boolean;
  /** troca a leitura padrão do TalkBack ("Recados e tarefas", "…, há novos") */
  accessibilityLabel?: string;
  testID?: string;
}

const cor = (token: 'transparente' | keyof typeof colors) => (token === 'transparente' ? 'transparent' : colors[token]);

export function SinoNotificacoes({ total, onPress, sobreFaixa = true, accessibilityLabel, testID = 'sino' }: PropsSinoNotificacoes) {
  const c = coresDoSino(sobreFaixa);
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? leituraDoSino(total)}
      onPress={onPress}
      style={[s.botao, { backgroundColor: cor(c.botaoFundo), borderColor: cor(c.botaoBorda) }]}>
      <Icon name="bell" size={SINO.icone} color={cor(c.icone)} />
      {temNovoNoSino(total) ? <View testID={`${testID}-bolinha`} style={[s.bolinha, { backgroundColor: cor(c.bolinhaFundo), borderColor: cor(c.bolinhaAro) }]} /> : null}
    </Pressionavel>
  );
}

const s = StyleSheet.create({
  botao: { width: SINO.botao, height: SINO.botao, borderRadius: SINO.raio, borderWidth: SINO.borda, alignItems: 'center', justifyContent: 'center' },
  bolinha: { position: 'absolute', top: SINO.recuoBolinha, right: SINO.recuoBolinha, width: SINO.bolinha, height: SINO.bolinha, borderRadius: SINO.bolinha / 2, borderWidth: SINO.aroBolinha },
});
