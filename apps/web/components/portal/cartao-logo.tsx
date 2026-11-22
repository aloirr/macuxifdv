'use client';

/**
 * Cartão "Logo" e cartão "Nome fantasia" da aba Empresa do portal `config.` (T-0182; spec docs/design/telas/logo-cliente.md §2;
 * desenho docs/desenho/T-0182-logo-cliente.md §2). O "Logo" é o primeiro cartão da aba.
 * - Os 6 estados da spec: sem logo, arquivo escolhido (pré-visualização antes de salvar), salvando, logo salva (Trocar e
 *   Remover), arquivo recusado (volta ao anterior, com o erro no lugar dos limites) e o diálogo "Remover a logo?".
 * - "Enviar logo" e "Trocar" abrem o seletor de arquivo do sistema (PNG e JPG), sem o "Choose File" do navegador na tela.
 * - Só o time da Macuxi grava (RN-CORE-33). O admin do cliente vê a logo e o nome fantasia, sem botões.
 * - A logo salva vem do `GET .../logo` com o token do portal e vira `blob:` para o `<img>`.
 * - Item 15 (v1.0.17): no cartão "Logo", o liga/desliga "Ocultar o logo da Macuxi" (só o time da Macuxi vê e grava;
 *   `PUT .../marca/ocultar-macuxi`). Ligado e com a logo salva, o app e o BKO mostram só a logo do cliente.
 * Regras e textos em `lib/portal-logo.ts`. testIDs: empresa-logo.*, empresa-nome-fantasia.*.
 */
