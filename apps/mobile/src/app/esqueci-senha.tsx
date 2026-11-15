/**
 * "Esqueci a senha" dentro do app, empilhada sobre a "Trocar senha" (T-0178; spec docs/design/trocar-senha/spec.md §6). A tela é
 * do Core (`TelaEsqueciSenha` no modo `dentroDoApp`: código e e-mail da sessão); o pedido é o mesmo do login (`pedirSenha`).
 */
import { TelaEsqueciSenha } from '@macuxi/core/app';
import { Redirect } from 'expo-router';

import { AcimaDoTeclado } from '@/components/acima-do-teclado';
import { contaDaSessao } from '@/lib/trocar-senha-shell';
import { usePlataforma } from '@/state/plataforma';

export default function EsqueciSenhaScreen() {
  const { sessao, offline, pedirSenha } = usePlataforma();
  const conta = contaDaSessao(sessao);
  if (!conta) return <Redirect href={sessao ? '/profile' : '/login'} />;
  return (
    <AcimaDoTeclado>
      <TelaEsqueciSenha dentroDoApp={conta} semInternet={offline} onPedir={pedirSenha} />
    </AcimaDoTeclado>
  );
}
