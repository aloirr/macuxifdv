/**
 * Responder pesquisa (RF-PES-01/04, RN-PES-01): formulário da versão vigente quando abre, rascunho salvo a cada toque
 * no aparelho, regras condicionais aplicadas na hora e envio pela fila do motor (funciona sem sinal).
 * Parâmetros: `questionario` (obrigatório), `cliente` e `visita` (pesquisa do cliente ou da etapa do checkout).
 * Visual T-0072: progresso com chips, um só principal ("Enviar resposta") que abre Folha de confirmação (resposta é
 * imutável), descartar com Dialogo, AvisoRodape para o Desfazer da foto, estados com EstadoVazio.
 */
import { AvisoRodape, BackLink, Banner, Botao, ChipEstado, Dialogo, EstadoVazio, Folha, Icon, Loading, OpcaoFolha, ProgressBar, Screen, colors, type as t, useAvisoRodape } from '@macuxi/ui/mobile';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { ItemResposta, QuestionarioVersao } from '../../contracts';
import { CampoPergunta } from '../components/campo-pergunta';
import { camposVisiveis, chaveDoRascunho, errosPorPergunta, novoRascunho, prepararEnvio, progresso, responder, type RascunhoResposta } from '../lib/formulario';
import { hrefPesquisas } from '../rotas';
import { usePesquisa } from '../state/use-pesquisa';

