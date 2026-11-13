/**
 * T-0165 (docs/design/pedido-v4.md §5.7; R-20261112-031456, regras 2 e 3): o "Desc./Acrésc. geral" no topo da aba Itens. Tipo (só Desc % e
 * Acrésc %), valor e Aplicar, que copia o % para todos os itens. A pergunta (RD-0148) só aparece quando algum item tem ajuste diferente.
 * A conta e as regras vêm de `domain/desconto-geral`; aqui só desenha.
 */
import { Botao, DescontoCompacto, Dialogo, RotuloSecao, sanearDecimal, TIPOS_AJUSTE } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { View } from 'react-native';

import { perguntaDoGeral, podeAplicarGeral, type AjusteGeral } from '../../domain/desconto-geral';
import { valorDoTexto } from '../lib/ajuste-pedido';

const TIPOS_DO_GERAL = TIPOS_AJUSTE.filter((o) => o.id === 'desc_pct' || o.id === 'acresc_pct');

export function DescontoGeral({ contarDiferentes, contarComOutroAjuste, semItens, aoAplicar }: { contarDiferentes: (g: AjusteGeral) => number; contarComOutroAjuste: (g: AjusteGeral) => number; semItens: boolean; aoAplicar: (g: AjusteGeral) => void }) {
  const [tipo, setTipo] = useState<'desc_pct' | 'acresc_pct'>('desc_pct');
  const [texto, setTexto] = useState('');
  const [pergunta, setPergunta] = useState<AjusteGeral | null>(null);
  const geral: AjusteGeral = { sentido: tipo === 'acresc_pct' ? 'acrescimo' : 'desconto', pct: valorDoTexto(tipo, texto) };
  const diferentes = contarDiferentes(geral);
  const pode = podeAplicarGeral(texto, diferentes, semItens);
  const textoDaPergunta = pergunta ? perguntaDoGeral(pergunta, contarComOutroAjuste(pergunta)) : null;
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
