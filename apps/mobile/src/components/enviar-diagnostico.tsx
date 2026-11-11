/**
 * T-0158 (v1.0.4): "Enviar diagnóstico" no Diagnóstico do Perfil. Botão + folha com "O que aconteceu?" (até 1000 caracteres,
 * com o aviso de dado pessoal), "Anexar print" opcional (galeria, JPEG 1600 px q80 sem EXIF, como as fotos do PDV) e o
 * resumo do que vai junto; depois do envio, "Enviado · nº 0042" ou "Na fila. Envia quando tiver sinal.". Embaixo, o
 * histórico dos últimos 10 envios com o protocolo. Tela provisória: a imagem e os textos finais são do designer-ux.
 * Regras e pacote em `lib/diagnostico-envio.ts`; fila e envio em `services/diagnostico.ts`.
 */
import type { DiagnosticoEnvio } from '@macuxi/platform-sdk';
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { Button, Card, colors, dateTimeLabel, Folha, fonts, radius, type as t } from '@macuxi/ui/mobile';
import { useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';

import { MAX_DESCRICAO_DIAGNOSTICO, resumoDoEnvio, rotuloDaOrigem, textoDaSituacao, TEXTOS_DIAGNOSTICO as T } from '@/lib/diagnostico-envio';
import { escolherFotoDaGaleria } from '@/services/camera';
import { uuid } from '@/services/device';
import { descartarPrint, enviarDiagnosticoDoBotao, montarDiagnosticoDoBotao, useDiagnosticos } from '@/services/diagnostico';

export function EnviarDiagnostico({ usuarioId, tenantId, tz }: { usuarioId: string; tenantId: string | null; tz: string }) {
  const { motor } = useMotorSync();
  const historico = useDiagnosticos(usuarioId, tenantId);
  const [aberta, setAberta] = useState(false);
  const [id, setId] = useState<string | null>(null);
  const [descricao, setDescricao] = useState('');
  const [print, setPrint] = useState<string | null>(null);
  const [previa, setPrevia] = useState<DiagnosticoEnvio | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [resultado, setResultado] = useState<string | null>(null);
  const [falha, setFalha] = useState<string | null>(null);
  const data = (iso: string) => dateTimeLabel(iso, new Date(), tz);

  const abrir = () => {
    // UUID gerado no aparelho quando a folha abre: tocar duas vezes em Enviar não duplica (idempotente pelo id)
    const novo = uuid();
    setId(novo);
    setDescricao('');
    setPrint(null);
    setResultado(null);
    setFalha(null);
    setPrevia(null);
    setAberta(true);
    void montarDiagnosticoDoBotao({ id: novo, motor, descricao: null, printId: null })
      .then(setPrevia)
      .catch(() => setPrevia(null));
  };

  const fechar = () => {
    // print anexado e não enviado: o arquivo gravado pela galeria sai do aparelho
    if (print && !resultado) void descartarPrint(print);
    setAberta(false);
  };

  const anexar = async () => {
    const foto = await escolherFotoDaGaleria().catch(() => null);
    if (!foto) return;
    if (print) void descartarPrint(print);
    setPrint(foto.id);
  };

  const enviar = async () => {
    if (!id || enviando) return;
    setEnviando(true);
    setFalha(null);
    try {
      const envio = await montarDiagnosticoDoBotao({ id, motor, descricao, printId: print });
      const r = await enviarDiagnosticoDoBotao(envio, { usuarioId, tenantId });
      setResultado(r ? textoDaSituacao(r) : T.naFila);
    } catch {
      setFalha('Não foi possível montar o diagnóstico. Tente de novo.');
    } finally {
      setEnviando(false);
    }
  };

  return (
    <View style={{ gap: 8 }}>
      <Button testID="diagnostico-enviar" label={T.botao} icon="send" variant="outline" onPress={abrir} />
      {historico.length > 0 ? (
        <Card testID="diagnostico-historico" style={{ padding: 14, gap: 8 }}>
          <Text style={t.bodyStrong}>{T.historico}</Text>
          {historico.map((r) => (
            <View key={r.id} testID={`diagnostico-${r.id}`} style={{ gap: 2 }}>
              <Text style={t.small}>
                {rotuloDaOrigem(r.envio.origem)} · {data(r.criado_em)}
              </Text>
              <Text style={[t.smallStrong, { color: r.situacao === 'falhou' ? colors.danger : r.situacao === 'enviado' ? colors.ink : colors.warning }]}>
                {textoDaSituacao(r)}
              </Text>
            </View>
          ))}
        </Card>
      ) : null}

      <Folha
        visivel={aberta}
        onFechar={fechar}
        rotuloFechar={T.fechar}
        titulo={T.titulo}
        fechar={{ rotulo: T.fechar, testID: 'diagnostico-fechar' }}
        evitarTeclado
        testID="diagnostico-folha"
      >
        {resultado ? (
          <View style={{ gap: 12, paddingBottom: 16 }}>
            <Text testID="diagnostico-resultado" style={t.bodyStrong}>
              {resultado}
            </Text>
            <Button testID="diagnostico-ok" label={T.fechar} variant="dark" onPress={() => setAberta(false)} />
          </View>
        ) : (
          <View style={{ gap: 10, paddingBottom: 16 }}>
            <Text style={t.bodyStrong}>{T.pergunta}</Text>
            <TextInput
              testID="diagnostico-descricao"
              value={descricao}
              onChangeText={setDescricao}
              maxLength={MAX_DESCRICAO_DIAGNOSTICO}
              multiline
              textAlignVertical="top"
              style={styles.campo}
              accessibilityLabel={T.pergunta}
            />
            <Text style={t.small}>
              {T.aviso} {descricao.length}/{MAX_DESCRICAO_DIAGNOSTICO}
            </Text>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Button testID="diagnostico-anexar" label={print ? T.trocar : T.anexar} icon="galeria" variant="outline" style={{ flex: 1 }} onPress={() => void anexar()} />
              {print ? (
                <Button
                  testID="diagnostico-remover-print"
                  label={T.remover}
                  variant="ghost"
                  onPress={() => {
                    void descartarPrint(print);
                    setPrint(null);
                  }}
                />
              ) : null}
            </View>
            {previa ? (
              <View testID="diagnostico-resumo" style={{ gap: 2 }}>
                <Text style={t.smallStrong}>{T.vaiJunto}</Text>
                <Text style={styles.mono}>{resumoDoEnvio({ ...previa, print_id: print }, data).join('\n')}</Text>
              </View>
            ) : null}
            {falha ? <Text style={[t.small, { color: colors.danger }]}>{falha}</Text> : null}
            <Button testID="diagnostico-confirmar" label={T.enviar} icon="send" variant="accent" loading={enviando} disabled={!id} onPress={() => void enviar()} />
          </View>
        )}
      </Folha>
    </View>
  );
}

const styles = StyleSheet.create({
  campo: { minHeight: 96, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, padding: 12, fontFamily: fonts.body, fontSize: 14, color: colors.ink, backgroundColor: colors.surface },
  mono: { fontFamily: fonts.mono, fontSize: 12, color: colors.ink2 },
});