export default function ResponderScreen() {
  const params = useLocalSearchParams<{ questionario?: string; cliente?: string; visita?: string }>();
  const questionarioId = params.questionario ?? '';
  const contexto = useMemo(() => ({ cliente_id: params.cliente || null, visita_id: params.visita || null }), [params.cliente, params.visita]);
  const { carregado, versaoPara, lerRascunho, gravarRascunho, apagarRascunho, enviar, novoId, agora, offline, parametros } = usePesquisa();
  const aviso = useAvisoRodape();

  // RN-PES-01: a versão fica fixa enquanto o formulário está aberto (a resposta cita a versão que o usuário viu)
  const [versao, setVersao] = useState<QuestionarioVersao | null>(null);
  const [rascunho, setRascunho] = useState<RascunhoResposta | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
  const [confirmando, setConfirmando] = useState(false);
  const [descartando, setDescartando] = useState(false);
  const chave = chaveDoRascunho(questionarioId, contexto);
  const iniciou = useRef(false);

  useEffect(() => {
    if (!carregado || iniciou.current) return;
    iniciou.current = true;
    void (async () => {
      const salvo = await lerRascunho(chave);
      const vigente = versaoPara(questionarioId);
      // rascunho de uma versão que saiu do aparelho é descartado; o de versão ainda válida continua
      const v = salvo ? (salvo.versao_id === vigente?.id ? vigente : null) : vigente;
      if (!v) {
        setVersao(vigente);
        if (vigente) setRascunho(novoRascunho({ id: novoId(), versao: vigente, ...contexto, agora: agora().toISOString() }));
        return;
      }
      setVersao(v);
      setRascunho(salvo ?? novoRascunho({ id: novoId(), versao: v, ...contexto, agora: agora().toISOString() }));
    })();
  }, [carregado, chave, contexto, lerRascunho, versaoPara, questionarioId, novoId, agora]);

  const alterar = useCallback(
    (fn: (r: RascunhoResposta) => RascunhoResposta) => {
      setRascunho((atual) => {
        if (!atual) return atual;
        const novo = fn(atual);
        void gravarRascunho(chave, novo); // RF-PES-04: salvamento automático
        return novo;
      });
      setMensagem(null);
    },
    [chave, gravarRascunho],
  );

  const onResponder = useCallback((it: ItemResposta) => alterar((r) => responder(r, it)), [alterar]);
  const onLimpar = useCallback((perguntaId: string) => alterar((r) => ({ ...r, itens: r.itens.filter((i) => i.pergunta_id !== perguntaId) })), [alterar]);

  /** 1º toque: valida no aparelho; passando, pede a confirmação (a resposta não volta atrás). */
  const pedirEnvio = () => {
    if (!versao || !rascunho) return;
    const p = prepararEnvio(versao, rascunho, { agora: agora().toISOString(), parametros });
    if (!p.ok) {
      setErros(errosPorPergunta(p.erros));
      setMensagem(p.erros[0]?.mensagem ?? 'Confira as respostas destacadas.');
      return;
    }
    setErros({});
    setMensagem(null);
    setConfirmando(true);
  };

  const concluir = async () => {
    if (!versao || !rascunho) return;
    setConfirmando(false);
    setEnviando(true);
    try {
      const p = await enviar(versao, chave, rascunho);
      if (!p.ok) {
        setErros(errosPorPergunta(p.erros));
        setMensagem(p.erros[0]?.mensagem ?? 'Confira as respostas destacadas.');
        return;
      }
      setErros({});
      setEnviada(true);
    } finally {
      setEnviando(false);
    }
  };

  const descartar = async () => {
    setDescartando(false);
    await apagarRascunho(chave);
    if (router.canGoBack()) router.back();
    else router.replace(hrefPesquisas() as never);
  };

  const voltar = () => (router.canGoBack() ? router.back() : router.replace(hrefPesquisas() as never));

  if (!carregado) return <Loading />;
  if (!versao || !rascunho) {
    return (
      <Screen testID="pesquisa.responder">
        <BackLink label="Pesquisas" fallback={hrefPesquisas()} />
        <EstadoVazio icone="clipboard" titulo="Pesquisa indisponível" texto="Sincronize e tente de novo." acao={{ rotulo: 'Voltar', onPress: voltar }} testID="pesquisa.indisponivel" />
      </Screen>
    );
  }

  if (enviada) {
    return (
      <Screen testID="pesquisa.responder">
        <View style={{ alignItems: 'center', gap: 10, paddingTop: 24 }} testID="pesquisa.enviada">
          <Icon name="check" size={32} color={colors.success} />
          <Text style={t.h1}>Resposta registrada</Text>
          {offline ? <ChipEstado tom="aviso" icone="wifiOff" texto="Na fila" /> : <ChipEstado tom="sucesso" icone="check" texto="Registrada" />}
          {offline ? <Text style={t.sub}>Vai quando o sinal voltar</Text> : null}
        </View>
        <Botao testID="pesquisa.voltar" rotulo="Voltar" onPress={voltar} />
      </Screen>
    );
  }

  const campos = camposVisiveis(versao, rascunho);
  const pr = progresso(versao, rascunho);
  const pct = pr.visiveis > 0 ? Math.round((pr.respondidas / pr.visiveis) * 100) : 0;

  return (
    <View style={{ flex: 1 }}>
      <Screen testID="pesquisa.responder">
        <BackLink label="Pesquisas" fallback={hrefPesquisas()} />
        <View style={{ gap: 8 }}>
          <Text style={t.h1Small}>{versao.titulo}</Text>
          {versao.descricao ? <Text style={t.sub}>{versao.descricao}</Text> : null}
          <ProgressBar pct={pct} />
          <View style={{ flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', gap: 8 }}>
            <Text style={t.bodyStrong} testID="pesquisa.progresso">
              {pr.respondidas} de {pr.visiveis}
            </Text>
            {pr.obrigatorias_faltando > 0 ? (
              <ChipEstado tom="aviso" texto={pr.obrigatorias_faltando === 1 ? 'Falta 1 obrigatória' : `Faltam ${pr.obrigatorias_faltando} obrigatórias`} />
            ) : (
              <ChipEstado tom="sucesso" icone="check" texto="Pronta para enviar" />
            )}
            <ChipEstado tom="neutro" texto="Salvo no aparelho" />
          </View>
        </View>

        {campos.map((c) => (
          <CampoPergunta key={c.pergunta.id} pergunta={c.pergunta} item={c.item} ordem={c.ordem} erro={erros[c.pergunta.id]} agora={agora} onResponder={onResponder} onLimpar={() => onLimpar(c.pergunta.id)} avisar={aviso.mostrar} />
        ))}

        {mensagem ? (
          <Banner tone="danger" icon="alert" testID="pesquisa.erro">
            {mensagem}
          </Banner>
        ) : null}
        <Botao testID="pesquisa.enviar" nivel="principal" rotulo="Enviar resposta" icone="send" ocupado={enviando} onPress={pedirEnvio} />
        <Botao testID="pesquisa.descartar" nivel="perigo" rotulo="Descartar rascunho" onPress={() => setDescartando(true)} />
      </Screen>

      <Folha visivel={confirmando} onFechar={() => setConfirmando(false)} rotuloFechar="Fechar" titulo="Enviar resposta?" rodape={{ rotulo: 'Voltar', onPress: () => setConfirmando(false) }} testID="pesquisa.folha-enviar">
        <OpcaoFolha testID="pesquisa.confirmar-enviar" icone="send" titulo="Enviar agora" subtitulo={offline ? 'Vai quando houver sinal.' : 'Vai para o escritório.'} onPress={() => void concluir()} />
      </Folha>
      <Dialogo
        visivel={descartando}
        perigo
        titulo="Descartar o rascunho?"
        cancelar={{ rotulo: 'Voltar', onPress: () => setDescartando(false) }}
        confirmar={{ rotulo: 'Descartar', onPress: () => void descartar(), testID: 'pesquisa.confirmar-descartar' }}
        testID="pesquisa.dialogo-descartar"
      />
      <AvisoRodape {...aviso.props} respiroInferior={0} />
    </View>
  );
}
