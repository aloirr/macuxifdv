'use client';

/**
 * Aceite do convite de 1º acesso (T-0087 fatia E; RN-CORE-31; pedido R-20261106-041540). Página pública do BKO, sem sessão:
 * `/convite#<token>` (formato combinado em R-20261106-044125: o fragmento não sai do navegador) ou `/convite/<token>`. Na chegada
 * o token sai do endereço (`history.replaceState` → `/convite`) e fica só na memória e no `sessionStorage` da aba (o F5 não o
 * perde; some no aceite ou na recusa 410). senha + confirmar → `POST /v1/auth/convite/aceitar` `{ token, senha }` →
 * `{ codigo_empresa, email, nome }` → login normal com o código da empresa e o e-mail já preenchidos.
 * - 410 `CONVITE_INVALIDO`: uma mensagem só (usado, vencido ou revogado não se distinguem) e o formulário some.
 * - 422 `CONVITE_SENHA_FRACA`: o motivo vem do Core na `mensagem`; o convite continua valendo.
 * - O token nunca sai daqui a não ser para a própria API: chamada same-origin pelo `/api-proxy` com `referrerPolicy: 'no-referrer'`
 *   e `credentials: 'omit'`, sem token de sessão, sem `console`, sem analytics; a página manda `Referrer-Policy: no-referrer`.
 * - Celular serve: no app Campo/Gestão não há tela de convite (o aceite é aqui; depois a pessoa entra no app com os mesmos dados).
 * testIDs: convite.tela, convite.senha, convite.confirmar, convite.criar, convite.erro, convite.invalido, convite.pronto, convite.ir-login.
 */
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { AceitarConviteRespostaSchema, type AceitarConviteResposta } from '@macuxi/core/contracts';
import { PROXY_BASE } from '@macuxi/platform-sdk/web';
import { Button, IconLock, Notice } from '@macuxi/ui/web';

import {
  CHAVE_EMAIL_DO_CONVITE,
  CHAVE_TOKEN_DO_CONVITE,
  conferirFormularioDoConvite,
  MENSAGEM_CONVITE_INVALIDO,
  PREFIXO_CONVITE,
  REGRA_DA_SENHA,
  resultadoDoErroDeAceite,
  tokenDoConvite,
  type ResultadoDoAceite,
} from '@/lib/convite';
import { CHAVE_CODIGO_EMPRESA } from '@/lib/login';
import { MODO_PORTAL_FALSO } from '@/lib/portal-api';

const campoCss = 'h-11 rounded-xl border border-field bg-surface px-3 text-[15px] text-ink outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';

type Envio = { ok: true; dados: AceitarConviteResposta } | { ok: false; erro: ResultadoDoAceite };

/** Modo falso (só fora de produção): token com "vencido" = 410; senha sem número = 422. */
async function aceitarFalso(token: string, senha: string): Promise<Envio> {
  await new Promise((r) => setTimeout(r, 250));
  if (token.includes('vencido')) return { ok: false, erro: resultadoDoErroDeAceite(410, { codigo: 'CONVITE_INVALIDO' }) };
  if (senha.length < 8 || !/[0-9]/.test(senha) || !/[A-Za-z]/.test(senha)) return { ok: false, erro: resultadoDoErroDeAceite(422, { codigo: 'CONVITE_SENHA_FRACA', mensagem: 'A senha precisa ter letras e números.' }) };
  return { ok: true, dados: { codigo_empresa: 'DEMO', email: 'pessoa@empresa.com.br', nome: 'Pessoa Convidada' } };
}

async function aceitar(token: string, senha: string): Promise<Envio> {
  if (MODO_PORTAL_FALSO) return aceitarFalso(token, senha);
  let res: Response;
  try {
    res = await fetch(`${PROXY_BASE}/auth/convite/aceitar`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ token, senha }),
      cache: 'no-store',
      credentials: 'omit',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    return { ok: false, erro: resultadoDoErroDeAceite(0, null) };
  }
  let corpo: unknown = null;
  try {
    corpo = await res.json();
  } catch {
    // corpo não é JSON
  }
  if (!res.ok) return { ok: false, erro: resultadoDoErroDeAceite(res.status, corpo) };
  const p = AceitarConviteRespostaSchema.safeParse(corpo);
  return p.success ? { ok: true, dados: p.data } : { ok: false, erro: { tipo: 'erro', mensagem: 'A resposta do servidor veio num formato inesperado. Atualize a página; se continuar, avise o suporte.' } };
}

