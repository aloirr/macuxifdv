'use client';

/**
 * Menu do usuário no canto superior direito de todas as telas web: BKO (`app-shell.tsx`) e portal de implantação
 * (`portal/base.tsx`); pedido do Alexandre, R-20261124-083005, 083110 e 083356, itens 01 e 02. O botão mostra quem entrou (nome,
 * perfil e cargo; sem o nome, o perfil) e abre "Dados cadastrais" (quando há linha além do botão), "Trocar a senha"
 * (quando há rota para a pessoa) e "Sair". Uma informação, um lugar: nome, perfil e cargo só aqui, em nenhum outro ponto do
 * cabeçalho.
 * - Acessível: botão com `aria-haspopup="menu"`/`aria-expanded`; a lista abre com clique, Enter, Espaço ou seta para baixo, com o
 *   foco no 1º item; setas, Home e End andam (`indiceNoMenu` do kit); Esc e Tab fecham e devolvem o foco ao botão; clique fora,
 *   rolagem e mudança de tamanho fecham. Posição `fixed` pelo `posicaoDoMenu` do kit (nenhum quadro corta).
 * - "Dados cadastrais": gaveta só de leitura, com o que a sessão tem (`linhasDosDados`).
 * - "Trocar a senha": gaveta com senha atual, nova e a repetição (`CampoSenha` e `RegrasDaSenha` do kit, regras do Core), a mesma
 *   tabela de erros do "Trocar senha" do app (docs/design/trocar-senha/spec.md §4 e §5). Quem chama faz o pedido (`enviar`).
 * testIDs: menu-usuario.{botao,lista,dados,trocar-senha,sair}, dados-cadastrais.<chave>, trocar-senha.*.
 */
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react';
import {
  CODIGO_EMPRESA_REGEX,
  CODIGO_EMPRESA_TAMANHO,
  ehEmailValido,
  erroDaTrocaVoluntaria,
  faltasNaSenha,
  MENSAGEM_CODIGO_EMPRESA,
  mensagemDaSenha,
  precheckDaTrocaVoluntaria,
  repeticaoDaSenha,
  SENHA_MIN_CARACTERES,
  TEXTOS_ESQUECI,
  TEXTOS_TROCAR_SENHA,
  type ErroDaTrocaVoluntaria,
} from '@macuxi/core/contracts';
import {
  Button,
  CAMPO_REPITA_A_SENHA,
  CAMPO_SENHA_NOVA,
  CampoSenha,
  cx,
  Drawer,
  IconChevronDown,
  indiceNoMenu,
  Notice,
  posicaoDoMenu,
  RegrasDaSenha,
  useToast,
} from '@macuxi/ui/web';

import { Campo } from '@/components/campo-acesso';
import { erroNoFormatoDoCore, identificacaoDoBotao, iniciais, linhasDosDados, temDadosAlemDoBotao, TEXTOS_MENU_USUARIO as T, type IdentidadeDoUsuario } from '@/lib/menu-usuario';

/** O que a gaveta manda a quem chama. `codigo_empresa` e `email` só quando a gaveta pediu o campo. */
export interface PedidoDeTroca {
  codigo_empresa?: string;
  email?: string;
  senha_atual: string;
  senha_nova: string;
}

export interface TrocaDeSenhaNoMenu {
  /** `true` = a gaveta pede o código da empresa (sessão do BKO de antes da v1.0.34, sem o código). */
  pedirCodigo?: boolean;
  /** `true` = a gaveta pede o e-mail (admin do cliente no portal: a sessão do portal não traz o e-mail). */
  pedirEmail?: boolean;
  /** Faz o pedido; lança o erro da API. `true` = mostra "Senha trocada."; `false` = a sessão saiu (quem chama já levou à entrada). */
  enviar: (p: PedidoDeTroca) => Promise<boolean>;
  /** Erro da API → aviso da gaveta; sem ele, a tabela do Core (`erroDaTrocaVoluntaria`). O portal soma os códigos da rota dele. */
  erro?: (e: unknown, senhaNova: string) => ErroDaTrocaVoluntaria;
}

