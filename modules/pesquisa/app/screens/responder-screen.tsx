/**
 * Responder pesquisa (RF-PES-01/04, RN-PES-01): formulário da versão vigente quando abre, rascunho salvo a cada toque
 * no aparelho, regras condicionais aplicadas na hora e envio pela fila do motor (funciona sem sinal).
 * Parâmetros: `questionario` (obrigatório), `cliente` e `visita` (pesquisa do cliente ou da etapa do checkout).
 */
import { Banner, BackLink, Button, Empty, Loading, Screen, Strong, type as t } from '@macuxi/ui/mobile';
import { router, useLocalSearchParams } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Text, View } from 'react-native';
import type { ItemResposta, QuestionarioVersao } from '../../contracts';
import { CampoPergunta } from '../components/campo-pergunta';
import { camposVisiveis, chaveDoRascunho, errosPorPergunta, novoRascunho, progresso, responder, type RascunhoResposta } from '../lib/formulario';
import { hrefPesquisas } from '../rotas';
import { usePesquisa } from '../state/use-pesquisa';

export default function ResponderScreen() {
  const params = useLocalSearchParams<{ questionario?: string; cliente?: string; visita?: string }>();
  const questionarioId = params.questionario ?? '';
  const contexto = useMemo(() => ({ cliente_id: params.cliente || null, visita_id: params.visita || null }), [params.cliente, params.visita]);
  const { carregado, versaoPara, lerRascunho, gravarRascunho, apagarRascunho, enviar, novoId, agora, offline } = usePesquisa();

  // RN-PES-01: a versão fica fixa enquanto o formulário está aberto (a resposta cita a versão que o usuário viu)
  const [versao, setVersao] = useState<QuestionarioVersao | null>(null);
  const [rascunho, setRascunho] = useState<RascunhoResposta | null>(null);
  const [erros, setErros] = useState<Record<string, string>>({});
  const [mensagem, setMensagem] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [enviada, setEnviada] = useState(false);
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

  const concluir = async () => {
    if (!versao || !rascunho) return;
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
    await apagarRascunho(chave);
    if (router.canGoBack()) router.back();
    else router.replace(hrefPesquisas() as never);
  };

  if (!carregado) return <Loading />;
  if (!versao || !rascunho) {
    return (
      <Screen testID="pesquisa.responder">
        <BackLink label="Pesquisas" fallback={hrefPesquisas()} />
        <Empty text="Esta pesquisa não está mais disponível no aparelho. Sincronize e tente de novo." />
      </Screen>
    );
  }

  if (enviada) {
    return (
      <Screen testID="pesquisa.responder">
        <Text style={t.h1}>Resposta registrada</Text>
        <Banner tone="success" icon="check" testID="pesquisa.enviada">
          <Strong>Obrigado!</Strong> {offline ? 'A resposta está na fila do aparelho e vai quando o sinal voltar.' : 'A resposta foi para a fila de envio.'}
        </Banner>
        <Button testID="pesquisa.voltar" label="Voltar" height={48} onPress={() => (router.canGoBack() ? router.back() : router.replace(hrefPesquisas() as never))} />
      </Screen>
    );
  }

  const campos = camposVisiveis(versao, rascunho);
  const pr = progresso(versao, rascunho);

  return (
    <Screen testID="pesquisa.responder">
      <BackLink label="Pesquisas" fallback={hrefPesquisas()} />
      <View style={{ gap: 4 }}>
        <Text style={t.h1Small}>{versao.titulo}</Text>
        {versao.descricao ? <Text style={t.sub}>{versao.descricao}</Text> : null}
        <Text style={t.small} testID="pesquisa.progresso">
          {pr.respondidas} de {pr.visiveis} respondidas{pr.obrigatorias_faltando ? ` · faltam ${pr.obrigatorias_faltando} obrigatória(s)` : ''} · rascunho salvo no aparelho
        </Text>
      </View>

      {campos.map((c) => (
        <CampoPergunta key={c.pergunta.id} pergunta={c.pergunta} item={c.item} ordem={c.ordem} erro={erros[c.pergunta.id]} agora={agora} onResponder={onResponder} onLimpar={() => onLimpar(c.pergunta.id)} />
      ))}

      {mensagem ? (
        <Banner tone="danger" icon="alert" testID="pesquisa.erro">
          {mensagem}
        </Banner>
      ) : null}
      <Button testID="pesquisa.enviar" label="Enviar resposta" icon="send" height={52} loading={enviando} onPress={() => void concluir()} />
      <Button testID="pesquisa.descartar" label="Descartar rascunho" variant="ghost" height={48} onPress={() => void descartar()} />
    </Screen>
  );
}
