/**
 * Folha do check-in: registra horário/local e confirma o início do atendimento.
 * O resultado da visita (com pedido / sem pedido + motivo) fica para o checkout (components/visit-sheets.tsx).
 */
import { useState } from 'react';
import { ActivityIndicator, StyleSheet, Text, TextInput, View } from 'react-native';

import { Botao, ChipEstado, colors, Folha, fonts, Icon, radius, space, type as t } from '@macuxi/ui/mobile';

export type CheckinPhase =
  | { kind: 'locating' }
  /** RN-CORE-10: fora do raio do cliente — a justificativa é obrigatória para registrar o check-in. */
  | { kind: 'justificar'; distancia_m: number; raio_m: number }
  | { kind: 'done'; visitId: string; at: string; gps: boolean; foraDoRaio?: boolean; sugereCoordenada?: boolean };

export function CheckinSheet({ phase, customerName, onClose, onJustificar }: { phase: CheckinPhase | null; customerName: string; onClose: () => void; onJustificar?: (texto: string) => void }) {
  const [texto, setTexto] = useState('');
  const localizando = phase?.kind === 'locating';
  // rodapé: depois do check-in, a folha só confirma e volta à ficha do cliente (o único "Novo pedido" fica lá)
  const rodape = phase?.kind === 'justificar' ? { rotulo: 'Cancelar', onPress: onClose, testID: 'checkin-cancelar' } : phase?.kind === 'done' ? { rotulo: 'Continuar', onPress: onClose, testID: 'checkin-abrir-ficha' } : undefined;
  return (
    <Folha visivel={phase !== null} onFechar={localizando ? () => undefined : onClose} rotuloFechar="Fechar" rotuloAcessivel="Check-in" rodape={rodape} evitarTeclado testID="checkin-sheet">
      {phase?.kind === 'locating' ? (
        <View style={{ alignItems: 'center', gap: space.md, paddingVertical: space.xxl }}>
          <ActivityIndicator color={colors.accent} />
          <Text style={t.sub}>Registrando check-in e localização…</Text>
        </View>
      ) : phase?.kind === 'justificar' ? (
        <View style={{ gap: space.md }} testID="checkin-justificar">
          <Text style={t.h2}>Você está longe do cliente</Text>
          <Text style={t.sub}>
            Você está a cerca de {phase.distancia_m.toLocaleString('pt-BR')} m de {customerName} (o limite é {phase.raio_m.toLocaleString('pt-BR')} m). Explique por que o atendimento é aqui; o gestor vê esta justificativa.
          </Text>
          <TextInput
            testID="checkin-justificativa"
            value={texto}
            onChangeText={setTexto}
            placeholder="Ex.: cliente atendeu no depósito ao lado"
            placeholderTextColor={colors.ink3}
            accessibilityLabel="Justificativa do check-in fora do raio"
            multiline
            maxLength={500}
            style={styles.input}
          />
          {texto.trim().length < 3 ? (
            <Text style={t.small} testID="checkin-justificativa-ajuda">
              Escreva pelo menos 3 letras
            </Text>
          ) : null}
          <Botao testID="checkin-confirmar-justificativa" nivel="principal" rotulo="Registrar check-in" desligado={texto.trim().length < 3} onPress={() => onJustificar?.(texto.trim())} />
        </View>
      ) : phase ? (
        <View style={{ gap: space.md }}>
          <View style={{ flexDirection: 'row', gap: space.md, alignItems: 'center' }}>
            <View style={styles.ok}>
              <Icon name="check" size={18} color={colors.success} strokeWidth={2.4} />
            </View>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={t.h2}>Check-in às {phase.at}</Text>
              <Text style={t.small} numberOfLines={2}>
                {customerName} · {phase.gps ? 'GPS do aparelho' : 'sem GPS neste check-in'}
              </Text>
            </View>
          </View>
          {phase.foraDoRaio ? <ChipEstado texto="Fora do raio · justificado" tom="aviso" /> : null}
        </View>
      ) : null}
    </Folha>
  );
}

const styles = StyleSheet.create({
  input: { minHeight: 72, borderRadius: radius.md, borderWidth: 1, borderColor: colors.lineStrong, backgroundColor: colors.surface, padding: space.md, fontFamily: fonts.body, fontSize: 15, color: colors.ink, textAlignVertical: 'top' },
  ok: { width: 40, height: 40, borderRadius: radius.md, backgroundColor: colors.successBg, alignItems: 'center', justifyContent: 'center' },
});
