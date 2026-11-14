/**
 * T-0165 (docs/design/pedido-v4.md §5.7; R-20261112-031456, regras 2 e 3): o "Desc./Acrésc. geral" no topo da aba Itens. Tipo (só Desc % e
 * Acrésc %), valor e Aplicar, que copia o % para todos os itens. A pergunta (RD-0148) só aparece quando algum item tem ajuste diferente.
 * "−" e "+" compactos junto do valor (dono do produto, 14/11): passo de `passoDoGeral` (1 ponto em %), na altura do campo.
 * A conta e as regras vêm de `domain/desconto-geral`; aqui só desenha.
 */
import { Botao, colors, DESCONTO_COMPACTO, DescontoCompacto, Dialogo, Icon, RotuloSecao, sanearDecimal, TIPOS_AJUSTE } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';

import { passoDoGeral, perguntaDoGeral, podeAplicarGeral, type AjusteGeral } from '../../domain/desconto-geral';
import { textoDoAjuste, valorDoTexto } from '../lib/ajuste-pedido';

const TIPOS_DO_GERAL = TIPOS_AJUSTE.filter((o) => o.id === 'desc_pct' || o.id === 'acresc_pct');

export function DescontoGeral({ contarDiferentes, contarComOutroAjuste, semItens, aoAplicar }: { contarDiferentes: (g: AjusteGeral) => number; contarComOutroAjuste: (g: AjusteGeral) => number; semItens: boolean; aoAplicar: (g: AjusteGeral) => void }) {
  const [tipo, setTipo] = useState<'desc_pct' | 'acresc_pct'>('desc_pct');
  const [texto, setTexto] = useState('');
  const [pergunta, setPergunta] = useState<AjusteGeral | null>(null);
  const geral: AjusteGeral = { sentido: tipo === 'acresc_pct' ? 'acrescimo' : 'desconto', pct: valorDoTexto(tipo, texto) };
  const diferentes = contarDiferentes(geral);
  const pode = podeAplicarGeral(texto, diferentes, semItens);
  const textoDaPergunta = pergunta ? perguntaDoGeral(pergunta, contarComOutroAjuste(pergunta)) : null;
  const tocar = (direcao: -1 | 1) => {
    const novo = passoDoGeral(valorDoTexto(tipo, texto), direcao, 'pct');
    setTexto(novo > 0 ? textoDoAjuste(tipo, novo) : '0');
  };
  const aplicar = () => {
    if (perguntaDoGeral(geral, contarComOutroAjuste(geral)) === null) aoAplicar(geral);
    else setPergunta(geral);
  };
  return (
    <View style={{ gap: 8 }} testID="desconto-geral">
      <RotuloSecao texto="Desc./Acrésc. geral" />
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <DescontoCompacto
          testID="desconto-geral-campo"
          style={{ flex: 1 }}
          tipos={TIPOS_DO_GERAL}
          tipo={tipo}
          onChangeTipo={(novo) => setTipo(novo === 'acresc_pct' ? 'acresc_pct' : 'desc_pct')}
          texto={texto}
          onChangeTexto={(v) => setTexto(sanearDecimal(v, 2))}
          equivalente={null}
          placeholder="0"
          rotuloAcessivel="Percentual do desconto ou acréscimo geral"
          rotuloTipo="Tipo do ajuste geral"
          rotuloFechar="Fechar a lista"
        />
        <BotaoDoGeral icone="minus" rotulo="Diminuir 1 ponto do ajuste geral" desligado={geral.pct <= 0} onPress={() => tocar(-1)} testID="desconto-geral-menos" />
        <BotaoDoGeral icone="plus" rotulo="Aumentar 1 ponto do ajuste geral" desligado={geral.pct >= 100} onPress={() => tocar(1)} testID="desconto-geral-mais" />
        <Botao testID="desconto-geral-aplicar" nivel="secundario" rotulo="Aplicar" rotuloAcessivel="Aplicar a todos os itens" desligado={!pode} onPress={aplicar} />
      </View>
      <Dialogo
        visivel={textoDaPergunta !== null}
        titulo={textoDaPergunta?.titulo ?? ''}
        cancelar={{ rotulo: textoDaPergunta?.voltar ?? 'Voltar', onPress: () => setPergunta(null), testID: 'geral-voltar' }}
        confirmar={{
          rotulo: textoDaPergunta?.confirmar ?? 'Trocar',
          testID: 'geral-trocar',
          onPress: () => {
            const g = pergunta;
            setPergunta(null);
            if (g) aoAplicar(g);
          },
        }}
        testID="pergunta-geral"
      />
    </View>
  );
}

/** Botão "−"/"+" compacto: 36 dp de largura na altura do campo (44 dp); a folga de toque leva o alvo a 48 dp. */
function BotaoDoGeral({ icone, rotulo, desligado, onPress, testID }: { icone: 'minus' | 'plus'; rotulo: string; desligado: boolean; onPress: () => void; testID: string }) {
  return (
    <Pressable
      testID={testID}
      accessibilityRole="button"
      accessibilityLabel={rotulo}
      accessibilityState={{ disabled: desligado }}
      disabled={desligado}
      onPress={onPress}
      hitSlop={{ top: 2, bottom: 2, left: 6, right: 6 }}
      style={({ pressed }) => [s.botao, pressed && s.botaoApertado, desligado && s.botaoDesligado]}>
      <Icon name={icone} size={18} color={desligado ? colors.ink3 : colors.ink} />
    </Pressable>
  );
}

const s = StyleSheet.create({
  botao: { width: 36, height: DESCONTO_COMPACTO.altura, borderRadius: 10, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
  botaoApertado: { backgroundColor: colors.lineSoft },
  botaoDesligado: { borderColor: colors.line },
});