export interface PropsMenuUsuario {
  identidade: IdentidadeDoUsuario;
  onSair: () => void;
  /** Sem a prop, o menu não tem "Trocar a senha" (ex.: BKO da demonstração, sem a rota). */
  trocarSenha?: TrocaDeSenhaNoMenu;
  /** `escuro`: na faixa do portal ou no menu grafite do BKO estreito; `claro`: na barra do topo do BKO. */
  tom: 'claro' | 'escuro';
  className?: string;
}

/** Tela larga (≥ 768 px, o `md` do Tailwind): o BKO põe o menu na barra do topo; abaixo disso, no menu grafite. */
const CONSULTA_TELA_LARGA = '(min-width: 768px)';
function assinarLargura(ouvinte: () => void): () => void {
  const m = window.matchMedia(CONSULTA_TELA_LARGA);
  m.addEventListener('change', ouvinte);
  return () => m.removeEventListener('change', ouvinte);
}
/** Um menu só no DOM (não dois escondidos por CSS): o servidor e o 1º quadro supõem a tela larga. */
export function useTelaLarga(): boolean {
  return useSyncExternalStore(
    assinarLargura,
    () => window.matchMedia(CONSULTA_TELA_LARGA).matches,
    () => true,
  );
}

type Acao = { id: 'dados' | 'trocar-senha' | 'sair'; rotulo: string };
const ALTURA_ITEM = 44;
type Gaveta = 'dados' | 'trocar-senha' | null;

