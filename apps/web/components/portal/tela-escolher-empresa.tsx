'use client';

/**
 * "Escolha a empresa" (T-0093; ADR 0031; spec docs/design/portal-entrar.md §2 e portal-config-enxuto.md §2, sem a instrução e com
 * o código da licença em maiúsculas): admin do cliente com 2+ empresas, depois do login
 * (`empresa: null`) e no "Trocar de empresa". A lista é a da sessão (`sessao.empresas`, só as em que a senha conferiu), na ordem
 * da API. Tocar numa empresa → `POST /v1/plataforma/auth/empresa { tenant_id }` → sessão nova (o token anterior morre) → página
 * da empresa. A empresa atual leva o selo "Atual" e volta para ela sem novo pedido. Sem digitar a senha de novo.
 * 403 `EMPRESA_NAO_PERMITIDA` (de uma página, pela guarda, ou do próprio toque): a empresa sai da lista, nem como "Atual", e o aviso
 * `info` diz o nome (spec §4; R-20261107-174216 🟡 2). Sobrou 1 → entra direto nela; nenhuma → entrada com o aviso.
 * Time da Macuxi e admin com 1 empresa não veem esta tela (vão para a página inicial deles). testIDs: escolher.*.
 */
import { useQueryClient } from '@tanstack/react-query';
import { useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { CODIGOS_PORTAL } from '@macuxi/core/contracts';
import { SessaoPortalSchema } from '@macuxi/platform-sdk';
import { Badge, Button, cx, IconChevronRight, LoadingBlock, Notice } from '@macuxi/ui/web';

import { chamarPortal, ErroPortal, mensagemDoErro, sairDoPortal } from '@/lib/portal-api';
import { codigoDaLicenca } from '@/lib/portal-formato';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import {
  apagarRetornoPortal,
  caminhoDaEmpresa,
  avisoDaEmpresaIndisponivel,
  consumirAvisoPortal,
  consumirEmpresaIndisponivel,
  destinoDaSessao,
  destinoDepoisDoLogin,
  estadoDaSessao,
  guardarRetornoPortal,
  itensDaEscolha,
  guardarAvisoPortal,
  lerRetornoPortal,
  MENSAGEM_EMPRESA_INDISPONIVEL,
  mensagemDaEmpresaIndisponivel,
  passoDaEscolha,
  retirarDesvioPortal,
  retirarSaidaPedida,
  salvarSessaoPortal,
  sessaoSemEmpresa,
} from '@/lib/portal-sessao';
import { MolduraEstreita, useSessaoPortal } from './base';

export const TEXTOS_ESCOLHER = Object.freeze({
  titulo: 'Escolha a empresa',
  atual: 'Atual',
  entrando: 'Entrando…',
  sair: 'Sair',
});

/** Rótulo falado do item enquanto entra nele: o leitor de tela ouve o estado (R-20261107-174216 🟢 2). */
export const rotuloEntrando = (nome: string): string => `Entrando em ${nome}…`;

export function TelaEscolherEmpresa() {
  const sessao = useSessaoPortal();
  const router = useRouter();
  const qc = useQueryClient();
  const [aviso, setAviso] = useState<string | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [escolhendo, setEscolhendo] = useState<string | null>(null);
  // empresas do 403 nesta tela: saem da lista (a sessão também, quando o resto é sessão válida: `sessaoSemEmpresa`)
  const [fora, setFora] = useState<string[]>([]);
  // o aviso e a empresa do 403 são lidos ao montar: até lá não se decide nada (nem entrar direto)
  const [pronto, setPronto] = useState(false);

  // já está aqui: um desvio pendente (403/409) não precisa trazer de novo; o aviso de empresa indisponível aparece uma vez
  useEffect(() => {
    retirarDesvioPortal();
    const e = consumirEmpresaIndisponivel();
    const a = consumirAvisoPortal();
    if (e) {
      setFora([e.id]);
      setAviso(avisoDaEmpresaIndisponivel(e));
    } else if (a) setAviso(a);
    setPronto(true);
  }, []);

  const vencida = sessao !== undefined && (!sessao || estadoDaSessao(sessao, Date.now()) === 'expirada');
  const naoEscolhe = !!sessao && !vencida && (sessao.tipo !== 'admin_cliente' || sessao.empresas.length < 2);
  const passo = sessao && !vencida && !naoEscolhe && pronto ? passoDaEscolha(sessao, fora) : null;
  // houve sessão nesta tela: se ela some (401, token vencido), a entrada explica "Sua sessão terminou"; o "Sair" não
  const teveSessao = useRef(false);
  useEffect(() => {
    if (sessao) teveSessao.current = true;
  }, [sessao]);
  useEffect(() => {
    if (vencida) {
      if (!retirarSaidaPedida() && (teveSessao.current || sessao !== null)) guardarRetornoPortal({ caminho: null, sessaoTerminou: true });
      router.replace('/entrar');
    } else if (naoEscolhe && sessao) router.replace(destinoDaSessao(sessao));
  }, [vencida, naoEscolhe, sessao, router]);

  /** `direto`: a entrada automática na única que sobrou depois do 403 mantém o aviso com o nome da que saiu. */
  const escolher = async (id: string, atual: boolean, direto = false) => {
    if (escolhendo || !sessao) return;
    setErro(null);
    if (atual) {
      router.replace(caminhoDaEmpresa(id));
      return;
    }
    if (!direto) setAviso(null);
    setEscolhendo(id);
    try {
      const nova = await chamarPortal(ROTAS_PORTAL.escolherEmpresa, { metodo: 'POST', corpo: { tenant_id: id }, schema: SessaoPortalSchema });
      // outra empresa: nada do cache da anterior pode aparecer
      qc.clear();
      salvarSessaoPortal(nova);
      const destino = destinoDepoisDoLogin(nova, lerRetornoPortal()?.caminho ?? null);
      apagarRetornoPortal();
      router.replace(destino);
    } catch (x) {
      // 401: a sessão foi limpa e a guarda desta tela leva à entrada
      if (x instanceof ErroPortal && x.status === 403 && x.codigo === CODIGOS_PORTAL.empresaNaoPermitida) {
        // sai da lista (e da sessão, quando dá): tocar de novo daria o mesmo 403
        const e = sessao.empresas.find((y) => y.id === id);
        setFora((f) => (f.includes(id) ? f : [...f, id]));
        setAviso(e ? mensagemDaEmpresaIndisponivel(e.nome) : MENSAGEM_EMPRESA_INDISPONIVEL);
        const sem = sessaoSemEmpresa(sessao, id);
        if (sem) salvarSessaoPortal(sem);
      } else if (!(x instanceof ErroPortal && x.status === 401)) setErro(mensagemDoErro(x));
      setEscolhendo(null);
    }
  };

  // o que sobrou depois do 403: 1 empresa = entra direto (uma tentativa por empresa); nenhuma = entrada com o aviso
  // `escolher` muda a cada render: o efeito a lê pela referência, e decide só pelo passo
  const escolherRef = useRef(escolher);
  useEffect(() => {
    escolherRef.current = escolher;
  });
  const [tentou, setTentou] = useState<string | null>(null);
  const tipoDoPasso = passo?.tipo ?? null;
  const idDoPasso = passo && 'id' in passo ? passo.id : null;
  useEffect(() => {
    if (escolhendo) return;
    if (tipoDoPasso === 'pagina' && idDoPasso) router.replace(caminhoDaEmpresa(idDoPasso));
    else if (tipoDoPasso === 'entrar_em' && idDoPasso && tentou !== idDoPasso) {
      setTentou(idDoPasso);
      void escolherRef.current(idDoPasso, false, true);
    } else if (tipoDoPasso === 'entrada') {
      // não é "sessão terminou": o Sair marca a saída, e a guarda desta tela leva à entrada, que mostra o aviso
      guardarAvisoPortal(MENSAGEM_EMPRESA_INDISPONIVEL);
      void sairDoPortal();
    }
  }, [tipoDoPasso, idDoPasso, escolhendo, tentou, router]);

  // `entrar_em` que falhou (ex.: sem rede) mostra a lista com a única empresa e o erro, para tocar de novo
  const listaVisivel = tipoDoPasso === 'lista' || (tipoDoPasso === 'entrar_em' && tentou === idDoPasso && !escolhendo);
  if (!sessao || !listaVisivel) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-ground">
        <LoadingBlock label={tipoDoPasso === 'entrar_em' ? TEXTOS_ESCOLHER.entrando : 'Carregando…'} />
      </div>
    );
  }

  const sair = () => {
    void sairDoPortal().then(() => router.replace('/entrar'));
  };

  return (
    <MolduraEstreita testId="escolher.tela">
      <div className="flex flex-col gap-4">
        <h1 className="m-0 text-[24px] font-bold">{TEXTOS_ESCOLHER.titulo}</h1>
        {aviso && (
          <div data-testid="escolher.aviso">
            <Notice tone="info">{aviso}</Notice>
          </div>
        )}
        {erro && (
          <div data-testid="escolher.erro">
            <Notice tone="danger">{erro}</Notice>
          </div>
        )}
        <ul data-testid="escolher.lista" aria-label={TEXTOS_ESCOLHER.titulo} className="m-0 flex list-none flex-col gap-2 p-0">
          {itensDaEscolha(sessao, fora).map((e) => (
            <li key={e.id}>
              <button
                type="button"
                data-testid={`escolher.empresa-${e.codigo}`}
                aria-label={escolhendo === e.id ? rotuloEntrando(e.nome) : e.rotuloAcessivel}
                aria-busy={escolhendo === e.id || undefined}
                disabled={escolhendo !== null}
                onClick={() => void escolher(e.id, e.atual)}
                className={cx(
                  'flex min-h-[52px] w-full items-center gap-3 rounded-xl border border-line bg-surface px-4 py-2.5 text-left transition-colors',
                  'hover:bg-ground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:cursor-default',
                  escolhendo !== null && escolhendo !== e.id && 'opacity-60',
                )}
              >
                <span className="flex min-w-0 flex-1 flex-col">
                  <span className="flex items-center gap-2">
                    <span className="truncate text-[15px] font-semibold text-ink">{e.nome}</span>
                    {e.atual && <Badge tone="neutral">{TEXTOS_ESCOLHER.atual}</Badge>}
                  </span>
                  <span className="font-mono text-[13px] text-ink-2">{codigoDaLicenca(e.codigo)}</span>
                </span>
                {escolhendo === e.id ? (
                  <span className="text-[13px] font-semibold text-ink-2">{TEXTOS_ESCOLHER.entrando}</span>
                ) : (
                  <span className="text-ink-2" aria-hidden="true">
                    <IconChevronRight size={18} />
                  </span>
                )}
              </button>
            </li>
          ))}
        </ul>
        <div>
          <Button data-testid="escolher.sair" variant="link" className="min-h-11" onClick={sair}>
            {TEXTOS_ESCOLHER.sair}
          </Button>
        </div>
      </div>
    </MolduraEstreita>
  );
}
