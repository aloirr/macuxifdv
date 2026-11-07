'use client';

/**
 * Cadastro do 2º fator do super-admin (T-0087; ADR 0029 §3): QR do `otpauth://` + chave para digitar, confirmação com o código
 * de 6 dígitos e os 10 códigos de recuperação mostrados UMA vez ("Baixar .txt", "Copiar os 10" ou "Anotei"; só depois "Já guardei").
 * Nada disso vai ao console nem fica guardado no navegador: os códigos vivem só no estado desta tela, e o navegador pede
 * confirmação antes de recarregar ou fechar enquanto eles estão na tela.
 */
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { CODIGOS_PORTAL } from '@macuxi/core/contracts';
import { TotpConfirmadoSchema, TotpInicioSchema } from '@macuxi/platform-sdk';
import { Button, ErrorBlock, IconDownload, LoadingBlock, Notice } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, MENSAGEM_TOTP_INCORRETO, mensagemDoErro } from '@/lib/portal-api';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { salvarSessaoPortal } from '@/lib/portal-sessao';
import { caminhoSvgDoQr, gerarQr } from '@/lib/qr';
import { Campo } from './base';

type Inicio = ReturnType<typeof TotpInicioSchema.parse>;

export function QrSvg({ texto, tamanho = 208 }: { texto: string; tamanho?: number }) {
  const qr = useMemo(() => gerarQr(texto), [texto]);
  const lado = qr.tamanho + 8;
  return (
    <svg data-testid="totp.qr" role="img" aria-label="QR Code para o aplicativo autenticador" width={tamanho} height={tamanho} viewBox={`0 0 ${lado} ${lado}`} shapeRendering="crispEdges" className="rounded-lg border border-line bg-white">
      <rect width={lado} height={lado} fill="#ffffff" />
      <path d={caminhoSvgDoQr(qr, 4)} fill="#16202a" />
    </svg>
  );
}

/** A chave em grupos de 4 para ler e digitar sem errar. */
const emGrupos = (s: string) => s.replace(/(.{4})/g, '$1 ').trim();

export function apenasDigitos(s: string, max = 6): string {
  return s.replace(/\D/g, '').slice(0, max);
}

const NOMES_DOS_PASSOS = ['Acesso', 'Aplicativo', 'Códigos'] as const;

/**
 * "Passo N de 3" do primeiro acesso (R-20261106-023316 🟢 20). A trilha com setas fica só para quem vê; o leitor de tela ouve
 * "Passo N de 3: <nome>", sem "seta para a direita" (R-20261107-093612 🟢 3).
 */
export function Passos({ atual }: { atual: 1 | 2 | 3 }) {
  return (
    <span data-testid="primeiro-acesso.passo" className="text-[12px] font-semibold text-ink-2">
      Passo {atual} de 3<span className="sr-only">: {NOMES_DOS_PASSOS[atual - 1]}</span>
      <span aria-hidden="true"> · {NOMES_DOS_PASSOS.join(' → ')}</span>
    </span>
  );
}