export function MenuUsuario({ identidade, onSair, trocarSenha, tom, className }: PropsMenuUsuario) {
  const [aberto, setAberto] = useState(false);
  const [gaveta, setGaveta] = useState<Gaveta>(null);
  const [estilo, setEstilo] = useState<CSSProperties>({});
  const botao = useRef<HTMLButtonElement>(null);
  const lista = useRef<HTMLDivElement>(null);
  const id = useId();
  const avisar = useToast();
  const { titulo, detalhe } = identificacaoDoBotao(identidade);
  const acoes: Acao[] = [
    ...(temDadosAlemDoBotao(identidade) ? [{ id: 'dados' as const, rotulo: T.dadosCadastrais }] : []),
    ...(trocarSenha ? [{ id: 'trocar-senha' as const, rotulo: T.trocarSenha }] : []),
    { id: 'sair', rotulo: T.sair },
  ];

  const fechar = useCallback((voltarFoco: boolean) => {
    setAberto(false);
    if (voltarFoco) botao.current?.focus();
  }, []);

  useLayoutEffect(() => {
    if (!aberto || !botao.current) return;
    const r = botao.current.getBoundingClientRect();
    setEstilo(posicaoDoMenu(r, { largura: window.innerWidth, altura: window.innerHeight }, acoes.length * ALTURA_ITEM + 12));
    lista.current?.querySelector<HTMLButtonElement>('[role="menuitem"]')?.focus();
  }, [aberto, acoes.length]);

  useEffect(() => {
    if (!aberto) return;
    const fora = (e: MouseEvent) => {
      const alvo = e.target as Node;
      if (!lista.current?.contains(alvo) && !botao.current?.contains(alvo)) fechar(false);
    };
    const sair = () => fechar(false);
    document.addEventListener('mousedown', fora);
    window.addEventListener('scroll', sair, true);
    window.addEventListener('resize', sair);
    return () => {
      document.removeEventListener('mousedown', fora);
      window.removeEventListener('scroll', sair, true);
      window.removeEventListener('resize', sair);
    };
  }, [aberto, fechar]);

  const teclasDaLista = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.key === 'Escape' || e.key === 'Tab') {
      e.preventDefault();
      fechar(true);
      return;
    }
    const botoes = [...(lista.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? [])];
    const atual = botoes.findIndex((b) => b === document.activeElement);
    const prox = indiceNoMenu(e.key, atual, acoes.map(() => false));
    if (prox !== null) {
      e.preventDefault();
      botoes[prox]?.focus();
    }
  };

  const escolher = (a: Acao) => {
    fechar(a.id === 'sair' ? false : true);
    if (a.id === 'sair') onSair();
    else setGaveta(a.id);
  };

  const fecharGaveta = () => {
    setGaveta(null);
    botao.current?.focus();
  };

  const escuro = tom === 'escuro';
  return (
    <div className={cx('relative', className)}>
      <button
        ref={botao}
        type="button"
        data-testid="menu-usuario.botao"
        aria-haspopup="menu"
        aria-expanded={aberto}
        aria-controls={aberto ? id : undefined}
        aria-label={`${T.rotulo}: ${[titulo, detalhe].filter(Boolean).join(', ')}`}
        onClick={(e) => {
          e.stopPropagation();
          setAberto((v) => !v);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown' && !aberto) {
            e.preventDefault();
            setAberto(true);
          }
        }}
        className={cx(
          'flex min-h-11 max-w-[min(320px,60vw)] items-center gap-2.5 rounded-xl p-[3px] text-left sm:py-1 sm:pr-2 sm:pl-1 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2',
          escuro
            ? 'border border-white/40 text-white hover:bg-white/10 focus-visible:outline-white'
            : 'border border-line bg-surface text-ink hover:bg-ground focus-visible:outline-accent',
          aberto && (escuro ? 'bg-white/10' : 'bg-ground'),
        )}
      >
        <span aria-hidden className={cx('flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold', escuro ? 'bg-white text-ink' : 'bg-accent text-white')}>
          {iniciais(titulo)}
        </span>
        {/* abaixo de 640 px só o círculo com as iniciais (o nome, o perfil e o cargo vão no rótulo do botão e nos Dados cadastrais) */}
        <span className="hidden min-w-0 flex-col sm:flex">
          <span data-testid="menu-usuario.titulo" className="truncate text-[15px] leading-5 font-semibold">
            {titulo}
          </span>
          {detalhe && (
            <span data-testid="menu-usuario.detalhe" className={cx('truncate text-[12px] leading-4', escuro ? 'text-white/85' : 'text-ink-2')}>
              {detalhe}
            </span>
          )}
        </span>
        <IconChevronDown size={16} aria-hidden className={cx('hidden shrink-0 transition-transform sm:block', aberto && 'rotate-180')} />
      </button>
      {aberto && (
        <div
          ref={lista}
          id={id}
          role="menu"
          aria-label={T.rotulo}
          data-testid="menu-usuario.lista"
          onKeyDown={teclasDaLista}
          onClick={(e) => e.stopPropagation()}
          style={{ position: 'fixed', ...estilo }}
          className="z-[55] flex min-w-[220px] flex-col rounded-xl border border-line bg-surface py-1.5 shadow-lg"
        >
          {acoes.map((a) => (
            <button
              key={a.id}
              type="button"
              role="menuitem"
              tabIndex={-1}
              data-testid={`menu-usuario.${a.id}`}
              onClick={() => escolher(a)}
              className={cx(
                'flex h-11 items-center px-4 text-left text-[15px] font-medium whitespace-nowrap text-ink hover:bg-ground focus-visible:bg-accent-soft focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-accent',
                a.id === 'sair' && acoes.length > 1 && 'mt-1 border-t border-line-2',
              )}
            >
              {a.rotulo}
            </button>
          ))}
        </div>
      )}
      <GavetaDadosCadastrais aberta={gaveta === 'dados'} identidade={identidade} onFechar={fecharGaveta} />
      {trocarSenha && (
        <GavetaTrocarSenha
          aberta={gaveta === 'trocar-senha'}
          troca={trocarSenha}
          onFechar={fecharGaveta}
          onTrocada={(mostrar) => {
            setGaveta(null);
            if (mostrar) {
              avisar('success', TEXTOS_TROCAR_SENHA.trocada);
              botao.current?.focus();
            }
          }}
        />
      )}
    </div>
  );
}

