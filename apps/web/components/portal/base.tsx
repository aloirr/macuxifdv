'use client';

/**
 * Peças comuns do portal `config.` (T-0087; T-0093): moldura, cabeçalho com a sessão (e o "Trocar de empresa" do admin do
 * cliente), campo de formulário, campo de senha com o olho e a guarda de sessão.
 * Visual pelos tokens e componentes de `@macuxi/ui/web` (os do login do BKO); sem menu dos módulos (o portal não é o BKO).
 * Caminhos sem o prefixo `/config`: no host `config.` o navegador vê `/empresas` e o `proxy.ts` reescreve.
 */
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useId, useMemo, useRef, useState, useSyncExternalStore, type InputHTMLAttributes, type MouseEvent, type ReactNode } from 'react';
import { Button, cx, Dialog, ESCONDER_SENHA, IconEye, IconEyeOff, LoadingBlock, MOSTRAR_SENHA } from '@macuxi/ui/web';

import { houveUsoRecente, MODO_PORTAL_FALSO, registrarUso, renovarSessaoPortal, sairDoPortal } from '@/lib/portal-api';
import {
  assinarSaida,
  avisoDeFimDaSessao,
  baixarPendencias,
  descartarPendenciasDeSaida,
  haSaidaSegurada,
  pendenciasDeSaida,
  versaoDaSaida,
  type AvisoDeFim,
  type SaidaPendente,
} from '@/lib/portal-saida';
import {
  assinarSessaoPortal,
  CAMINHO_ESCOLHER_EMPRESA,
  destinoDaSessao,
  estadoDaSessao,
  guardarRetornoPortal,
  lerDesvioPortal,
  lerSessaoPortal,
  limparSessaoPortal,
  podeTrocarDeEmpresa,
  retirarDesvioPortal,
  retirarSaidaPedida,
  versaoDaSessaoPortal,
  type DesvioPortal,
  type SessaoPortal,
} from '@/lib/portal-sessao';

export const campoCss =
  'h-11 w-full rounded-xl border border-field bg-surface px-3 text-[15px] text-ink outline-none focus-visible:border-ink focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-accent aria-[invalid=true]:border-danger disabled:bg-ground disabled:text-ink-2';

export function Marca() {
  return (
    <div className="flex items-center gap-3">
      <span className="flex h-10 w-10 items-center justify-center rounded-[11px] bg-accent font-display text-[17px] font-extrabold text-on-accent">M</span>
      <div className="flex flex-col">
        <span className="font-display text-[15px] font-bold">Portal de implantação</span>
        <span className="text-[12px] text-ink-2">Macuxi FDV</span>
      </div>
    </div>
  );
}

/** Link com cara de botão (sem `<button>` dentro de `<a>`). */
export function LinkBotao({ href, children, primario, testId, className }: { href: string; children: ReactNode; primario?: boolean; testId?: string; className?: string }) {
  return (
    <Link
      href={href}
      data-testid={testId}
      className={cx(
        'inline-flex h-[42px] items-center justify-center gap-1.5 rounded-xl px-4 text-[14px] font-semibold no-underline transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent',
        primario ? 'bg-ink text-white hover:bg-[#0b1218]' : 'border border-field bg-surface text-ink hover:bg-ground',
        className,
      )}
    >
      {children}
    </Link>
  );
}

export function AvisoModoFalso() {
  if (!MODO_PORTAL_FALSO) return null;
  return (
    <div data-testid="portal.modo-falso" className="bg-warning-soft px-4 py-1.5 text-center text-[12px] font-semibold text-warning">
      Modo falso: dados fictícios no navegador, sem chamar a API.
    </div>
  );
}

/** Tela estreita (entrar, escolha a empresa). */
export function MolduraEstreita({ children, testId }: { children: ReactNode; testId: string }) {
  return (
    <div className="min-h-screen bg-ground">
      <AvisoModoFalso />
      <div data-testid={testId} className="flex flex-col items-center px-4 py-10 sm:py-16">
        <div className="flex w-full max-w-[440px] flex-col gap-5">
          <Marca />
          {/* cartão branco: hierarquia e contraste dos links (accent sobre o fundo dá 4,2:1; sobre branco, 4,6:1; R-20261106-023316 🟡 9) */}
          <div className="rounded-2xl border border-line bg-surface p-5">{children}</div>
        </div>
      </div>
    </div>
  );
}

