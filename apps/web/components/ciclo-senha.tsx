'use client';

/**
 * Telas do ciclo de senha do BKO, na moldura do login (T-0094; RN-CORE-32/34; spec docs/design/ciclo-de-senha.md §2 e §3).
 * - `CrieSuaSenha`: troca obrigatória depois do 403 `SENHA_A_TROCAR`. Recebe do login o código da empresa, o e-mail e o motivo;
 *   a senha usada no login NÃO entra aqui: quem chama a API é o login (`onSalvar(senhaNova)`), que a guarda só na memória.
 *   Nada abre antes: a sessão só existe depois da resposta do `POST /auth/senha/trocar`.
 * - `EsqueciSenha`: pede a senha temporária; a confirmação é sempre a mesma (`info`), exista ou não o cadastro.
 * Regras e textos puros em `lib/ciclo-senha.ts`. testIDs: crie-senha.*, esqueci.*.
 */
import { useEffect, useRef, useState, type FormEvent, type InputHTMLAttributes, type Ref } from 'react';
import { faltasNaSenha, type DetalhesSenhaATrocar } from '@macuxi/core/contracts';
import { Button, CAMPO_REPITA_A_SENHA, CAMPO_SENHA_NOVA, ESCONDER_SENHA, IconEye, IconEyeOff, MOSTRAR_SENHA, Notice, RegrasDaSenha } from '@macuxi/ui/web';

import {
  mensagemDoEsqueci,
  repeticaoDaSenha,
  resultadoDoErroDaTroca,
  subtituloDaTroca,
  TEXTOS_CRIE_SENHA,
  TEXTOS_ESQUECI,
  trocaProntaParaEnviar,
  validarEsqueci,
} from '@/lib/ciclo-senha';

const campoCss = 'h-11 w-full rounded-xl border border-field bg-surface px-3 text-[15px] text-ink outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent';
const linkCss = 'min-h-[44px] self-start text-[14px]';

/** O navegador acha que está sem internet? (o aviso não trava o botão: se a detecção errar, a pessoa não fica presa). */
function useSemInternet(): boolean {
  const [sem, setSem] = useState(false);
  useEffect(() => {
    const atualizar = () => setSem(typeof navigator !== 'undefined' && navigator.onLine === false);
    atualizar();
    window.addEventListener('online', atualizar);
    window.addEventListener('offline', atualizar);
    return () => {
      window.removeEventListener('online', atualizar);
      window.removeEventListener('offline', atualizar);
    };
  }, []);
  return sem;
}

function CampoDeSenha({ rotulo, testId, mostrar, campoRef, ...rest }: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { rotulo: string; testId: string; mostrar: boolean; campoRef?: Ref<HTMLInputElement> }) {
  return (
    <label className="flex flex-col gap-1">
      <span className="text-[13px] font-semibold text-ink">{rotulo}</span>
      <input ref={campoRef} data-testid={testId} type={mostrar ? 'text' : 'password'} autoComplete="new-password" spellCheck={false} autoCapitalize="none" className={`${campoCss} pr-12`} {...rest} />
    </label>
  );
}

export interface PropsCrieSuaSenha {
  codigoEmpresa: string;
  email: string;
  motivo: DetalhesSenhaATrocar['motivo'];
  /** Chama `POST /auth/senha/trocar` com a senha guardada pelo login; lança o erro da API (a tela decide pela tabela do §2). */
  onSalvar: (senhaNova: string) => Promise<void>;
  /** Volta ao login, com o texto a mostrar lá (ou nenhum). A senha usada some da memória. */
  onVoltarAoLogin: (mensagem?: string) => void;
}

