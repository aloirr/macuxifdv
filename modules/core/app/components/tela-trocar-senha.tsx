/**
 * "Trocar senha" no Perfil (T-0178; RF-CORE-01; RN-CORE-32 e RN-CORE-34; docs/design/trocar-senha/spec.md). Componente de
 * apresentação, igual nos apps Campo e Gestão. Só online; a senha só vive na memória da tela e some ao sair.
 * `trocar` chama a API (o shell liga a `trocarMinhaSenha` e salva a sessão nova); em caso de erro LANÇA o erro HTTP do cliente
 * do app, com `codigo` (`CREDENCIAIS_INVALIDAS`, `RN-CORE-32`, `RN-CORE-34`, `MUITAS_TENTATIVAS`, `USUARIO_BLOQUEADO`...),
 * `detalhes` e `status`; sem rede, o `ErroSemConexao` do SDK. Sucesso: `aoConcluir` (o shell volta ao Perfil e mostra "Senha trocada.").
 * testIDs: trocar-senha.tela, .atual, .esqueci, .nova, .repita, .regras, .salvar, .aviso (e `<campo>.olho`).
 */
import {
  Banner,
  Button,
  CampoSenha,
  CAMPO_REPITA_A_SENHA,
  CAMPO_SENHA_NOVA,
  RegrasDaSenha,
  Screen,
} from '@macuxi/ui/mobile';
import { useRef, useState } from 'react';
import { Pressable, Text, type TextInput } from 'react-native';

import {
  mensagemDaSenha,
  repeticaoDaSenha,
  SENHA_MIN_CARACTERES,
  faltasNaSenha,
  TEXTOS_ESQUECI,
  TEXTOS_TROCAR_SENHA,
} from '../../contracts';
import {
  erroDaTrocaVoluntaria,
  precheckDaTrocaVoluntaria,
  type ErroDaTrocaVoluntaria,
} from '../lib/trocar-senha';
import { estilosDeAcesso } from './estilos-de-acesso';

export interface PropsTelaTrocarSenha {
  /** O app sabe que está online. Sem rede, o aviso aparece antes de tocar em Salvar (o botão continua ativo). */
  online: boolean;
  /** Troca a senha; lança o erro HTTP em caso de falha (ver o cabeçalho). */
  trocar: (corpo: { senha_atual: string; senha_nova: string }) => Promise<void>;
  aoConcluir: () => void;
  /** Abre o "Esqueci a senha" dentro do app. */
  aoEsqueci: () => void;
}

