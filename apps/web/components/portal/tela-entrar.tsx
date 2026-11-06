'use client';

/**
 * Entrada do super-admin (T-0087; ADR 0029 §2): e-mail + senha → código de 6 dígitos do aplicativo (ou "usar código de
 * recuperação") → sessão. Sem o 2º fator confirmado, a 1ª etapa leva ao cadastro do TOTP. testIDs: entrar.*.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { CodigoRecuperacaoSchema, EtapaLoginSchema, SessaoPlataformaSchema } from '@macuxi/platform-sdk';
import { Button, Notice } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, mensagemDoErro } from '@/lib/portal-api';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { estadoDaSessao, lerSessaoPortal, salvarSessaoPortal } from '@/lib/portal-sessao';
import { Campo, MolduraEstreita } from './base';
import { apenasDigitos, CadastroTotp } from './cadastro-totp';

type Etapa = ReturnType<typeof EtapaLoginSchema.parse>;

/** Frase da 1ª etapa pelo código da API (mesma resposta para e-mail inexistente e senha errada). */
export function mensagemDoLoginPortal(x: unknown): string {
  if (x instanceof ErroPortal) {
    if (x.status === 401) return 'E-mail ou senha incorretos.';
    if (x.status === 423) return x.message || 'Acesso bloqueado por 15 minutos depois de 5 tentativas. Espere e tente de novo.';
    if (x.status === 429) return 'Muitas tentativas deste endereço. Espere alguns minutos e tente de novo.';
    if (x.status === 503) return 'O portal ainda não está configurado neste servidor. Avise o engenheiro de plantão.';
  }
  return mensagemDoErro(x);
}