export function CrieSuaSenha({ codigoEmpresa, email, motivo, onSalvar, onVoltarAoLogin }: PropsCrieSuaSenha) {
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [mostrar, setMostrar] = useState(false);
  const [destacar, setDestacar] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [salvando, setSalvando] = useState(false);
  const semInternet = useSemInternet();
  const novaRef = useRef<HTMLInputElement>(null);

  const salvar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (salvando) return;
    setErro(null);
    // antes de enviar, na tela: falta na regra ou senhas diferentes = lista em vermelho, nada vai à API
    if (!trocaProntaParaEnviar(nova, repetida)) {
      setDestacar(true);
      return;
    }
    setSalvando(true);
    try {
      await onSalvar(nova);
    } catch (x) {
      const r = resultadoDoErroDaTroca(x, nova);
      if (r.acao === 'login') return onVoltarAoLogin(r.mensagem);
      setErro(r.mensagem);
      if (r.acao === 'destacar') setDestacar(true);
      if (r.acao === 'limpar') {
        setNova('');
        setRepetida('');
        setDestacar(false);
        novaRef.current?.focus();
      }
    } finally {
      setSalvando(false);
    }
  };

  return (
    <form data-testid="crie-senha.tela" onSubmit={(e) => void salvar(e)} noValidate className="flex flex-col gap-4">
      {semInternet && (
        <div data-testid="crie-senha.sem-internet">
          <Notice tone="warning">{TEXTOS_CRIE_SENHA.semInternet}</Notice>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[28px] font-extrabold">{TEXTOS_CRIE_SENHA.titulo}</h1>
        <span className="text-[14px] text-ink-2">{subtituloDaTroca(motivo)}</span>
        <span data-testid="crie-senha.quem" className="text-[13px] text-ink-2">
          {email} · {codigoEmpresa}
        </span>
      </div>
      {erro && (
        <div data-testid="crie-senha.erro">
          <Notice tone="danger">{erro}</Notice>
        </div>
      )}
      <div className="flex flex-col gap-1">
        <div className="relative">
          <CampoDeSenha
            rotulo={CAMPO_SENHA_NOVA}
            testId="crie-senha.nova"
            mostrar={mostrar}
            campoRef={novaRef}
            autoFocus
            value={nova}
            onChange={(e) => setNova(e.target.value)}
            aria-describedby="senha-regras"
          />
          {/* o olho mostra os dois campos (um só toque) */}
          <button
            type="button"
            data-testid="crie-senha.olho"
            aria-label={mostrar ? ESCONDER_SENHA : MOSTRAR_SENHA}
            aria-pressed={mostrar}
            onClick={() => setMostrar((m) => !m)}
            className="absolute right-0 bottom-0 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
          >
            {mostrar ? <IconEyeOff size={18} /> : <IconEye size={18} />}
          </button>
        </div>
      </div>
      <CampoDeSenha
        rotulo={CAMPO_REPITA_A_SENHA}
        testId="crie-senha.repita"
        mostrar={mostrar}
        value={repetida}
        onChange={(e) => setRepetida(e.target.value)}
        aria-describedby="senha-regras-repeticao"
      />
      <RegrasDaSenha id="senha-regras" faltas={faltasNaSenha(nova)} repeticao={repeticaoDaSenha(nova, repetida)} destacar={destacar} testId="crie-senha.regras" />
      <Button data-testid="crie-senha.salvar" type="submit" variant="primary" disabled={salvando}>
        {salvando ? TEXTOS_CRIE_SENHA.salvando : TEXTOS_CRIE_SENHA.salvar}
      </Button>
      <Button data-testid="crie-senha.voltar" variant="link" className={linkCss} onClick={() => onVoltarAoLogin()}>
        {TEXTOS_CRIE_SENHA.voltar}
      </Button>
    </form>
  );
}

export interface PropsEsqueciSenha {
  codigoEmpresa: string;
  email: string;
  /** Chama `POST /auth/senha/esqueci`; lança o erro da API ou de rede. */
  onPedir: (c: { codigo_empresa: string; email: string }) => Promise<void>;
  /** Volta ao login com o código e o e-mail preenchidos. */
  onVoltarAoLogin: (c: { codigo_empresa: string; email: string }) => void;
}

export function EsqueciSenha({ codigoEmpresa, email: emailInicial, onPedir, onVoltarAoLogin }: PropsEsqueciSenha) {
  const [codigo, setCodigo] = useState(codigoEmpresa);
  const [email, setEmail] = useState(emailInicial);
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [pedido, setPedido] = useState(false);
  const codigoRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);

  // foco no primeiro campo vazio
  useEffect(() => {
    if (!codigoEmpresa.trim()) codigoRef.current?.focus();
    else emailRef.current?.focus();
  }, [codigoEmpresa]);

  const voltar = () => onVoltarAoLogin({ codigo_empresa: codigo.trim(), email: email.trim() });

  const enviar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando) return;
    const invalido = validarEsqueci({ codigo_empresa: codigo, email });
    setErro(invalido);
    if (invalido) return;
    setEnviando(true);
    try {
      await onPedir({ codigo_empresa: codigo.trim(), email: email.trim() });
      setPedido(true);
    } catch (x) {
      const m = mensagemDoEsqueci(x);
      if (m) setErro(m);
      else setPedido(true);
    } finally {
      setEnviando(false);
    }
  };

  if (pedido) {
    return (
      <div data-testid="esqueci.tela" className="flex flex-col gap-4">
        <h1 className="m-0 font-display text-[28px] font-extrabold">{TEXTOS_ESQUECI.titulo}</h1>
        <div id="esqueci-confirmacao" data-testid="esqueci.confirmacao" aria-live="polite">
          <Notice tone="info">{TEXTOS_ESQUECI.confirmacao}</Notice>
        </div>
        <span className="text-[13px] text-ink-2">{TEXTOS_ESQUECI.naoChegou}</span>
        {/* único botão; o foco vai para ele (a confirmação é lida pela região viva) */}
        <Button autoFocus aria-describedby="esqueci-confirmacao" data-testid="esqueci.voltar" variant="primary" onClick={voltar}>
          {TEXTOS_ESQUECI.voltar}
        </Button>
      </div>
    );
  }

  return (
    <form data-testid="esqueci.tela" onSubmit={(e) => void enviar(e)} noValidate className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        <h1 className="m-0 font-display text-[28px] font-extrabold">{TEXTOS_ESQUECI.titulo}</h1>
        <span className="text-[14px] text-ink-2">{TEXTOS_ESQUECI.instrucao}</span>
      </div>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ink">Código da empresa</span>
        <input ref={codigoRef} data-testid="esqueci.codigo-empresa" type="text" autoComplete="organization" value={codigo} onChange={(e) => setCodigo(e.target.value)} className={campoCss} />
      </label>
      <label className="flex flex-col gap-1">
        <span className="text-[13px] font-semibold text-ink">E-mail</span>
        <input ref={emailRef} data-testid="esqueci.email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} className={campoCss} />
      </label>
      <Button data-testid="esqueci.enviar" type="submit" variant="primary" disabled={enviando}>
        {enviando ? TEXTOS_ESQUECI.enviando : TEXTOS_ESQUECI.enviar}
      </Button>
      {erro && (
        <div data-testid="esqueci.erro">
          <Notice tone="danger">{erro}</Notice>
        </div>
      )}
      <Button data-testid="esqueci.voltar" variant="link" className={linkCss} onClick={voltar}>
        {TEXTOS_ESQUECI.voltar}
      </Button>
    </form>
  );
}