function Marca() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-accent font-display text-[17px] font-extrabold text-white">M</span>
      <div className="flex flex-col">
        <span className="font-display text-[15px] font-bold">Macuxi FDV</span>
        <span className="text-[12px] text-ink-2">Primeiro acesso</span>
      </div>
    </div>
  );
}

export function TelaConvite({ tokenDoCaminho = null }: { tokenDoCaminho?: string | null }) {
  const router = useRouter();
  // o token sai do endereço logo na chegada (fica só na memória e na aba, para o F5); antes de ler, nada é mostrado
  const [token, setToken] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let guardado: string | null = null;
    try {
      guardado = window.sessionStorage.getItem(CHAVE_TOKEN_DO_CONVITE);
    } catch {
      // navegador sem storage
    }
    const r = tokenDoConvite({ hash: window.location.hash, caminho: tokenDoCaminho, guardado });
    if (r.token) {
      try {
        window.sessionStorage.setItem(CHAVE_TOKEN_DO_CONVITE, r.token);
      } catch {
        // sem storage: o F5 pede o link de novo
      }
    }
    if (r.limparEndereco) window.history.replaceState(null, '', PREFIXO_CONVITE);
    setToken(r.token);
  }, [tokenDoCaminho]);
  const [senha, setSenha] = useState('');
  const [confirmar, setConfirmar] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [erros, setErros] = useState<{ senha?: string; confirmar?: string }>({});
  const [erro, setErro] = useState<string | null>(null);
  const [recusado, setRecusado] = useState(false);
  const invalido = recusado || token === null;
  const [enviando, setEnviando] = useState(false);
  const [pronto, setPronto] = useState<AceitarConviteResposta | null>(null);
  const senhaRef = useRef<HTMLInputElement>(null);
  const confirmarRef = useRef<HTMLInputElement>(null);
  // foco no primeiro campo com erro depois de enviar (revisão de UX R-20261106-050553 Y10)
  const focarErro = (e: { senha?: string; confirmar?: string }) => (e.senha ? senhaRef.current : e.confirmar ? confirmarRef.current : null)?.focus();

  const esquecerToken = () => {
    try {
      window.sessionStorage.removeItem(CHAVE_TOKEN_DO_CONVITE);
    } catch {
      // sem storage
    }
  };

  const criar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando || !token) return;
    const e = conferirFormularioDoConvite(senha, confirmar);
    setErros(e);
    setErro(null);
    if (Object.keys(e).length > 0) {
      focarErro(e);
      return;
    }
    setEnviando(true);
    try {
      const r = await aceitar(token, senha);
      if (r.ok || r.erro.tipo === 'invalido') esquecerToken();
      if (r.ok) {
        setSenha('');
        setConfirmar('');
        setPronto(r.dados);
        try {
          window.localStorage.setItem(CHAVE_CODIGO_EMPRESA, r.dados.codigo_empresa);
          window.sessionStorage.setItem(CHAVE_EMAIL_DO_CONVITE, r.dados.email);
        } catch {
          // navegador sem storage: a pessoa digita no login
        }
      } else if (r.erro.tipo === 'invalido') {
        setRecusado(true);
        setSenha('');
        setConfirmar('');
      } else if (r.erro.tipo === 'senha') {
        setErros({ senha: r.erro.mensagem });
        focarErro({ senha: r.erro.mensagem });
      } else {
        setErro(r.erro.mensagem);
      }
    } finally {
      setEnviando(false);
    }
  };

  return (
    <div data-testid="convite.tela" className="flex min-h-screen flex-col items-center bg-ground px-4 py-10 sm:py-16">
      <div className="flex w-full max-w-[400px] flex-col gap-5">
        <Marca />
        {token === undefined ? null : pronto ? (
          <div data-testid="convite.pronto" className="flex flex-col gap-4">
            <div className="flex flex-col gap-1">
              <h1 className="m-0 font-display text-[28px] font-extrabold">Senha criada</h1>
              <span className="text-[14px] text-ink-2">
                Pronto, {pronto.nome.split(' ')[0]}. Sua senha está criada; o link do convite não serve mais. Daqui em diante, entre com os dados abaixo.
              </span>
            </div>
            <dl className="m-0 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 rounded-xl border border-line bg-surface p-3 text-[14px]">
              <dt className="text-ink-2">Código da empresa</dt>
              <dd className="m-0 font-mono font-semibold">{pronto.codigo_empresa}</dd>
              <dt className="text-ink-2">E-mail</dt>
              <dd className="m-0 break-all font-semibold">{pronto.email}</dd>
            </dl>
            {/* a maioria dos convidados usa o celular: o caminho do app vem primeiro; o BKO (computador) é secundário (Y8) */}
            <div data-testid="convite.no-celular">
              <Notice tone="info">
                <span className="block font-semibold">Vendedor, promotor, supervisor ou gerente no celular?</span>
                <span className="mt-1 block">
                  Abra o app Macuxi Campo (vendedor e promotor) ou Macuxi Gestão (supervisor e gerente) e entre com estes dados. Se ainda não tem o app, peça o link de
                  instalação ao administrador.
                </span>
              </Notice>
            </div>
            <Button data-testid="convite.ir-login" onClick={() => router.replace('/login')}>
              Entrar no Backoffice (computador)
            </Button>
          </div>
        ) : invalido ? (
          <div data-testid="convite.invalido" className="flex flex-col gap-3">
            <h1 className="m-0 font-display text-[28px] font-extrabold">Convite inválido ou vencido</h1>
            <Notice tone="warning">{MENSAGEM_CONVITE_INVALIDO}</Notice>
            <span className="text-[13px] text-ink-2">Se você já criou a sua senha, é só entrar normalmente.</span>
            <Button onClick={() => router.replace('/login')}>Ir para o login</Button>
          </div>
        ) : (
          <form onSubmit={(e) => void criar(e)} noValidate className="flex flex-col gap-5">
            <div className="flex flex-col gap-1">
              <h1 className="m-0 font-display text-[28px] font-extrabold">Crie a sua senha</h1>
              <span className="text-[13px] text-ink-2">Você recebeu um convite para o Macuxi FDV. A senha é sua: ninguém da empresa fica sabendo dela.</span>
            </div>
            {erro && (
              <div data-testid="convite.erro">
                <Notice tone="danger">{erro}</Notice>
              </div>
            )}
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-ink">Senha</span>
              <input
                data-testid="convite.senha"
                name="senha"
                type={mostrar ? 'text' : 'password'}
                autoComplete="new-password"
                ref={senhaRef}
                value={senha}
                onChange={(e) => setSenha(e.target.value)}
                aria-invalid={erros.senha ? true : undefined}
                aria-describedby={erros.senha ? 'convite-regra convite-erro-senha' : 'convite-regra'}
                className={campoCss}
              />
              <span id="convite-regra" className="text-[12px] text-ink-2">
                {REGRA_DA_SENHA}
              </span>
              {erros.senha && (
                <span id="convite-erro-senha" className="text-[12px] text-danger">
                  {erros.senha}
                </span>
              )}
            </label>
            <label className="flex flex-col gap-1">
              <span className="text-[13px] font-semibold text-ink">Confirme a senha</span>
              <input
                data-testid="convite.confirmar"
                name="confirmar"
                type={mostrar ? 'text' : 'password'}
                autoComplete="new-password"
                ref={confirmarRef}
                value={confirmar}
                onChange={(e) => setConfirmar(e.target.value)}
                aria-invalid={erros.confirmar ? true : undefined}
                aria-describedby={erros.confirmar ? 'convite-erro-confirmar' : undefined}
                className={campoCss}
              />
              {erros.confirmar && (
                <span id="convite-erro-confirmar" className="text-[12px] text-danger">
                  {erros.confirmar}
                </span>
              )}
            </label>
            <label className="flex items-center gap-2 text-[13px]">
              <input type="checkbox" className="accent-accent" checked={mostrar} onChange={(e) => setMostrar(e.target.checked)} />
              Mostrar a senha
            </label>
            <Button data-testid="convite.criar" type="submit" variant="primary" disabled={enviando}>
              <IconLock size={16} /> {enviando ? 'Criando…' : 'Criar senha'}
            </Button>
            <span className="text-[12px] text-ink-2">O convite vale uma vez. Depois de criar a senha, você entra pelo login com o código da empresa, o seu e-mail e esta senha.</span>
          </form>
        )}
      </div>
    </div>
  );
}
