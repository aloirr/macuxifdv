'use client';

/**
 * Entrada do portal (T-0093; ADR 0031; spec docs/design/portal-entrar.md §1 e §4): só e-mail e senha → `POST
 * /v1/plataforma/auth/login` → `SessaoPortal`. Time da Macuxi → Empresas (ou a página de onde a guarda mandou); admin do cliente
 * com 1 empresa → direto nela; com 2+ → "Escolha a empresa". Sem primeiro acesso, convite, código de 6 dígitos nem recuperação.
 * T-0094: admin com a senha ainda temporária recebe 403 `SENHA_A_TROCAR` e a frase manda criar a senha no backoffice.
 * A senha nunca vai ao `sessionStorage` nem a log; é limpa depois de cada tentativa. testIDs: entrar.*.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { CODIGOS_PORTAL } from '@macuxi/core/contracts';
import { SessaoPortalSchema } from '@macuxi/platform-sdk';
import { Button, Notice } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, MENSAGEM_PORTAL_SEM_SEGREDOS, MENSAGEM_SEM_CONEXAO, MENSAGEM_SESSAO_TERMINOU, mensagemDoErro } from '@/lib/portal-api';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import {
  apagarRetornoPortal,
  CAMINHO_ESCOLHER_EMPRESA,
  consumirAvisoPortal,
  destinoDaSessao,
  destinoDepoisDoLogin,
  estadoDaSessao,
  lerRetornoPortal,
  lerSessaoPortal,
  salvarSessaoPortal,
} from '@/lib/portal-sessao';
import { Campo, CampoSenha, MolduraEstreita } from './base';

/** Textos da entrada (spec §1 e §4): sem variação. */
export const TEXTOS_ENTRAR = Object.freeze({
  titulo: 'Entrar',
  esqueceu: 'Esqueceu a senha? Use "Esqueci a senha" no backoffice.',
  vazio: 'Informe o e-mail e a senha.',
  credenciais: 'E-mail ou senha incorretos.',
  bloqueado: 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.',
  limiteIp: 'Muitas tentativas deste endereço. Espere alguns minutos e tente de novo.',
  /** T-0094 (RN-CORE-34; spec ciclo-de-senha §7): a senha conferiu, mas ainda é a temporária; a troca é no backoffice. */
  senhaATrocar: 'Crie a sua senha no backoffice antes de entrar aqui.',
});

/**
 * Frase da entrada pelo erro da API. O 401 é o mesmo para e-mail inexistente, senha errada e conta sem empresa (sem revelar se o
 * e-mail existe); a tela mostra sempre a frase da spec, não a da API.
 */
export function mensagemDoLoginPortal(x: unknown): string {
  if (x instanceof ErroPortal) {
    if (x.status === 401) return TEXTOS_ENTRAR.credenciais;
    if (x.codigo === CODIGOS_PORTAL.senhaATrocar) return TEXTOS_ENTRAR.senhaATrocar;
    if (x.status === 423 || x.codigo === CODIGOS_PORTAL.bloqueado) return TEXTOS_ENTRAR.bloqueado;
    if (x.status === 429) return TEXTOS_ENTRAR.limiteIp;
    if (x.status === 503) return MENSAGEM_PORTAL_SEM_SEGREDOS;
    if (x.status === 0 && x.codigo === 'sem_conexao') return MENSAGEM_SEM_CONEXAO;
  }
  return mensagemDoErro(x);
}

export function TelaEntrar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  // página de onde a guarda mandou para cá (volta para ela depois do login, com o #aba; R-20261106-023316 🟡 10)
  const [retorno, setRetorno] = useState<string | null>(null);

  useEffect(() => {
    const s = lerSessaoPortal();
    const e = estadoDaSessao(s, Date.now());
    if (s && (e === 'valida' || e === 'renovar')) {
      apagarRetornoPortal();
      router.replace(destinoDaSessao(s));
      return;
    }
    // aviso de empresa indisponível (403 com 1 empresa só: a sessão acabou)
    const a = consumirAvisoPortal();
    if (a) setAviso(a);
    // lê sem apagar: um F5 aqui mantém a página de origem e o aviso; apaga só depois do login (R-20261107-093612 🟢 4)
    const r = lerRetornoPortal();
    if (!r) return;
    if (r.caminho) setRetorno(r.caminho);
    if (r.sessaoTerminou && !a) setAviso(MENSAGEM_SESSAO_TERMINOU);
  }, [router]);

  const entrar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando) return;
    setErro(null);
    if (!email.trim() || !senha) return setErro(TEXTOS_ENTRAR.vazio);
    setEnviando(true);
    try {
      const s = await chamarPortal(ROTAS_PORTAL.login, { metodo: 'POST', corpo: { email: email.trim(), senha }, schema: SessaoPortalSchema });
      salvarSessaoPortal(s);
      const destino = destinoDepoisDoLogin(s, retorno);
      // com 2+ empresas a página de origem fica guardada para depois da escolha
      if (destino !== CAMINHO_ESCOLHER_EMPRESA) apagarRetornoPortal();
      setAviso(null);
      router.replace(destino);
    } catch (x) {
      setErro(mensagemDoLoginPortal(x));
    } finally {
      setSenha('');
      setEnviando(false);
    }
  };

  return (
    <MolduraEstreita testId="entrar.tela">
      <form onSubmit={(e) => void entrar(e)} noValidate className="flex flex-col gap-4">
        {/* sem subtítulo: a Marca, logo acima do cartão, já diz "Portal de implantação · Macuxi FDV" (R-20261107-174216 🟡 1) */}
        <h1 className="m-0 font-display text-[28px] font-extrabold">{TEXTOS_ENTRAR.titulo}</h1>
        {aviso && (
          <div data-testid="entrar.aviso">
            <Notice tone="info">{aviso}</Notice>
          </div>
        )}
        {erro && (
          <div data-testid="entrar.erro">
            <Notice tone="danger">{erro}</Notice>
          </div>
        )}
        <Campo rotulo="E-mail" testId="entrar.email" type="email" autoComplete="username" autoFocus value={email} onChange={(e) => setEmail(e.target.value)} />
        <CampoSenha rotulo="Senha" testId="entrar.senha" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        <Button data-testid="entrar.entrar" type="submit" variant="primary" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Entrar'}
        </Button>
        <span data-testid="entrar.esqueceu" className="text-[12px] text-ink-2">
          {TEXTOS_ENTRAR.esqueceu}
        </span>
      </form>
    </MolduraEstreita>
  );
}