import { useRef, useState, type ChangeEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { MarcaEmpresaSchema, MAX_NOME_FANTASIA, type MarcaEmpresa } from '@macuxi/platform-sdk';
import { Button, CLASSE_CAMPO, cx, Dialog, ErrorBlock, IconAlert, Interruptor, LoadingBlock, Panel } from '@macuxi/ui/web';

import { blobDoPortal, chamarPortal, ehRotaAusente, mensagemDoErro } from '@/lib/portal-api';
import {
  ACEITA_LOGO,
  altDaLogo,
  botoesDoCartao,
  erroDaGravacao,
  estadoDoCartao,
  linhaDeBaixo,
  nomeMudou,
  recusaDoArquivo,
  TEXTOS_LOGO,
  type BotaoLogo,
} from '@/lib/portal-logo';
import { ROTAS_PORTAL } from '@/lib/portal-rotas';
import { useUrlDoBlob } from '@/lib/url-do-blob';

export const chaveMarca = (tenant: string) => ['portal', tenant, 'marca'] as const;

/** Os dois cartões (Logo e Nome fantasia), com a marca da empresa lida uma vez só. */
export function CartoesMarca({ tenant, podeGravar }: { tenant: string; podeGravar: boolean }) {
  const q = useQuery({ queryKey: chaveMarca(tenant), queryFn: () => chamarPortal(ROTAS_PORTAL.marcaDaEmpresa(tenant), { schema: MarcaEmpresaSchema }) });
  if (q.isPending)
    return (
      <Panel title={TEXTOS_LOGO.titulo}>
        <LoadingBlock label={TEXTOS_LOGO.carregando} />
      </Panel>
    );
  if (q.isError)
    return (
      <Panel title={TEXTOS_LOGO.titulo}>
        {ehRotaAusente(q.error) ? (
          <span data-testid="empresa-logo.em-breve" className="text-[13px] text-ink-2">
            {TEXTOS_LOGO.rotaAusente}
          </span>
        ) : (
          <ErrorBlock message={mensagemDoErro(q.error)} onRetry={() => void q.refetch()} />
        )}
      </Panel>
    );
  return (
    <>
      <CartaoLogo tenant={tenant} marca={q.data} podeGravar={podeGravar} />
      <CartaoNomeFantasia tenant={tenant} marca={q.data} podeGravar={podeGravar} />
    </>
  );
}

function CartaoLogo({ tenant, marca, podeGravar }: { tenant: string; marca: MarcaEmpresa; podeGravar: boolean }) {
  const qc = useQueryClient();
  const sha = marca.logo?.sha256 ?? null;
  const salva = useQuery({
    queryKey: ['portal', tenant, 'logo', sha],
    queryFn: () => blobDoPortal(ROTAS_PORTAL.logoDaEmpresa(tenant)),
    enabled: sha !== null,
    staleTime: Infinity,
  });
  const urlSalva = useUrlDoBlob(sha ? salva.data : null);
  const [escolhido, setEscolhido] = useState<File | null>(null);
  const urlEscolhido = useUrlDoBlob(escolhido);
  const [salvando, setSalvando] = useState(false);
  const [removendo, setRemovendo] = useState(false);
  const [dialogo, setDialogo] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const seletor = useRef<HTMLInputElement>(null);

  const gravada = (m: MarcaEmpresa) => qc.setQueryData(chaveMarca(tenant), m);

  const aoEscolher = async (ev: ChangeEvent<HTMLInputElement>) => {
    const arquivo = ev.target.files?.[0] ?? null;
    // o mesmo arquivo pode ser escolhido de novo depois de um erro
    ev.target.value = '';
    if (!arquivo) return;
    const recusa = recusaDoArquivo(new Uint8Array(await arquivo.arrayBuffer()), arquivo.type);
    setErro(recusa);
    setEscolhido(recusa ? null : arquivo);
  };

  const salvar = async () => {
    if (!escolhido || salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      gravada(await chamarPortal(ROTAS_PORTAL.logoDaEmpresa(tenant), { metodo: 'PUT', corpo: escolhido, schema: MarcaEmpresaSchema }));
      setEscolhido(null);
    } catch (x) {
      const e = erroDaGravacao(x);
      setErro(e.mensagem);
      if (e.doArquivo) setEscolhido(null);
    } finally {
      setSalvando(false);
    }
  };

  const remover = async () => {
    if (removendo) return;
    setRemovendo(true);
    setErro(null);
    try {
      gravada(await chamarPortal(ROTAS_PORTAL.logoDaEmpresa(tenant), { metodo: 'DELETE', schema: MarcaEmpresaSchema }));
    } catch (x) {
      setErro(erroDaGravacao(x).mensagem);
    } finally {
      setRemovendo(false);
      setDialogo(false);
    }
  };

  const acoes: Record<BotaoLogo, () => void> = {
    enviar: () => seletor.current?.click(),
    trocar: () => seletor.current?.click(),
    salvar: () => void salvar(),
    salvando: () => undefined,
    cancelar: () => {
      setEscolhido(null);
      setErro(null);
    },
    'cancelar-desabilitado': () => undefined,
    remover: () => {
      setErro(null);
      setDialogo(true);
    },
  };

  return (
    <Panel title={TEXTOS_LOGO.titulo} label={TEXTOS_LOGO.titulo}>
      <VistaCartaoLogo
        estado={estadoDoCartao({ escolhido: escolhido !== null, salvando, temLogoSalva: sha !== null })}
        imagem={urlEscolhido ?? urlSalva}
        alt={altDaLogo(marca)}
        podeGravar={podeGravar}
        erro={erro}
        aoTocar={(b) => acoes[b]()}
      />
      {podeGravar && <OcultarMarcaMacuxi tenant={tenant} marca={marca} aoGravar={gravada} />}
      {podeGravar && (
        <input ref={seletor} type="file" accept={ACEITA_LOGO} hidden tabIndex={-1} aria-hidden="true" data-testid="empresa-logo.arquivo" onChange={(e) => void aoEscolher(e)} />
      )}
      <Dialog
        open={dialogo}
        title={TEXTOS_LOGO.dialogo}
        onClose={() => !removendo && setDialogo(false)}
        footer={
          <>
            <Button data-testid="empresa-logo.dialogo-cancelar" disabled={removendo} onClick={() => setDialogo(false)}>
              {TEXTOS_LOGO.cancelar}
            </Button>
            <Button variant="danger" data-testid="empresa-logo.dialogo-remover" disabled={removendo} onClick={() => void remover()}>
              {TEXTOS_LOGO.remover}
            </Button>
          </>
        }
      >
        {null}
      </Dialog>
    </Panel>
  );
}

/** Item 15: "Ocultar o logo da Macuxi" (só o time da Macuxi). Grava no toque; o erro fica na linha, como no cartão. */
function OcultarMarcaMacuxi({ tenant, marca, aoGravar }: { tenant: string; marca: MarcaEmpresa; aoGravar: (m: MarcaEmpresa) => void }) {
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const gravar = async (ocultar: boolean) => {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      aoGravar(await chamarPortal(ROTAS_PORTAL.ocultarMarcaMacuxi(tenant), { metodo: 'PUT', corpo: { ocultar }, schema: MarcaEmpresaSchema }));
    } catch (x) {
      setErro(erroDaGravacao(x).mensagem);
    } finally {
      setSalvando(false);
    }
  };
  return <VistaOcultarMarca ligado={marca.ocultar_marca_macuxi} salvando={salvando} erro={erro} aoMudar={(v) => void gravar(v)} />;
}

