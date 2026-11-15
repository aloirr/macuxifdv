/**
 * "Trocar senha" no Perfil (T-0178; RN-CORE-32/34; docs/design/trocar-senha/spec.md). Componente de apresentação do Campo e do
 * Gestão. Só online: sem fila offline, e a senha vive só na memória da tela (nunca em storage, URL ou log).
 *
 * Props:
 * - `codigoEmpresa`, `email`: da SESSÃO (nunca de campo editável); vão no pedido.
 * - `app`: 'campo' | 'gestao'; `aparelho`: `{ id?, nome? }` do aparelho (o servidor abre a sessão nova para ele).
 * - `post`: transporte sem sessão (`PostSemSessao`); a tela chama `POST /v1/auth/senha/trocar` por `trocarSenhaDoPerfil`.
 * - `semInternet`: o app sabe que está sem rede; o aviso amarelo aparece antes de salvar (o botão continua ativo).
 * - `aoTrocar(sessao)`: sucesso. O shell troca a sessão (a nova substitui a de antes), volta ao Perfil e mostra `AVISO_SENHA_TROCADA`.
 * - `aoEsqueci()`: abre `TelaEsqueciSenha` com `dentroDoApp` (a "Senha atual" pode ser a temporária que chegar por e-mail).
 * - `aoVoltar?`: voltar da faixa e do botão Voltar do Android (descarta as três senhas); `rotaVoltar` (padrão '/profile') e
 *   `rotuloVoltar` (padrão 'Perfil') só servem para a faixa.
 * testIDs: trocar-senha.tela, .atual, .esqueci, .nova, .repita, .regras, .salvar, .erro, .sem-internet.
 */
import { estilosDeAcesso } from './estilos-de-acesso';
import {
  Banner,
  Button,
  CampoSenha,
  CAMPO_REPITA_A_SENHA,
  CAMPO_SENHA_NOVA,
  RegrasDaSenha,
  Screen,
} from '@macuxi/ui/mobile';
import type { AppComLogin } from '@macuxi/platform-sdk';
import { useEffect, useRef, useState } from 'react';
import { BackHandler, Pressable, Text, TextInput } from 'react-native';

import {
  SENHA_MIN_CARACTERES,
  TEXTOS_TROCAR_SENHA,
  mensagemDaSenha,
  type SessaoResposta,
} from '../../contracts';
import {
  erroDaTrocaVoluntaria,
  trocarSenhaDoPerfil,
  validarTroca,
  type AvisoDaTrocaVoluntaria,
} from '../lib/senha';
import type { PostSemSessao } from '../lib/login';

export interface PropsTelaTrocarSenha {
  codigoEmpresa: string;
  email: string;
  app: AppComLogin;
  aparelho?: { id?: string; nome?: string };
  post: PostSemSessao;
  semInternet?: boolean;
  aoTrocar: (sessao: SessaoResposta) => void;
  aoEsqueci: () => void;
  aoVoltar?: () => void;
  rotaVoltar?: string;
  rotuloVoltar?: string;
}

