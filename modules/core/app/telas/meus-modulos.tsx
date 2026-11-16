/**
 * "Meus módulos" (RF-CORE-02; RN-CORE-01/02). Lê do aparelho (offline-first): os módulos efetivos gravados no
 * último sync. Online, atualiza as versões com `GET /v1/me/modulos` e guarda para a próxima vez sem sinal.
 * Também mostra o que ficou "Não enviado — módulo desativado" e libera apagar os dados locais só depois do "Entendi".
 * testIDs: docs/modulos/core/test-ids.md. Alvos de toque >= 48 dp.
 */
import { ehSemConexao, type ModuloId } from '@macuxi/platform-sdk';
import { useHttp, useMotorSync } from '@macuxi/platform-sdk/react';
import { Banner, Botao, Cartao, ChipEstado, colors, fonte, Screen, SectionHeader, type as t } from '@macuxi/ui/mobile';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { ROTULO_NAO_ENVIADO } from '../../domain';
import { CHAVE_VERSOES, itensNaoEnviadosPorModulo, linhasMeusModulos, podeConfirmarLimpeza, soTemOCore, versoesDaResposta } from '../lib/meus-modulos';

type Versoes = Partial<Record<ModuloId, string>>;

export function TelaMeusModulos() {
  const { motor, estado } = useMotorSync();
  const http = useHttp();
  const [versoes, setVersoes] = useState<Versoes>({});
  const [aviso, setAviso] = useState<string | null>(null);
  const armazem = useMemo(() => motor?.armazenamentoDoModulo('core') ?? null, [motor]);

  // 1) o que já está no aparelho; 2) se houver sinal, atualiza as versões e guarda
  useEffect(() => {
    let vivo = true;
    void (async () => {
      const guardadas = armazem ? await armazem.ler<Versoes>(CHAVE_VERSOES) : null;
      if (vivo && guardadas) setVersoes(guardadas);
      try {
        const v = versoesDaResposta(await http.get<unknown>('/me/modulos'));
        if (!vivo || Object.keys(v).length === 0) return;
        setVersoes(v);
        await armazem?.gravar(CHAVE_VERSOES, v);
      } catch (e) {
        if (!ehSemConexao(e)) setAviso('Não deu para conferir as versões agora. Os módulos abaixo são os do último sync.');
      }
    })();
    return () => {
      vivo = false;
    };
  }, [armazem, http, estado.sincronizado_em]);

  const atualizar = useCallback(() => {
    setAviso(null);
    void motor?.sincronizar();
  }, [motor]);

  const ativos = estado.modulosAtivos.length > 0 ? estado.modulosAtivos : (['core'] as ModuloId[]);
  const linhas = linhasMeusModulos(ativos, versoes);
  const naoEnviados = itensNaoEnviadosPorModulo(estado.fila);

  return (
    <Screen
      refreshing={estado.sincronizando}
      onRefresh={atualizar}
      testID="meus-modulos.tela"
      cabecalho={{ titulo: 'Meus módulos', subtitulo: 'O que está liberado para você' }}>

      {aviso ? <Banner testID="meus-modulos.aviso">{aviso}</Banner> : null}
      {estado.erro ? <Banner tone="danger">{estado.erro}</Banner> : null}

      <Cartao preenchimento={4} testID="meus-modulos.lista">
        {linhas.map((l, i) => (
          <View key={l.modulo} style={[styles.linha, i > 0 && styles.divisor]} testID={`meus-modulos.item.${l.modulo}`}>
            <Text style={styles.nome}>{l.modulo}</Text>
            <Text style={styles.versao} testID={`meus-modulos.versao.${l.modulo}`}>
              {l.versao}
            </Text>
          </View>
        ))}
      </Cartao>

      {soTemOCore(ativos) ? (
        <Text style={t.sub} testID="meus-modulos.vazio">
          Só o módulo básico está ativo. Peça ao administrador da sua empresa para liberar os outros módulos.
        </Text>
      ) : null}

      <Botao testID="meus-modulos.atualizar" nivel="principal" rotulo="Atualizar agora" icone="sync" ocupado={estado.sincronizando} onPress={atualizar} />

      {naoEnviados.length > 0 || estado.limpezaPendente.length > 0 ? (
        <View style={{ gap: 8 }}>
          <SectionHeader title="Não enviado" />
          {naoEnviados.map((i) => (
            <Cartao key={i.id} preenchimento={12} gap={4} testID={`sync.item-nao-enviado.${i.id}`}>
              <Text style={t.bodyStrong}>{i.rotulo || i.entidade}</Text>
              {i.detalhe ? <Text style={t.small}>{i.detalhe}</Text> : null}
              <ChipEstado pequeno tom="aviso" texto={ROTULO_NAO_ENVIADO} />
            </Cartao>
          ))}
          {estado.limpezaPendente
            .filter((m) => podeConfirmarLimpeza(m, estado.limpezaPendente, estado.fila))
            .map((m) => (
              <Cartao key={m} preenchimento={12} gap={8}>
                <Text style={t.sub}>O módulo {m} foi desativado. Os dados dele neste aparelho só são apagados depois que você confirmar que viu o que não foi enviado.</Text>
                <Botao testID={`sync.confirmar-modulo-desativado.${m}`} nivel="secundario" alto rotulo="Entendi" onPress={() => void motor?.confirmarLimpeza(m)} />
              </Cartao>
            ))}
        </View>
      ) : null}
    </Screen>
  );
}

const styles = StyleSheet.create({
  linha: { minHeight: 52, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 12, gap: 8 },
  divisor: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.line },
  nome: { ...fonte.semibold, fontSize: 16, color: colors.ink, textTransform: 'capitalize' },
  versao: { ...fonte.body, fontSize: 14, color: colors.ink2 },
});