export function TelaTrocarSenha({ online, trocar, aoConcluir, aoEsqueci }: PropsTelaTrocarSenha) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [olhoAtual, setOlhoAtual] = useState(false);
  const [olhoNova, setOlhoNova] = useState(false);
  const [olhoRepita, setOlhoRepita] = useState(false);
  const [tentou, setTentou] = useState(false);
  const [atualComErro, setAtualComErro] = useState(false);
  const [aviso, setAviso] = useState<ErroDaTrocaVoluntaria | null>(null);
  const [salvando, setSalvando] = useState(false);
  const atual$ = useRef<TextInput>(null);
  const nova$ = useRef<TextInput>(null);
  const repita$ = useRef<TextInput>(null);

  const faltas = faltasNaSenha(nova);
  const repeticao = repeticaoDaSenha(nova, repetida);
  const destacar = tentou && (faltas.length > 0 || repeticao !== 'igual');
  const focar = (campo: 'atual' | 'nova' | 'repita' | null) =>
    (campo === 'atual'
      ? atual$
      : campo === 'nova'
        ? nova$
        : campo === 'repita'
          ? repita$
          : null
    )?.current?.focus();
  const editar = (f: (v: string) => void) => (v: string) => {
    setAviso(null);
    f(v);
  };

  // o aviso de "sem internet" vale já ao abrir; o de uma tentativa o substitui
  const avisoNoTopo: ErroDaTrocaVoluntaria | null =
    aviso ?? (online ? null : { texto: TEXTOS_TROCAR_SENHA.semInternet, tom: 'warning', acao: 'ficar' });

  const salvar = async () => {
    if (salvando) return;
    setTentou(true);
    setAviso(null);
    const p = precheckDaTrocaVoluntaria(atual, nova, repetida);
    setAtualComErro(p.atualVazia);
    if (!p.ok) {
      focar(p.foco);
      return;
    }
    setSalvando(true);
    try {
      await trocar({ senha_atual: atual, senha_nova: nova });
      setAtual('');
      setNova('');
      setRepetida('');
      aoConcluir();
    } catch (x) {
      const e = erroDaTrocaVoluntaria(x, nova);
      setAviso(e.texto ? e : null);
      if (e.acao === 'limpar_atual') {
        setAtual('');
        setAtualComErro(true);
        focar('atual');
      } else if (e.acao === 'limpar_novas') {
        setNova('');
        setRepetida('');
        setTentou(false);
        focar('nova');
      }
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Screen
      gap={16}
      cabecalho={{ titulo: TEXTOS_TROCAR_SENHA.titulo, voltar: { label: TEXTOS_TROCAR_SENHA.voltarAoPerfil, fallback: '/profile' } }}
      testID="trocar-senha.tela"
    >
      {avisoNoTopo?.texto ? (
        <Banner
          tone={avisoNoTopo.tom}
          icon={avisoNoTopo.tom === 'warning' ? 'wifiOff' : 'alert'}
          testID="trocar-senha.aviso"
          anunciar
        >
          {avisoNoTopo.texto}
        </Banner>
      ) : null}

      <CampoSenha
        rotulo={TEXTOS_TROCAR_SENHA.senhaAtual}
        valor={atual}
        aoMudar={editar((v) => {
          setAtual(v);
          setAtualComErro(false);
        })}
        visivel={olhoAtual}
        aoAlternar={() => setOlhoAtual((x) => !x)}
        finalidade="login"
        erro={atualComErro}
        testID="trocar-senha.atual"
        inputRef={atual$}
        autoFocus
        returnKeyType="next"
        onSubmitEditing={() => nova$.current?.focus()}
      />
      <Pressable
        testID="trocar-senha.esqueci"
        accessibilityRole="button"
        accessibilityLabel={TEXTOS_ESQUECI.titulo}
        onPress={aoEsqueci}
        style={[estilosDeAcesso.link, { alignSelf: 'flex-end' }]}
      >
        <Text style={estilosDeAcesso.linkTexto}>{TEXTOS_ESQUECI.titulo}</Text>
      </Pressable>

      <CampoSenha
        rotulo={CAMPO_SENHA_NOVA}
        valor={nova}
        aoMudar={editar(setNova)}
        visivel={olhoNova}
        aoAlternar={() => setOlhoNova((x) => !x)}
        finalidade="criacao"
        erro={destacar && faltas.length > 0}
        testID="trocar-senha.nova"
        inputRef={nova$}
        returnKeyType="next"
        onSubmitEditing={() => repita$.current?.focus()}
      />
      <CampoSenha
        rotulo={CAMPO_REPITA_A_SENHA}
        valor={repetida}
        aoMudar={editar(setRepetida)}
        visivel={olhoRepita}
        aoAlternar={() => setOlhoRepita((x) => !x)}
        finalidade="criacao"
        erro={destacar && repeticao !== 'igual'}
        testID="trocar-senha.repita"
        inputRef={repita$}
        returnKeyType="done"
        onSubmitEditing={() => void salvar()}
      />

      <RegrasDaSenha
        faltas={faltas}
        minimo={SENHA_MIN_CARACTERES}
        resumo={mensagemDaSenha(faltas, nova) ?? undefined}
        repeticao={repeticao}
        destacar={destacar}
        testID="trocar-senha.regras"
      />

      <Button
        testID="trocar-senha.salvar"
        label={salvando ? TEXTOS_TROCAR_SENHA.salvando : TEXTOS_TROCAR_SENHA.salvar}
        variant="accent"
        height={52}
        loading={salvando}
        onPress={() => void salvar()}
      />
    </Screen>
  );
}