export function TelaTrocarSenha({
  codigoEmpresa,
  email,
  app,
  aparelho,
  post,
  semInternet = false,
  aoTrocar,
  aoEsqueci,
  aoVoltar,
  rotaVoltar = '/profile',
  rotuloVoltar = 'Perfil',
}: PropsTelaTrocarSenha) {
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [tentou, setTentou] = useState(false);
  const [aviso, setAviso] = useState<AvisoDaTrocaVoluntaria | null>(null);
  const [atualComErro, setAtualComErro] = useState(false);
  const [salvando, setSalvando] = useState(false);
  // cada campo tem o seu olho; começam ocultos
  const [vis, setVis] = useState({ atual: false, nova: false, repita: false });
  const alternar = (campo: 'atual' | 'nova' | 'repita') => setVis((x) => ({ ...x, [campo]: !x[campo] }));
  const atual$ = useRef<TextInput>(null);
  const nova$ = useRef<TextInput>(null);
  const repita$ = useRef<TextInput>(null);

  // Android: o voltar do sistema sai sem salvar (as senhas vão embora com a tela).
  useEffect(() => {
    if (!aoVoltar) return undefined;
    const s = BackHandler.addEventListener('hardwareBackPress', () => {
      aoVoltar();
      return true;
    });
    return () => s.remove();
  }, [aoVoltar]);

  const v = validarTroca(nova, repetida);
  const atualVazia = atual === '';
  const destacar = tentou && !v.ok;
  const semRede = semInternet ? { texto: TEXTOS_TROCAR_SENHA.semInternet, tom: 'warning' as const } : null;
  const avisoNoTopo = aviso?.texto ? { texto: aviso.texto, tom: aviso.tom } : aviso ? null : semRede;

  // digitar em qualquer campo apaga o aviso
  const digitou = (set: (v: string) => void) => (valor: string) => {
    set(valor);
    setAviso(null);
    setAtualComErro(false);
  };

  const salvar = async () => {
    if (salvando) return;
    setTentou(true);
    setAviso(null);
    if (atualVazia) {
      setAtualComErro(true);
      atual$.current?.focus();
      return;
    }
    if (!v.ok) {
      if (v.faltas.length === 0) repita$.current?.focus();
      return;
    }
    setSalvando(true);
    try {
      const sessao = await trocarSenhaDoPerfil(
        post,
        { codigo_empresa: codigoEmpresa, email, senha_atual: atual, senha_nova: nova },
        app,
        aparelho,
      );
      setAtual('');
      setNova('');
      setRepetida('');
      aoTrocar(sessao);
    } catch (x) {
      const a = erroDaTrocaVoluntaria(x, nova);
      setAviso(a);
      if (a.efeito === 'limpar_atual') {
        setAtual('');
        setAtualComErro(true);
        atual$.current?.focus();
      } else if (a.efeito === 'limpar_novas') {
        setNova('');
        setRepetida('');
        setTentou(false);
        nova$.current?.focus();
      }
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Screen
      gap={16}
      testID="trocar-senha.tela"
      cabecalho={{
        titulo: TEXTOS_TROCAR_SENHA.titulo,
        voltar: { label: rotuloVoltar, fallback: rotaVoltar, ...(aoVoltar ? { aoVoltar } : {}) },
      }}
    >
      {avisoNoTopo ? (
        <Banner
          tone={avisoNoTopo.tom}
          icon={avisoNoTopo.tom === 'warning' ? 'wifiOff' : 'alert'}
          testID={avisoNoTopo.tom === 'warning' ? 'trocar-senha.sem-internet' : 'trocar-senha.erro'}
          anunciar
        >
          {avisoNoTopo.texto}
        </Banner>
      ) : null}

      <CampoSenha
        rotulo={TEXTOS_TROCAR_SENHA.atual}
        valor={atual}
        aoMudar={digitou(setAtual)}
        visivel={vis.atual}
        aoAlternar={() => alternar('atual')}
        finalidade="login"
        erro={atualComErro}
        testID="trocar-senha.atual"
        testIDOlho="trocar-senha.atual.olho"
        inputRef={atual$}
        autoFocus
        returnKeyType="next"
        onSubmitEditing={() => nova$.current?.focus()}
      />
      <Pressable
        testID="trocar-senha.esqueci"
        accessibilityRole="button"
        accessibilityLabel="Esqueci a senha"
        onPress={aoEsqueci}
        style={[estilosDeAcesso.link, { alignSelf: 'flex-end' }]}
      >
        <Text style={estilosDeAcesso.linkTexto}>Esqueci a senha</Text>
      </Pressable>

      <CampoSenha
        rotulo={CAMPO_SENHA_NOVA}
        valor={nova}
        aoMudar={digitou(setNova)}
        visivel={vis.nova}
        aoAlternar={() => alternar('nova')}
        finalidade="criacao"
        erro={destacar && v.faltas.length > 0}
        testID="trocar-senha.nova"
        testIDOlho="trocar-senha.nova.olho"
        inputRef={nova$}
        returnKeyType="next"
        onSubmitEditing={() => repita$.current?.focus()}
      />
      <CampoSenha
        rotulo={CAMPO_REPITA_A_SENHA}
        valor={repetida}
        aoMudar={digitou(setRepetida)}
        visivel={vis.repita}
        aoAlternar={() => alternar('repita')}
        finalidade="criacao"
        erro={destacar && v.repeticao !== 'igual'}
        testID="trocar-senha.repita"
        testIDOlho="trocar-senha.repita.olho"
        inputRef={repita$}
        returnKeyType="done"
        onSubmitEditing={() => void salvar()}
      />

      <RegrasDaSenha
        faltas={v.faltas}
        minimo={SENHA_MIN_CARACTERES}
        resumo={mensagemDaSenha(v.faltas, nova) ?? undefined}
        repeticao={v.repeticao}
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