export function CadastroTotp({ desafio, aoTerminar, aoDesafioVencido, comPassos }: { desafio: string; aoTerminar: () => void; aoDesafioVencido: () => void; comPassos?: boolean }) {
  const [inicio, setInicio] = useState<Inicio | null>(null);
  const [erroInicio, setErroInicio] = useState<string | null>(null);
  const [codigo, setCodigo] = useState('');
  const [erro, setErro] = useState<string | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [codigos, setCodigos] = useState<string[] | null>(null);
  const [baixou, setBaixou] = useState(false);
  const [copiou, setCopiou] = useState(false);
  const [anotou, setAnotou] = useState(false);
  const [erroCopia, setErroCopia] = useState(false);
  const [chaveCopiada, setChaveCopiada] = useState<boolean | null>(null);
  const guardou = baixou || copiou || anotou;
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    let vivo = true;
    setErroInicio(null);
    chamarPortal(ROTAS_PORTAL.totpIniciar, { metodo: 'POST', corpo: { desafio }, schema: TotpInicioSchema })
      .then((r) => vivo && setInicio(r))
      .catch((x: unknown) => {
        if (!vivo) return;
        if (x instanceof ErroPortal && x.status === 401) aoDesafioVencido();
        else setErroInicio(mensagemDoErro(x));
      });
    return () => {
      vivo = false;
    };
  }, [desafio, tentativa, aoDesafioVencido]);

  const confirmar = async (ev: FormEvent) => {
    ev.preventDefault();
    if (enviando) return;
    if (codigo.length !== 6) return setErro('Digite os 6 dígitos que aparecem no aplicativo.');
    setEnviando(true);
    setErro(null);
    try {
      const r = await chamarPortal(ROTAS_PORTAL.totpConfirmar, { metodo: 'POST', corpo: { desafio, codigo }, schema: TotpConfirmadoSchema });
      salvarSessaoPortal(r.sessao);
      setCodigos(r.codigos_recuperacao);
    } catch (x) {
      // DESAFIO_INVALIDO (vencido ou usado): volta ao e-mail e senha
      if (x instanceof ErroPortal && x.status === 401 && /DESAFIO/i.test(x.codigo)) return aoDesafioVencido();
      setErro(x instanceof ErroPortal && x.status === 401 && x.codigo === CODIGOS_PORTAL.codigoInvalido ? MENSAGEM_TOTP_INCORRETO : mensagemDoErro(x));
      setCodigo('');
    } finally {
      setEnviando(false);
    }
  };

  // Os códigos aparecem uma vez: F5 ou fechar a aba com eles na tela os perde de vez.
  useEffect(() => {
    if (!codigos) return;
    const segurar = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', segurar);
    return () => window.removeEventListener('beforeunload', segurar);
  }, [codigos]);

  const copiar = async () => {
    if (!codigos) return;
    try {
      await navigator.clipboard.writeText(codigos.join('\n'));
      setCopiou(true);
      setErroCopia(false);
    } catch {
      setErroCopia(true);
    }
  };

  const copiarChave = async () => {
    if (!inicio) return;
    try {
      await navigator.clipboard.writeText(inicio.segredo_base32);
      setChaveCopiada(true);
    } catch {
      setChaveCopiada(false);
    }
  };

  const baixar = () => {
    if (!codigos) return;
    const texto = ['Macuxi FDV — códigos de recuperação do portal de implantação', 'Cada código vale uma vez. Guarde fora do celular.', '', ...codigos, ''].join('\r\n');
    const url = URL.createObjectURL(new Blob([texto], { type: 'text/plain;charset=utf-8' }));
    const a = document.createElement('a');
    a.href = url;
    a.download = 'macuxi-codigos-de-recuperacao.txt';
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    setBaixou(true);
  };

  if (codigos) {
    return (
      <section data-testid="totp.codigos" className="flex flex-col gap-4">
        <div className="flex flex-col gap-1">
          {comPassos && <Passos atual={3} />}
          <h1 className="m-0 font-display text-[24px] font-extrabold">Guarde os códigos de recuperação</h1>
          <span className="text-[13px] text-ink-2">Se perder o celular, cada código abaixo entra uma vez no lugar do código do aplicativo.</span>
        </div>
        <Notice tone="warning">Estes códigos aparecem só agora. Baixe o arquivo ou anote antes de continuar.</Notice>
        <ol className="m-0 grid list-none grid-cols-2 gap-2 rounded-xl border border-line bg-surface p-4 font-mono text-[15px] tabular-nums">
          {codigos.map((c) => (
            <li key={c} data-testid="totp.codigo-recuperacao">
              {c}
            </li>
          ))}
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button data-testid="totp.baixar-codigos" variant={guardou ? 'secondary' : 'primary'} onClick={baixar}>
            <IconDownload size={15} /> {baixou ? 'Baixado' : 'Baixar .txt'}
          </Button>
          <Button data-testid="totp.copiar-codigos" onClick={() => void copiar()}>
            {copiou ? 'Copiados' : 'Copiar os 10'}
          </Button>
        </div>
        {erroCopia && <Notice tone="warning">Não deu para copiar neste navegador. Baixe o arquivo ou anote os códigos.</Notice>}
        <label className="flex items-center gap-2.5 text-[14px]">
          <input type="checkbox" data-testid="totp.anotei" className="h-4 w-4 accent-accent" checked={anotou} onChange={(e) => setAnotou(e.target.checked)} />
          Anotei os 10 códigos num lugar seguro
        </label>
        <div>
          <Button data-testid="totp.ja-guardei" variant={guardou ? 'primary' : 'secondary'} disabled={!guardou} onClick={aoTerminar}>
            Já guardei, continuar
          </Button>
        </div>
        {!guardou && <span className="text-[12px] text-ink-2">Baixe, copie ou marque que anotou os códigos para continuar.</span>}
      </section>
    );
  }

  return (
    <section data-testid="totp.cadastro" className="flex flex-col gap-4">
      <div className="flex flex-col gap-1">
        {comPassos && <Passos atual={2} />}
        <h1 className="m-0 font-display text-[24px] font-extrabold">Cadastre o 2º fator</h1>
        <span className="text-[13px] text-ink-2">Abra um aplicativo autenticador (Google Authenticator, Microsoft Authenticator, 1Password) e leia o QR Code.</span>
      </div>
      {erroInicio && <ErrorBlock message={erroInicio} onRetry={() => setTentativa((t) => t + 1)} />}
      {!inicio && !erroInicio && <LoadingBlock label="Gerando o QR Code…" />}
      {inicio && (
        <>
          <div className="flex flex-col items-center gap-3 rounded-xl border border-line bg-surface p-4">
            <QrSvg texto={inicio.otpauth_uri} />
            <div className="flex w-full flex-col gap-1 text-center">
              <span className="text-[12px] text-ink-2">Sem câmera? Digite esta chave no aplicativo:</span>
              <code data-testid="totp.chave" className="font-mono text-[14px] font-semibold tracking-wide break-all text-ink select-all">
                {emGrupos(inicio.segredo_base32)}
              </code>
              <div>
                <Button size="sm" data-testid="totp.copiar-chave" onClick={() => void copiarChave()}>
                  {chaveCopiada ? 'Chave copiada' : 'Copiar chave'}
                </Button>
              </div>
              {chaveCopiada === false && <span className="text-[12px] text-ink-2">Não deu para copiar: selecione a chave e copie com Ctrl+C.</span>}
            </div>
          </div>
          <form onSubmit={(e) => void confirmar(e)} noValidate className="flex flex-col gap-3">
            {erro && <Notice tone="danger">{erro}</Notice>}
            <Campo
              rotulo="Código de 6 dígitos do aplicativo"
              testId="totp.codigo"
              inputMode="numeric"
              autoComplete="one-time-code"
              value={codigo}
              onChange={(e) => setCodigo(apenasDigitos(e.target.value))}
              className="max-w-[220px]"
            />
            <Button data-testid="totp.confirmar" type="submit" variant="primary" disabled={enviando}>
              {enviando ? 'Conferindo…' : 'Confirmar o 2º fator'}
            </Button>
          </form>
        </>
      )}
    </section>
  );
}