export function TelaEntrar() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [senha, setSenha] = useState('');
  const [etapa, setEtapa] = useState<Etapa | null>(null);
  const [codigo, setCodigo] = useState('');
  const [recuperacao, setRecuperacao] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);

  useEffect(() => {
    if (estadoDaSessao(lerSessaoPortal(), Date.now()) === 'valida') router.replace('/empresas');
  }, [router]);

  const recomecar = useCallback((msg: string) => {
    setEtapa(null);
    setCodigo('');
    setSenha('');
    setAviso(msg);
  }, []);
  const desafioVencido = useCallback(() => recomecar('O tempo para o 2º passo acabou (5 minutos). Entre de novo.'), [recomecar]);

  const entrar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando) return;
    setErro(null);
    setAviso(null);
    if (!email.trim() || !senha) return setErro('Informe o e-mail e a senha.');
    setEnviando(true);
    try {
      setEtapa(await chamarPortal(ROTAS_PORTAL.login, { metodo: 'POST', corpo: { email: email.trim(), senha }, schema: EtapaLoginSchema }));
    } catch (x) {
      setErro(mensagemDoLoginPortal(x));
    } finally {
      setSenha('');
      setEnviando(false);
    }
  };

  const confirmar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando || !etapa) return;
    setErro(null);
    let corpo: { desafio: string; codigo: string } | { desafio: string; codigo_recuperacao: string };
    if (recuperacao) {
      const c = CodigoRecuperacaoSchema.safeParse(codigo);
      if (!c.success) return setErro('O código de recuperação tem 10 letras e números (ex.: ABCDE-23456).');
      corpo = { desafio: etapa.desafio, codigo_recuperacao: c.data };
    } else {
      if (codigo.length !== 6) return setErro('Digite os 6 dígitos que aparecem no aplicativo.');
      corpo = { desafio: etapa.desafio, codigo };
    }
    setEnviando(true);
    try {
      const s = await chamarPortal(ROTAS_PORTAL.segundoFator, { metodo: 'POST', corpo, schema: SessaoPlataformaSchema });
      salvarSessaoPortal(s);
      router.replace('/empresas');
    } catch (x) {
      if (x instanceof ErroPortal && x.status === 401 && /DESAFIO/i.test(x.codigo)) return desafioVencido();
      setErro(x instanceof ErroPortal && x.status === 423 ? mensagemDoLoginPortal(x) : mensagemDoErro(x, 'Código incorreto. Confira e tente de novo.'));
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  };

  if (etapa?.etapa === 'cadastrar_totp') {
    return (
      <MolduraEstreita testId="entrar.tela">
        <CadastroTotp desafio={etapa.desafio} aoTerminar={() => router.replace('/empresas')} aoDesafioVencido={desafioVencido} />
      </MolduraEstreita>
    );
  }

  if (etapa?.etapa === 'segundo_fator') {
    return (
      <MolduraEstreita testId="entrar.tela">
        <form onSubmit={(e) => void confirmar(e)} noValidate className="flex flex-col gap-4">
          <div className="flex flex-col gap-1">
            <h1 className="m-0 font-display text-[28px] font-extrabold">{recuperacao ? 'Código de recuperação' : 'Código do aplicativo'}</h1>
            <span className="text-[13px] text-ink-2">
              {recuperacao ? 'Digite um dos 10 códigos que você guardou. Cada um vale uma vez.' : 'Abra o aplicativo autenticador e digite o código de 6 dígitos do Macuxi FDV.'}
            </span>
          </div>
          {erro && (
            <div data-testid="entrar.erro">
              <Notice tone="danger">{erro}</Notice>
            </div>
          )}
          {recuperacao ? (
            <Campo rotulo="Código de recuperação" testId="entrar.recuperacao" autoComplete="off" autoCapitalize="characters" spellCheck={false} value={codigo} onChange={(e) => setCodigo(e.target.value.slice(0, 11))} />
          ) : (
            <Campo rotulo="Código de 6 dígitos" testId="entrar.codigo" inputMode="numeric" autoComplete="one-time-code" autoFocus value={codigo} onChange={(e) => setCodigo(apenasDigitos(e.target.value))} className="max-w-[220px]" />
          )}
          <Button data-testid="entrar.confirmar" type="submit" variant="primary" disabled={enviando}>
            {enviando ? 'Conferindo…' : 'Entrar'}
          </Button>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Button
              data-testid="entrar.alternar-recuperacao"
              variant="link"
              onClick={() => {
                setRecuperacao((r) => !r);
                setCodigo('');
                setErro(null);
              }}
            >
              {recuperacao ? 'Usar o código do aplicativo' : 'Usar código de recuperação'}
            </Button>
            <Button variant="link" onClick={() => recomecar('')}>
              Voltar
            </Button>
          </div>
        </form>
      </MolduraEstreita>
    );
  }

  return (
    <MolduraEstreita testId="entrar.tela">
      <form onSubmit={(e) => void entrar(e)} noValidate className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          <h1 className="m-0 font-display text-[28px] font-extrabold">Entrar</h1>
          <span className="text-[13px] text-ink-2">Acesso só do super-admin da Macuxi, com senha e o código do aplicativo autenticador.</span>
        </div>
        {aviso && <Notice tone="info">{aviso}</Notice>}
        {erro && (
          <div data-testid="entrar.erro">
            <Notice tone="danger">{erro}</Notice>
          </div>
        )}
        <Campo rotulo="E-mail" testId="entrar.email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} />
        <Campo rotulo="Senha" testId="entrar.senha" type="password" autoComplete="current-password" value={senha} onChange={(e) => setSenha(e.target.value)} />
        <Button data-testid="entrar.entrar" type="submit" variant="primary" disabled={enviando}>
          {enviando ? 'Entrando…' : 'Continuar'}
        </Button>
        <span className="text-[12px] text-ink-2">
          Primeira vez aqui?{' '}
          <Link href="/primeiro-acesso" className="font-semibold text-accent no-underline hover:text-accent-ink">
            Fazer o primeiro acesso com o código de convite
          </Link>
        </span>
      </form>
    </MolduraEstreita>
  );
}