export function Campo({
  rotulo,
  erro,
  ajuda,
  testId,
  className,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { rotulo: string; erro?: string | null; ajuda?: ReactNode; testId: string }) {
  // o erro (ou a ajuda) fica ligado ao campo: o leitor de tela lê junto com o rótulo (revisão de UX R-20261106-050553 Y10)
  const idNota = `${useId()}-nota`;
  const nota = erro || ajuda ? idNota : undefined;
  return (
    <label className={cx('flex flex-col gap-1', className)}>
      <span className="text-[13px] font-semibold text-ink">{rotulo}</span>
      <input data-testid={testId} aria-invalid={erro ? true : undefined} aria-describedby={nota} className={campoCss} {...rest} />
      {erro ? (
        <span id={idNota} className="text-[12px] text-danger">
          {erro}
        </span>
      ) : ajuda ? (
        <span id={idNota} className="text-[12px] text-ink-2">
          {ajuda}
        </span>
      ) : null}
    </label>
  );
}

/**
 * Campo de senha com o botão do olho dentro, à direita (spec docs/design/portal-entrar.md §1 e §6): "Mostrar senha" /
 * "Esconder senha" (`MOSTRAR_SENHA`/`ESCONDER_SENHA` do kit) com `IconEye`/`IconEyeOff` do kit, alvo de 44 px. `descrito` liga a lista das regras (`RegrasDaSenha`)
 * ao campo pelo `aria-describedby`, junto com o erro.
 */
export function CampoSenha({
  rotulo,
  erro,
  testId,
  descrito,
  className,
  ...rest
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'type'> & { rotulo: string; erro?: string | null; testId: string; descrito?: string }) {
  const [mostrar, setMostrar] = useState(false);
  const idCampo = useId();
  const idErro = `${idCampo}-erro`;
  const ligados = [descrito, erro ? idErro : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cx('flex flex-col gap-1', className)}>
      <label htmlFor={idCampo} className="text-[13px] font-semibold text-ink">
        {rotulo}
      </label>
      <div className="relative">
        <input
          id={idCampo}
          data-testid={testId}
          type={mostrar ? 'text' : 'password'}
          spellCheck={false}
          autoCapitalize="none"
          aria-invalid={erro ? true : undefined}
          aria-describedby={ligados}
          className={cx(campoCss, 'pr-12')}
          {...rest}
        />
        <button
          type="button"
          data-testid={`${testId}.olho`}
          aria-label={mostrar ? ESCONDER_SENHA : MOSTRAR_SENHA}
          onClick={() => setMostrar((m) => !m)}
          className="absolute right-0 top-0 flex h-11 w-11 items-center justify-center rounded-xl text-ink-2 hover:text-ink focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-accent"
        >
          {mostrar ? <IconEyeOff size={18} /> : <IconEye size={18} />}
        </button>
      </div>
      {erro && (
        <span id={idErro} className="text-[12px] text-danger">
          {erro}
        </span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------------------------- sessão

/** Sessão do portal no `sessionStorage`; `undefined` = ainda não leu (render do servidor e 1º render do cliente). */
export function useSessaoPortal(): SessaoPortal | null | undefined {
  const versao = useSyncExternalStore(assinarSessaoPortal, versaoDaSessaoPortal, () => -1);
  return useMemo(() => (versao < 0 ? undefined : lerSessaoPortal()), [versao]);
}

/** Desvio pedido por um 403/409 de empresa (admin do cliente): a guarda leva à "Escolha a empresa". */
function useDesvioPortal(): DesvioPortal | null {
  return useSyncExternalStore(assinarSessaoPortal, lerDesvioPortal, () => null);
}

/** O que aparece uma vez e ainda não foi baixado (links dos convites): `lib/portal-saida`. */
export function useSaidaSegurada(): SaidaPendente[] {
  const versao = useSyncExternalStore(assinarSaida, versaoDaSaida, () => -1);
  return useMemo(() => (versao < 0 ? [] : pendenciasDeSaida()), [versao]);
}

/** Rótulo do botão de baixar: o da pendência, ou genérico quando há mais de uma (convites novos e renovados). */
function rotuloDeBaixar(p: readonly SaidaPendente[]): string {
  return p.length === 1 && p[0] ? p[0].rotulo : 'Baixar os links';
}

const TEXTO_UMA_VEZ = 'Os links dos convites aparecem só nesta tela.';

const CHECAR_MS = 30_000;

type AvisoAberto = { chave: string; aviso: Exclude<AvisoDeFim, { tipo: 'nenhum' }> };

/**
 * Guarda das páginas internas: sem sessão (ou vencida) → `/entrar`. Com uso recente, renova o token antes do fim; sem uso, deixa
 * vencer (o próximo clique leva ao login). Conta o uso por clique e tecla.
 * Com links por baixar (`lib/portal-saida`): fechar a aba ou o F5 pedem confirmação; perto do fim da sessão aparece o aviso com
 * "Baixar"; se a sessão vencer mesmo assim, a tela fica com o Dialog "Sua sessão terminou" (baixar é local, sem rede) antes do login.
 */
export function GuardaPortal({ children }: { children: ReactNode }) {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const pendencias = useSaidaSegurada();
  const segurando = pendencias.length > 0;
  const [aviso, setAviso] = useState<AvisoAberto | null>(null);
  const [dispensado, setDispensado] = useState<string | null>(null);
  const vencida = sessao !== undefined && (!sessao || estadoDaSessao(sessao, Date.now()) === 'expirada');
  // houve sessão nesta página: se ela some (token vencido, 401 da API), a entrada explica "Sua sessão terminou"
  const teveSessao = useRef(false);
  useEffect(() => {
    if (sessao) teveSessao.current = true;
  }, [sessao]);

  useEffect(() => {
    if (sessao === undefined) return;
    if (!sessao || estadoDaSessao(sessao, Date.now()) === 'expirada') {
      // "Sair" não guarda volta nem aviso; o resto volta para esta página (com o #aba) depois do login (R-20261106-023316 🟡 10)
      if (!retirarSaidaPedida()) guardarRetornoPortal({ caminho: `${window.location.pathname}${window.location.hash}`, sessaoTerminou: teveSessao.current || sessao !== null });
      if (sessao) limparSessaoPortal();
      // com links por baixar, o Dialog "Sua sessão terminou" segura a tela até baixar ou desistir
      if (!segurando) router.replace('/entrar');
    }
  }, [sessao, router, segurando]);

  // 403 `EMPRESA_NAO_PERMITIDA` / 409 `EMPRESA_NAO_ESCOLHIDA` do admin do cliente com 2+ empresas: escolher de novo (T-0093 §4)
  const desvio = useDesvioPortal();
  useEffect(() => {
    if (!desvio || segurando) return;
    retirarDesvioPortal();
    router.replace(CAMINHO_ESCOLHER_EMPRESA);
  }, [desvio, router, segurando]);

  useEffect(() => {
    if (!segurando) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', h);
    return () => window.removeEventListener('beforeunload', h);
  }, [segurando]);

  useEffect(() => {
    const uso = () => registrarUso();
    window.addEventListener('pointerdown', uso);
    window.addEventListener('keydown', uso);
    // timer-permitido: relógio local da sessão do portal (lê o sessionStorage); rede só para renovar o token perto do fim e com uso
    const t = window.setInterval(() => {
      const s = lerSessaoPortal();
      const estado = estadoDaSessao(s, Date.now());
      if (estado === 'expirada') limparSessaoPortal();
      else if (estado === 'renovar' && houveUsoRecente()) void renovarSessaoPortal();
      // links por baixar e a sessão perto do fim: avisa antes (R-20261106-050553 R1)
      const a = avisoDeFimDaSessao(s, Date.now(), { pendente: haSaidaSegurada(), usoRecente: houveUsoRecente() });
      setAviso(a.tipo === 'nenhum' || !s ? null : { chave: `${a.tipo}:${a.tipo === 'teto' ? s.sessao_expira_em : s.expira_em}`, aviso: a });
    }, CHECAR_MS);
    return () => {
      window.removeEventListener('pointerdown', uso);
      window.removeEventListener('keydown', uso);
      window.clearInterval(t);
    };
  }, []);

  if (sessao === undefined || (vencida && !segurando)) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground">
        <LoadingBlock label={sessao === undefined ? 'Carregando…' : 'Indo para a entrada…'} />
      </div>
    );
  }

  const avisoAberto = !vencida && segurando && aviso !== null && aviso.chave !== dispensado ? aviso : null;
  const dispensar = () => setDispensado(avisoAberto?.chave ?? null);
  const parado = avisoAberto?.aviso.tipo === 'parado';

  return (
    <>
      {children}
      <Dialog
        open={vencida}
        title="Sua sessão terminou"
        onClose={() => undefined}
        footer={
          <>
            <Button
              variant="danger"
              data-testid="portal.sessao-terminou.sem-baixar"
              onClick={() => {
                descartarPendenciasDeSaida();
                router.replace('/entrar');
              }}
            >
              Entrar de novo sem baixar
            </Button>
            <Button variant="primary" data-testid="portal.sessao-terminou.baixar" onClick={baixarPendencias}>
              {rotuloDeBaixar(pendencias)}
            </Button>
          </>
        }
      >
        {TEXTO_UMA_VEZ} Baixe agora, antes de entrar de novo: depois eles somem e cada pessoa vai precisar de um link novo pelo Renovar.
      </Dialog>
      <Dialog
        open={avisoAberto !== null}
        title={`Sua sessão termina em ${avisoAberto?.aviso.minutos ?? 0} min${parado ? ' por falta de uso' : ''}`}
        onClose={dispensar}
        footer={
          <>
            <Button
              data-testid="portal.aviso-fim.continuar"
              onClick={() => {
                if (parado) void renovarSessaoPortal();
                dispensar();
              }}
            >
              {parado ? 'Continuar na sessão' : 'Agora não'}
            </Button>
            <Button
              variant="primary"
              data-testid="portal.aviso-fim.baixar"
              onClick={() => {
                baixarPendencias();
                dispensar();
              }}
            >
              {rotuloDeBaixar(pendencias)}
            </Button>
          </>
        }
      >
        {TEXTO_UMA_VEZ} Baixe agora: quando a sessão terminar, eles somem.
        {avisoAberto?.aviso.tipo === 'teto' && ' A sessão de 8 horas não se renova; depois dela, é preciso entrar de novo.'}
      </Dialog>
    </>
  );
}

/** Hora local (fuso do navegador do operador; o portal não é de um tenant). */
const hora = (iso: string) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });

/** Clique comum (sem Ctrl/Cmd/Shift/Alt, botão principal): abre na mesma aba e, por isso, apagaria o que está na tela. */
const naMesmaAba = (e: MouseEvent) => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;

/**
 * Moldura das páginas internas: cabeçalho com a marca, o fim da sessão e "Sair"; para o admin do cliente, o nome da empresa atual
 * e, com 2+ empresas, "Trocar de empresa" (T-0093; spec docs/design/portal-entrar.md §3). A marca leva à página inicial de quem
 * entrou (time da Macuxi: Empresas; admin do cliente: a empresa dele), e o "← voltar" para a lista só aparece para o time da
 * Macuxi. Com links por baixar, a marca, o "← voltar", o "Trocar de empresa" e o "Sair" abrem o Dialog "Baixar os convites antes
 * de sair?" (revisão de UX R-20261106-050553 R1).
 */
export function MolduraPortal({ children, titulo, voltar }: { children: ReactNode; titulo?: ReactNode; voltar?: { href: string; rotulo: string } }) {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const pendencias = useSaidaSegurada();
  const [saida, setSaida] = useState<(() => void) | null>(null);

  const pedirSaida = (acao: () => void) => {
    if (haSaidaSegurada()) setSaida(() => acao);
    else acao();
  };
  const sair = () =>
    pedirSaida(() => {
      void sairDoPortal().then(() => router.replace('/entrar'));
    });
  const navegar = (href: string) => (e: MouseEvent) => {
    if (!haSaidaSegurada() || !naMesmaAba(e)) return;
    e.preventDefault();
    pedirSaida(() => router.push(href));
  };
  const trocar = () => pedirSaida(() => router.push(CAMINHO_ESCOLHER_EMPRESA));
  const inicio = sessao ? destinoDaSessao(sessao) : '/empresas';
  const cliente = sessao?.tipo === 'admin_cliente';
  // o admin do cliente não tem a lista de empresas: o "← Empresas" não aparece para ele
  const voltarVisivel = voltar && !(cliente && voltar.href === '/empresas') ? voltar : undefined;
  const seguir = (baixar: boolean) => {
    const acao = saida;
    setSaida(null);
    if (baixar) baixarPendencias();
    descartarPendenciasDeSaida();
    acao?.();
  };

  return (
    <GuardaPortal>
      <div className="min-h-screen bg-ground">
        <AvisoModoFalso />
        <header className="border-b border-line bg-surface">
          <div className="mx-auto flex w-full max-w-[1120px] flex-wrap items-center justify-between gap-3 px-4 py-3">
            <Link href={inicio} className="no-underline" data-testid="portal.marca" onClick={navegar(inicio)}>
              <Marca />
            </Link>
            <div className="flex min-w-0 flex-wrap items-center gap-3 text-[13px] text-ink-2">
              {/* o nome da empresa (contexto) vem antes do prazo da sessão (R-20261107-174216 🟢 3) */}
              {cliente && sessao?.empresa && (
                <span data-testid="portal.empresa-atual" title={sessao.empresa.nome} className="max-w-[220px] truncate text-[13px] font-semibold text-ink">
                  {sessao.empresa.nome}
                </span>
              )}
              {sessao && (
                <span data-testid="portal.sessao-ate">
                  Sessão até {hora(sessao.sessao_expira_em)}
                  <span className="hidden sm:inline"> · encerra após 15 min sem uso</span>
                </span>
              )}
              {podeTrocarDeEmpresa(sessao) && (
                <Button data-testid="portal.trocar-empresa" size="sm" className="min-h-11" onClick={trocar}>
                  Trocar de empresa
                </Button>
              )}
              <Button data-testid="portal.sair" size="sm" className="min-h-11" onClick={sair}>
                Sair
              </Button>
            </div>
          </div>
        </header>
        <main className="mx-auto flex w-full max-w-[1120px] flex-col gap-5 px-4 py-6">
          {voltarVisivel && (
            <Link
              href={voltarVisivel.href}
              data-testid="portal.voltar"
              onClick={navegar(voltarVisivel.href)}
              className="text-[13px] font-semibold text-accent-ink no-underline hover:underline"
            >
              ← {voltarVisivel.rotulo}
            </Link>
          )}
          {titulo}
          {children}
        </main>
      </div>
      <Dialog
        open={saida !== null}
        title="Baixar os convites antes de sair?"
        onClose={() => setSaida(null)}
        footer={
          <>
            <Button data-testid="portal.saida.cancelar" onClick={() => setSaida(null)}>
              Cancelar
            </Button>
            <Button variant="danger" data-testid="portal.saida.sem-baixar" onClick={() => seguir(false)}>
              Sair sem baixar
            </Button>
            <Button variant="primary" data-testid="portal.saida.baixar" onClick={() => seguir(true)}>
              {rotuloDeBaixar(pendencias)} e sair
            </Button>
          </>
        }
      >
        {TEXTO_UMA_VEZ} Se sair agora, eles somem e cada pessoa vai precisar de um link novo pelo Renovar.
      </Dialog>
    </GuardaPortal>
  );
}