/** Miolo do liga/desliga, sem estado nem rede (o teste desenha daqui). */
export function VistaOcultarMarca({ ligado, salvando, erro, aoMudar }: { ligado: boolean; salvando: boolean; erro: string | null; aoMudar: (v: boolean) => void }) {
  return (
    <div data-testid="empresa-logo.ocultar-marca" className="flex flex-col gap-1 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-4">
        <span id="empresa-logo-ocultar-marca" className="text-[14px]">
          {TEXTOS_LOGO.ocultarMarca}
        </span>
        <Interruptor ligado={ligado} onChange={aoMudar} desabilitado={salvando} rotuloId="empresa-logo-ocultar-marca" testId="empresa-logo.ocultar-marca.chave" />
      </div>
      <div aria-live="polite">
        {erro && (
          <span data-testid="empresa-logo.ocultar-marca.erro" className="flex items-center gap-1.5 text-[13px] font-semibold text-danger">
            <IconAlert size={14} className="shrink-0" />
            {erro}
          </span>
        )}
      </div>
    </div>
  );
}

const ROTULO_DO_BOTAO: Record<BotaoLogo, string> = {
  enviar: TEXTOS_LOGO.enviar,
  salvar: TEXTOS_LOGO.salvar,
  salvando: TEXTOS_LOGO.salvando,
  cancelar: TEXTOS_LOGO.cancelar,
  'cancelar-desabilitado': TEXTOS_LOGO.cancelar,
  trocar: TEXTOS_LOGO.trocar,
  remover: TEXTOS_LOGO.remover,
};

/**
 * Miolo do cartão "Logo", sem estado nem rede (o teste desenha os estados daqui): a caixa da pré-visualização (240 × 96, branca,
 * borda #DFE2E6, raio 12, folga 12, `contain`; vazia: tracejada #C9CED5 sobre o Pérola), os botões e a linha de baixo.
 */
export function VistaCartaoLogo({
  estado,
  imagem,
  alt,
  podeGravar,
  erro,
  aoTocar,
}: {
  estado: ReturnType<typeof estadoDoCartao>;
  imagem: string | null;
  alt: string;
  podeGravar: boolean;
  erro: string | null;
  aoTocar: (b: BotaoLogo) => void;
}) {
  const botoes = botoesDoCartao(estado, podeGravar);
  const baixo = linhaDeBaixo(erro, podeGravar);
  const vazia = estado.tipo === 'sem-logo';
  return (
    <div data-testid="empresa-logo" data-estado={estado.tipo} className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-4">
        <div
          data-testid="empresa-logo.caixa"
          className={cx(
            'box-border flex h-[96px] w-[240px] shrink-0 items-center justify-center rounded-xl p-3',
            vazia ? 'border border-dashed border-field bg-ground' : 'border border-line bg-surface',
          )}
        >
          {imagem && !vazia && <img data-testid="empresa-logo.imagem" src={imagem} alt={alt} className="max-h-full max-w-full object-contain" />}
        </div>
        {botoes.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {botoes.map((b) => (
              <Button
                key={b}
                data-testid={`empresa-logo.${b}`}
                variant={b === 'salvar' || b === 'salvando' ? 'primary' : 'secondary'}
                disabled={b === 'salvando' || b === 'cancelar-desabilitado'}
                // "Remover" é secundário com o texto em vermelho (spec §2); o `!` vence o `text-ink` do secundário do kit
                className={b === 'remover' ? 'text-danger!' : undefined}
                onClick={() => aoTocar(b)}
              >
                {ROTULO_DO_BOTAO[b]}
              </Button>
            ))}
          </div>
        )}
      </div>
      <div aria-live="polite">
        {baixo?.tipo === 'erro' && (
          <span data-testid="empresa-logo.erro" className="flex items-center gap-1.5 text-[13px] font-semibold text-danger">
            <IconAlert size={14} className="shrink-0" />
            {baixo.texto}
          </span>
        )}
        {baixo?.tipo === 'limites' && (
          <span data-testid="empresa-logo.limites" className="text-[13px] text-ink-2">
            {baixo.texto}
          </span>
        )}
      </div>
    </div>
  );
}