/** "Dados cadastrais": só leitura, o que a sessão tem. */
export function GavetaDadosCadastrais({ aberta, identidade, onFechar }: { aberta: boolean; identidade: IdentidadeDoUsuario; onFechar: () => void }) {
  return (
    <Drawer open={aberta} title={T.dadosCadastrais} onClose={onFechar}>
      <dl data-testid="dados-cadastrais" className="m-0 flex flex-col divide-y divide-line rounded-xl border border-line bg-surface">
        {linhasDosDados(identidade).map((l) => (
          <div key={l.chave} className="flex flex-col gap-0.5 px-4 py-3">
            <dt className="text-[13px] font-semibold text-ink-2">{l.rotulo}</dt>
            <dd data-testid={`dados-cadastrais.${l.chave}`} className="m-0 text-[15px] break-words text-ink">
              {l.valor}
            </dd>
          </div>
        ))}
      </dl>
    </Drawer>
  );
}

type Aviso = { texto: string; tom: 'danger' | 'warning' } | null;
type Destaque = { atual?: string; codigo?: string; email?: string };

/** "Trocar a senha" (spec trocar-senha §3 a §5, na gaveta do BKO e do portal). */
export function GavetaTrocarSenha({ aberta, troca, onFechar, onTrocada }: { aberta: boolean; troca: TrocaDeSenhaNoMenu; onFechar: () => void; onTrocada: (mostrar: boolean) => void }) {
  const [codigo, setCodigo] = useState('');
  const [email, setEmail] = useState('');
  const [atual, setAtual] = useState('');
  const [nova, setNova] = useState('');
  const [repetida, setRepetida] = useState('');
  const [olhos, setOlhos] = useState({ atual: false, nova: false, repita: false });
  const [destacar, setDestacar] = useState(false);
  const [erros, setErros] = useState<Destaque>({});
  const [aviso, setAviso] = useState<Aviso>(null);
  const [salvando, setSalvando] = useState(false);
  const base = useId();
  const ids = { codigo: `${base}-codigo`, email: `${base}-email`, atual: `${base}-atual`, nova: `${base}-nova`, repita: `${base}-repita`, regras: `${base}-regras` };

  // ao abrir de novo, tudo vazio (as senhas nunca ficam na memória depois de fechar)
  useEffect(() => {
    if (aberta) return;
    setCodigo('');
    setEmail('');
    setAtual('');
    setNova('');
    setRepetida('');
    setOlhos({ atual: false, nova: false, repita: false });
    setDestacar(false);
    setErros({});
    setAviso(null);
  }, [aberta]);

  const focar = (campo: keyof typeof ids) => window.setTimeout(() => document.getElementById(ids[campo])?.focus(), 0);
  const digitou = (f: (v: string) => void) => (v: string) => {
    f(v);
    setAviso(null);
  };

  const salvar = async () => {
    if (salvando) return;
    setAviso(null);
    const novosErros: Destaque = {};
    if (troca.pedirCodigo && !CODIGO_EMPRESA_REGEX.test(codigo.trim())) novosErros.codigo = MENSAGEM_CODIGO_EMPRESA;
    if (troca.pedirEmail && !ehEmailValido(email)) novosErros.email = TEXTOS_ESQUECI.emailInvalido;
    const p = precheckDaTrocaVoluntaria(atual, nova, repetida);
    if (p.atualVazia) novosErros.atual = T.atualVazia;
    setErros(novosErros);
    if (novosErros.codigo) return focar('codigo');
    if (novosErros.email) return focar('email');
    if (!p.ok) {
      setDestacar(true);
      return focar(p.foco ?? 'nova');
    }
    setSalvando(true);
    try {
      const mostrar = await troca.enviar({
        ...(troca.pedirCodigo ? { codigo_empresa: codigo.trim().toUpperCase() } : {}),
        ...(troca.pedirEmail ? { email: email.trim() } : {}),
        senha_atual: atual,
        senha_nova: nova,
      });
      onTrocada(mostrar);
    } catch (x) {
      const r = troca.erro ? troca.erro(x, nova) : erroDaTrocaVoluntaria(erroNoFormatoDoCore(x), nova);
      if (r.texto) setAviso({ texto: r.texto, tom: r.tom });
      if (r.acao === 'limpar_atual') {
        setAtual('');
        focar('atual');
      } else if (r.acao === 'limpar_novas') {
        setNova('');
        setRepetida('');
        setDestacar(false);
        focar('nova');
      } else if (r.acao === 'destacar') setDestacar(true);
    } finally {
      setSalvando(false);
    }
  };

  const faltas = faltasNaSenha(nova);
  const rodape: ReactNode = (
    <>
      <Button data-testid="trocar-senha.cancelar" onClick={onFechar}>
        {T.cancelar}
      </Button>
      <Button data-testid="trocar-senha.salvar" variant="primary" disabled={salvando} onClick={() => void salvar()}>
        {salvando ? TEXTOS_TROCAR_SENHA.salvando : TEXTOS_TROCAR_SENHA.salvar}
      </Button>
    </>
  );

  return (
    <Drawer open={aberta} title={T.trocarSenha} onClose={onFechar} rodape={rodape}>
      <form
        data-testid="trocar-senha"
        noValidate
        className="flex flex-col gap-4"
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
      >
        {aviso && (
          <div data-testid="trocar-senha.aviso" aria-live="assertive">
            <Notice tone={aviso.tom}>{aviso.texto}</Notice>
          </div>
        )}
        {troca.pedirCodigo && (
          <Campo
            id={ids.codigo}
            rotulo={TEXTOS_ESQUECI.codigoEmpresa}
            testId="trocar-senha.codigo"
            type="text"
            autoComplete="organization"
            maxLength={CODIGO_EMPRESA_TAMANHO}
            value={codigo}
            erro={erros.codigo}
            onChange={(e) => digitou(setCodigo)(e.target.value)}
          />
        )}
        {troca.pedirEmail && (
          <Campo
            id={ids.email}
            rotulo={TEXTOS_ESQUECI.email}
            testId="trocar-senha.email"
            type="email"
            autoComplete="username"
            value={email}
            erro={erros.email}
            onChange={(e) => digitou(setEmail)(e.target.value)}
          />
        )}
        <CampoSenha
          id={ids.atual}
          rotulo={TEXTOS_TROCAR_SENHA.senhaAtual}
          testId="trocar-senha.atual"
          finalidade="login"
          visivel={olhos.atual}
          onAlternar={() => setOlhos((o) => ({ ...o, atual: !o.atual }))}
          value={atual}
          erro={erros.atual}
          onChange={(e) => {
            digitou(setAtual)(e.target.value);
            setErros((x) => ({ ...x, atual: undefined }));
          }}
        />
        <CampoSenha
          id={ids.nova}
          rotulo={CAMPO_SENHA_NOVA}
          testId="trocar-senha.nova"
          finalidade="criacao"
          visivel={olhos.nova}
          onAlternar={() => setOlhos((o) => ({ ...o, nova: !o.nova }))}
          value={nova}
          descrito={ids.regras}
          onChange={(e) => digitou(setNova)(e.target.value)}
        />
        <CampoSenha
          id={ids.repita}
          rotulo={CAMPO_REPITA_A_SENHA}
          testId="trocar-senha.repita"
          finalidade="criacao"
          visivel={olhos.repita}
          onAlternar={() => setOlhos((o) => ({ ...o, repita: !o.repita }))}
          value={repetida}
          descrito={`${ids.regras}-repeticao`}
          onChange={(e) => digitou(setRepetida)(e.target.value)}
        />
        <RegrasDaSenha
          id={ids.regras}
          faltas={faltas}
          minimo={SENHA_MIN_CARACTERES}
          resumo={mensagemDaSenha(faltas, nova) ?? undefined}
          repeticao={repeticaoDaSenha(nova, repetida)}
          destacar={destacar}
          testId="trocar-senha.regras"
        />
        {/* Enter em qualquer campo envia */}
        <button type="submit" hidden aria-hidden tabIndex={-1} />
      </form>
    </Drawer>
  );
}
