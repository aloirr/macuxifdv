/**
 * Campo de uma pergunta no formulário do app (RF-PES-01: os nove tipos). Alvos de toque de 48 dp; erro em português
 * embaixo do campo. A validação de verdade é do domain (`prepararEnvio`); aqui só a entrada e a conversão de formato.
 * Visual T-0072: Cartao por pergunta, chip "Obrigatória", opções com Pressionavel, foto com Botao secundário e
 * remoção com Desfazer (AvisoRodape do ResponderScreen via `avisar`).
 */
import { BotaoIcone, Botao, Cartao, ChipEstado, colors, fonte, Icon, Pressionavel, radius, type EstadoAviso, type as t } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';
import { StyleSheet, Text, TextInput, View } from 'react-native';
import type { FotoResposta, ItemResposta, Pergunta } from '../../contracts';
import { dataBr, lerData, lerNumero } from '../lib/entrada';
import { capturaDisponivel, capturarFotoPesquisa } from '../lib/foto';

const ALVO = 48;

export interface PropsCampo {
  pergunta: Pergunta;
  item: ItemResposta | undefined;
  ordem: number;
  erro?: string;
  agora: () => Date;
  onResponder: (item: ItemResposta) => void;
  onLimpar: () => void;
  /** Mostra o aviso no rodapé da tela (ex.: "Foto removida" com Desfazer). */
  avisar?: (aviso: EstadoAviso) => void;
}

function Opcao({ rotulo, marcada, onPress, testID, multipla }: { rotulo: string; marcada: boolean; onPress: () => void; testID: string; multipla?: boolean }) {
  return (
    <Pressionavel
      testID={testID}
      accessibilityRole={multipla ? 'checkbox' : 'radio'}
      accessibilityState={{ checked: marcada }}
      accessibilityLabel={rotulo}
      onPress={onPress}
      style={[estilos.opcao, marcada && estilos.opcaoMarcada]}>
      <View style={[multipla ? estilos.caixa : estilos.radio, marcada && estilos.marcaAtiva]} />
      <Text style={[t.body, { flex: 1 }]}>{rotulo}</Text>
    </Pressionavel>
  );
}


function CampoTexto({ valorInicial, teclado, placeholder, multilinha, onTexto, testID }: { valorInicial: string; teclado?: 'numeric' | 'default'; placeholder: string; multilinha?: boolean; onTexto: (s: string) => void; testID: string }) {
  const [texto, setTexto] = useState(valorInicial);
  useEffect(() => setTexto(valorInicial), [valorInicial]);
  return (
    <TextInput
      testID={testID}
      value={texto}
      placeholder={placeholder}
      placeholderTextColor={colors.ink3}
      keyboardType={teclado === 'numeric' ? 'decimal-pad' : 'default'}
      multiline={multilinha}
      onChangeText={(s) => {
        setTexto(s);
        onTexto(s);
      }}
      style={[estilos.entrada, multilinha && { minHeight: 96, textAlignVertical: 'top' }]}
    />
  );
}