/** Nome fantasia ("Licenciado para <nome>" no Mais do app; vazio = a razão social). Só o time da Macuxi edita. */
function CartaoNomeFantasia({ tenant, marca, podeGravar }: { tenant: string; marca: MarcaEmpresa; podeGravar: boolean }) {
  const qc = useQueryClient();
  const [nome, setNome] = useState(marca.nome_fantasia ?? '');
  const [salvando, setSalvando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);

  // Admin do cliente: só o nome fantasia (nunca a razão social sob este rótulo). Vazio = o campo vazio que o time da Macuxi vê,
  // sem texto (achado do testes, T-0182).
  if (!podeGravar) {
    const valor = marca.nome_fantasia?.trim() ?? '';
    return (
      <Panel title={TEXTOS_LOGO.nomeFantasia} label={TEXTOS_LOGO.nomeFantasia}>
        {valor ? (
          <span data-testid="empresa-nome-fantasia.valor" className="text-[14px]">
            {valor}
          </span>
        ) : (
          <div data-testid="empresa-nome-fantasia.vazio" aria-label={TEXTOS_LOGO.nomeFantasia} className={cx(CLASSE_CAMPO, 'max-w-[360px]')} />
        )}
      </Panel>
    );
  }

  const salvar = async () => {
    if (salvando) return;
    setSalvando(true);
    setErro(null);
    try {
      const m = await chamarPortal(ROTAS_PORTAL.marcaDaEmpresa(tenant), { metodo: 'PUT', corpo: { nome_fantasia: nome }, schema: MarcaEmpresaSchema });
      qc.setQueryData(chaveMarca(tenant), m);
      setNome(m.nome_fantasia ?? '');
    } catch (x) {
      setErro(erroDaGravacao(x).mensagem);
    } finally {
      setSalvando(false);
    }
  };

  return (
    <Panel title={TEXTOS_LOGO.nomeFantasia} label={TEXTOS_LOGO.nomeFantasia}>
      <form
        className="flex flex-wrap items-center gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void salvar();
        }}
      >
        <input
          data-testid="empresa-nome-fantasia.campo"
          aria-label={TEXTOS_LOGO.nomeFantasia}
          aria-invalid={erro ? true : undefined}
          className={cx(CLASSE_CAMPO, 'max-w-[360px]')}
          value={nome}
          maxLength={MAX_NOME_FANTASIA}
          placeholder={marca.razao_social}
          onChange={(e) => {
            setNome(e.target.value);
            setErro(null);
          }}
        />
        <Button type="submit" variant="primary" data-testid="empresa-nome-fantasia.salvar" disabled={salvando || !nomeMudou(nome, marca.nome_fantasia)}>
          {salvando ? TEXTOS_LOGO.salvando : TEXTOS_LOGO.salvar}
        </Button>
      </form>
      <div aria-live="polite">
        {erro && (
          <span data-testid="empresa-nome-fantasia.erro" className="flex items-center gap-1.5 text-[13px] font-semibold text-danger">
            <IconAlert size={14} className="shrink-0" />
            {erro}
          </span>
        )}
      </div>
    </Panel>
  );
}
