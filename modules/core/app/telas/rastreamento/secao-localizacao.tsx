/**
 * Seção "Localização no expediente" do Perfil do Campo (T-0156; spec §2; RN-CORE-13): estado, pausa pessoal e os atalhos para "Meu trajeto" e
 * o termo. Aparece só com o rastreamento ligado e o aceite da versão vigente; sem aceite o aviso é a linha `AlertaTermoRastreamento` da área
 * Alertas (RN-VEN-42). O Perfil é do shell: ele monta esta seção depois do nome e antes de "Conta". Pausar e Retomar são um toque, sem
 * confirmação (só a pausa tem Desfazer no rodapé). testIDs: `localizacao.secao|estado|pausar|retomar|meu-trajeto|termo`.
 */
import { AvisoRodape, Botao, Cartao, ChipEstado, colors, fonte, Icon, LinhaAtalho, LinkTexto, SectionHeader, type TomEstado } from '@macuxi/ui/mobile';
import { router } from 'expo-router';
import { useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { PAUSA_MAX_MIN } from '../../../contracts';
import { leituraDaLocalizacao, ROTULO_DO_ESTADO } from '../../lib/rastreamento-local';
import { useRastreamento } from '../../lib/usar-rastreamento';

const TOM: Record<'ativa' | 'pausada' | 'fora' | 'sem_expediente', TomEstado> = { ativa: 'sucesso', pausada: 'aviso', fora: 'neutro', sem_expediente: 'neutro' };

export function SecaoLocalizacaoPerfil() {
  const r = useRastreamento();
  const [aviso, setAviso] = useState<string | null>(null);
  const e = r.localizacao;
  if (e.estado === 'oculta') return null;
    return (
    <View style={styles.secao} testID="localizacao.secao">
      <SectionHeader title="Localização" />
      <Cartao preenchimento={4}>
        <View style={styles.linha} accessible accessibilityLabel={leituraDaLocalizacao(e)} testID="localizacao.estado">
          <Icon name="pin" size={20} color={colors.accentInk} />
          <View style={styles.texto}>
            {e.apoio ? <Text style={styles.apoio}>{e.apoio}</Text> : null}
          </View>
          <ChipEstado texto={ROTULO_DO_ESTADO[e.estado]} tom={TOM[e.estado]} />
        </View>
      </Cartao>
      {e.acao === 'pausar' ? (
        <Botao
          rotulo={`Pausar por ${PAUSA_MAX_MIN} min`}
          rotuloAcessivel={`Pausar a localização por ${PAUSA_MAX_MIN} minutos`}
          onPress={() => void r.pausar().then(() => setAviso('Localização pausada'))}
          testID="localizacao.pausar"
        />
      ) : null}
      {e.acao === 'retomar' ? <Botao rotulo="Retomar" onPress={() => void r.retomar()} testID="localizacao.retomar" /> : null}
      <LinhaAtalho rotulo="Meu trajeto" icone="map" onPress={() => router.navigate('/m/meu-trajeto' as never)} testID="localizacao.meu-trajeto" />
      <LinhaAtalho rotulo="Termo de ciência" icone="file" onPress={() => router.navigate('/m/termo-rastreamento?leitura=1' as never)} testID="localizacao.termo" />
      <AvisoRodape
        visivel={aviso !== null}
        texto={aviso ?? ''}
        acao={{ rotulo: 'Desfazer', onPress: () => void r.desfazerPausa(), testID: 'localizacao.desfazer' }}
        onFechar={() => setAviso(null)}
      />
    </View>
  );
}

/** Linha da área Alertas do Perfil: só com o termo pendente (rastreamento ligado e sem aceite da versão vigente); "Ler" abre o termo. */
export function AlertaTermoRastreamento() {
  const r = useRastreamento();
  if (r.situacao !== 'pendente') return null;
  return (
    <View style={styles.alerta} testID="localizacao.alerta-termo">
      <Icon name="alert" size={18} color={colors.danger} />
      <Text style={styles.alertaTexto}>Termo de localização para confirmar</Text>
      <LinkTexto rotulo="Ler" onPress={() => router.navigate('/m/termo-rastreamento' as never)} testID="localizacao.ler-termo" />
    </View>
  );
}

const styles = StyleSheet.create({
  secao: { gap: 8 },
  linha: { flexDirection: 'row', alignItems: 'center', gap: 12, minHeight: 56, paddingHorizontal: 12 },
  texto: { flex: 1, minHeight: 20 },
  apoio: { ...fonte.body, fontSize: 16, color: colors.ink },
  alerta: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 44 },
  alertaTexto: { ...fonte.body, flex: 1, fontSize: 14, lineHeight: 19, color: colors.ink },
});