export function CampoPergunta({ pergunta: p, item, ordem, erro, agora, onResponder, onLimpar, avisar }: PropsCampo) {
  const id = p.id;
  const tid = (s: string) => `pesquisa.pergunta-${ordem}.${s}`;
  let corpo: React.ReactNode = null;

  switch (p.tipo) {
    case 'sim_nao': {
      const v = item?.tipo === 'sim_nao' ? item.valor : undefined;
      corpo = (
        <View style={estilos.linha}>
          {[true, false].map((b) => (
            <Pressionavel
              key={String(b)}
              testID={tid(b ? 'sim' : 'nao')}
              accessibilityRole="radio"
              accessibilityState={{ checked: v === b }}
              onPress={() => onResponder({ pergunta_id: id, tipo: 'sim_nao', valor: b })}
              style={[estilos.botaoMetade, v === b && estilos.opcaoMarcada]}>
              <Text style={t.bodyStrong}>{b ? 'Sim' : 'Não'}</Text>
            </Pressionavel>
          ))}
        </View>
      );
      break;
    }
    case 'unica': {
      const v = item?.tipo === 'unica' ? item.opcao_id : undefined;
      corpo = p.opcoes.map((o, i) => <Opcao key={o.id} testID={tid(`opcao-${i + 1}`)} rotulo={o.rotulo} marcada={v === o.id} onPress={() => onResponder({ pergunta_id: id, tipo: 'unica', opcao_id: o.id })} />);
      break;
    }
    case 'multipla': {
      const marcadas = item?.tipo === 'multipla' ? item.opcao_ids : [];
      corpo = p.opcoes.map((o, i) => (
        <Opcao
          key={o.id}
          multipla
          testID={tid(`opcao-${i + 1}`)}
          rotulo={o.rotulo}
          marcada={marcadas.includes(o.id)}
          onPress={() => {
            const novas = marcadas.includes(o.id) ? marcadas.filter((x) => x !== o.id) : [...marcadas, o.id];
            onResponder({ pergunta_id: id, tipo: 'multipla', opcao_ids: novas });
          }}
        />
      ));
      break;
    }
    case 'numero': {
      const v = item?.tipo === 'numero' ? String(item.numero).replace('.', ',') : '';
      corpo = (
        <CampoTexto
          testID={tid('numero')}
          valorInicial={v}
          teclado="numeric"
          placeholder={p.unidade ? `Número (${p.unidade})` : 'Número'}
          onTexto={(s) => {
            const n = lerNumero(s);
            if (n === null) onLimpar();
            else onResponder({ pergunta_id: id, tipo: 'numero', numero: n });
          }}
        />
      );
      break;
    }
    case 'texto':
      corpo = <CampoTexto testID={tid('texto')} multilinha valorInicial={item?.tipo === 'texto' ? item.texto : ''} placeholder="Escreva aqui" onTexto={(s) => onResponder({ pergunta_id: id, tipo: 'texto', texto: s })} />;
      break;
    case 'escala': {
      const v = item?.tipo === 'escala' ? item.valor : undefined;
      const pontos: number[] = [];
      for (let n = p.minimo; n <= p.maximo; n++) pontos.push(n);
      corpo = (
        <View style={{ gap: 6 }}>
          <View style={[estilos.linha, { flexWrap: 'wrap' }]}>
            {pontos.map((n) => (
              <Pressionavel key={n} testID={tid(`escala-${n}`)} accessibilityRole="radio" accessibilityState={{ checked: v === n }} onPress={() => onResponder({ pergunta_id: id, tipo: 'escala', valor: n })} style={[estilos.ponto, v === n && estilos.opcaoMarcada]}>
                <Text style={t.bodyStrong}>{n}</Text>
              </Pressionavel>
            ))}
          </View>
          {p.rotulo_minimo || p.rotulo_maximo ? (
            <View style={[estilos.linha, { justifyContent: 'space-between' }]}>
              <Text style={t.small}>{p.rotulo_minimo ?? ''}</Text>
              <Text style={t.small}>{p.rotulo_maximo ?? ''}</Text>
            </View>
          ) : null}
        </View>
      );
      break;
    }
    case 'data':
      corpo = (
        <CampoTexto
          testID={tid('data')}
          valorInicial={item?.tipo === 'data' ? dataBr(item.data) : ''}
          teclado="numeric"
          placeholder="DD/MM/AAAA"
          onTexto={(s) => {
            const d = lerData(s);
            if (d === null) onLimpar();
            else onResponder({ pergunta_id: id, tipo: 'data', data: d });
          }}
        />
      );
      break;
    case 'foto': {
      const fotos: FotoResposta[] = item?.tipo === 'foto' ? item.fotos : [];
      const tirar = async () => {
        const f = await capturarFotoPesquisa();
        if (!f) return;
        const nova: FotoResposta = { id: f.id, referencia: f.id, capturada_em: agora().toISOString(), ...(f.largura_px ? { largura_px: f.largura_px } : {}), ...(f.altura_px ? { altura_px: f.altura_px } : {}) };
        onResponder({ pergunta_id: id, tipo: 'foto', fotos: [...fotos, nova] });
      };
      corpo = (
        <View style={{ gap: 8 }}>
          {fotos.map((f, i) => (
            <View key={f.id} style={[estilos.linha, { justifyContent: 'space-between' }]}>
              <View style={estilos.linha}>
                <Text style={t.body}>Foto {i + 1}</Text>
                <ChipEstado pequeno tom="sucesso" icone="check" texto="Tirada" />
              </View>
              <BotaoIcone
                testID={tid(`foto-remover-${i + 1}`)}
                icone="trash"
                cor={colors.danger}
                tamanho={40}
                rotuloAcessivel={`Remover foto ${i + 1}`}
                onPress={() => {
                  onResponder({ pergunta_id: id, tipo: 'foto', fotos: fotos.filter((x) => x.id !== f.id) });
                  avisar?.({ texto: 'Foto removida', acao: { rotulo: 'Desfazer', onPress: () => onResponder({ pergunta_id: id, tipo: 'foto', fotos }) } });
                }}
              />
            </View>
          ))}
          {capturaDisponivel() ? (
            fotos.length < p.max_fotos ? (
              <Botao testID={tid('foto-tirar')} rotulo={fotos.length ? 'Tirar outra' : 'Tirar foto'} icone="camera" onPress={() => void tirar()} />
            ) : (
              <Text style={t.small}>{p.max_fotos === 1 ? 'Limite de 1 foto' : `Limite de ${p.max_fotos} fotos`}</Text>
            )
          ) : (
            <Text style={t.small}>Câmera indisponível. Atualize o app.</Text>
          )}
        </View>
      );
      break;
    }
    case 'codigo_barras':
      corpo = <CampoTexto testID={tid('codigo')} valorInicial={item?.tipo === 'codigo_barras' ? item.codigo : ''} teclado="numeric" placeholder="Digite o código de barras" onTexto={(s) => onResponder({ pergunta_id: id, tipo: 'codigo_barras', codigo: s })} />;
      break;
  }

  return (
    <Cartao testID={`pesquisa.pergunta-${ordem}`} gap={10} style={erro ? { borderColor: colors.danger } : undefined}>
      <Text style={t.title16}>
        {ordem}. {p.enunciado}
      </Text>
      {p.obrigatoria ? <ChipEstado pequeno tom="neutro" texto="Obrigatória" /> : null}
      {p.ajuda ? <Text style={t.small}>{p.ajuda}</Text> : null}
      <View style={{ gap: 8 }}>{corpo}</View>
      {erro ? (
        <View style={estilos.linha}>
          <Icon name="alert" size={14} color={colors.danger} />
          <Text style={[t.small, { color: colors.danger, flex: 1 }]} testID={tid('erro')}>
            {erro}
          </Text>
        </View>
      ) : null}
    </Cartao>
  );
}

const estilos = StyleSheet.create({
  linha: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  opcao: { minHeight: ALVO, flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 12, borderWidth: 1, borderColor: colors.line, borderRadius: radius.md, backgroundColor: colors.surface },
  opcaoMarcada: { borderColor: colors.accentLine, backgroundColor: colors.accentSoft },
  radio: { width: 20, height: 20, borderRadius: 10, borderWidth: 2, borderColor: colors.lineStrong },
  caixa: { width: 20, height: 20, borderRadius: 4, borderWidth: 2, borderColor: colors.lineStrong },
  marcaAtiva: { borderColor: colors.accent, backgroundColor: colors.accent },
  botaoMetade: { flex: 1, minHeight: ALVO, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  ponto: { width: ALVO, height: ALVO, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: colors.line, borderRadius: radius.md },
  entrada: { minHeight: ALVO, borderWidth: 1, borderColor: colors.lineStrong, borderRadius: radius.md, paddingHorizontal: 12, ...fonte.body, fontSize: 16, color: colors.ink },
});
