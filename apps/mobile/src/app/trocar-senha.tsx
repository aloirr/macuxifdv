/**
 * "Trocar senha" do Perfil, Campo e Gestão (T-0178; RF-CORE-01; RN-CORE-32 e RN-CORE-34; spec docs/design/trocar-senha/spec.md
 * §2 e §7). A tela é do Core (`TelaTrocarSenha`); o shell liga a troca (`trocarMinhaSenhaNoApp`, que salva a sessão nova), o
 * estado de rede e a navegação. Sucesso: volta ao Perfil com "Senha trocada." no rodapé. A senha só vive na memória da tela.
 */
import { TelaTrocarSenha } from '@macuxi/core/app';
import { TEXTOS_TROCAR_SENHA } from '@macuxi/core/contracts';
import { Redirect, router } from 'expo-router';

import { AcimaDoTeclado } from '@/components/acima-do-teclado';
import { guardarAvisoPosLogin } from '@/lib/aviso-pos-login';
import { contaDaSessao } from '@/lib/trocar-senha-shell';
import { usePlataforma } from '@/state/plataforma';

export default function TrocarSenhaScreen() {
  const { sessao, offline, trocarMinhaSenhaNoApp } = usePlataforma();
  if (!contaDaSessao(sessao)) return <Redirect href={sessao ? '/profile' : '/login'} />;
  return (
    <AcimaDoTeclado>
      <TelaTrocarSenha
        online={!offline}
        trocar={trocarMinhaSenhaNoApp}
        aoConcluir={() => {
          guardarAvisoPosLogin(TEXTOS_TROCAR_SENHA.trocada);
          if (router.canGoBack()) router.back();
          else router.replace('/profile');
        }}
        aoEsqueci={() => router.push('/esqueci-senha')}
      />
    </AcimaDoTeclado>
  );
}
