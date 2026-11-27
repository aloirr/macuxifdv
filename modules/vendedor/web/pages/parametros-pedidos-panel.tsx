'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { somenteDigitos } from '@macuxi/comum';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoFormulario, CLASSE_CAMPO, ErrorBlock, GrupoOpcoesCartao, IconAlert, LoadingBlock, Notice, OpcaoCartao } from '@macuxi/ui/web';
import { ParametrosPedidosSchema, ROTA_PARAMETROS_PEDIDOS, type ParametrosPedidos } from '../../contracts';
import {
  alterado,
  CAMPOS_PARAMETROS_PEDIDOS,
  centavosDoTexto,
  conferirParametro,
  conferirPedidoMinimo,
  OPCOES_CREDITO_EXCEDIDO,
  OPCOES_ESTOQUE_INSUFICIENTE,
  SUCESSO_PARAMETRO,
  textoDeCentavos,
  type ChaveDoPainelPedidos,
  type ChaveParametroPedidos,
  type OpcaoDeAcao,
} from '../lib/parametros-pedidos';

const CHAVE = ['vendedor', 'parametros', 'pedidos'] as const;
const CAMINHO = `/vendedor/${ROTA_PARAMETROS_PEDIDOS}`;

/**
 * Parâmetros › Pedidos (RN-VEN-13, RN-VEN-18): um formulário só, parametrizado pela chave; cada painel envia só a sua chave no PUT.
 * v1.0.39 (spec 7.5): Pedido mínimo (RN-VEN-22), Crédito excedido (RN-VEN-12) e Estoque insuficiente (RN-VEN-20) têm painel próprio, no mesmo molde.
 * A ação (`alcada.gerenciar`) é checada pelo shell na declaração do painel e pela API. Spec 7.1/7.3/7.4 (designer-ux).
 * testIDs: `vendedor-parametros-pedidos.<chave>.campo` · `.salvar` · `.sucesso`.
 */
const LEITURA = (signal?: AbortSignal) => api<unknown>(CAMINHO, { signal }).then((r) => ParametrosPedidosSchema.parse(r));

/** Leitura, gravação de uma chave e estados comuns (salvo, erro da API) dos painéis de 7.5. */
function useParametroPedidos<C extends ChaveDoPainelPedidos>(chave: C) {
  const qc = useQueryClient();
  const [sucesso, setSucesso] = useState(false);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const q = useQuery({ queryKey: CHAVE, queryFn: ({ signal }) => LEITURA(signal) });
  const gravar = useMutation({
    mutationFn: (valor: ParametrosPedidos[C]) => api(CAMINHO, { method: 'PUT', body: { [chave]: valor } }),
    onSuccess: async () => {
      setSucesso(true);
      await qc.invalidateQueries({ queryKey: CHAVE });
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const enviar = (valor: ParametrosPedidos[C], aoGravar?: () => void) => {
    setErroApi(null);
    setSucesso(false);
    gravar.mutate(valor, { onSuccess: aoGravar });
  };
  return { q, salvo: q.data?.[chave], gravando: gravar.isPending, sucesso, erroApi, enviar, limparSucesso: () => setSucesso(false), texto: SUCESSO_PARAMETRO[chave] };
}

function RodapeSalvar({ testId, ativo, gravando, sucesso, texto, onSalvar }: { testId: string; ativo: boolean; gravando: boolean; sucesso: boolean; texto: string; onSalvar: () => void }) {
  return (
    <div className="flex items-center gap-3">
      <Button variant="primary" disabled={gravando || !ativo} onClick={onSalvar} data-testid={`${testId}.salvar`}>
        {gravando ? 'Salvando…' : 'Salvar'}
      </Button>
      {sucesso && (
        <Notice tone="success">
          <span data-testid={`${testId}.sucesso`}>{texto}</span>
        </Notice>
      )}
    </div>
  );
}

function PainelParametroPedidos({ chave }: { chave: ChaveParametroPedidos }) {
  const campo = CAMPOS_PARAMETROS_PEDIDOS[chave];
  const p = useParametroPedidos(chave);
  const [texto, setTexto] = useState<string | null>(null);
  const [erroCampo, setErroCampo] = useState<string | undefined>();
  const salvo = p.salvo;
  if (p.q.isPending) return <LoadingBlock label="Carregando…" />;
  if (p.q.isError || salvo === undefined) return <ErrorBlock message={errorMessage(p.q.error)} onRetry={() => void p.q.refetch()} />;
  const salvar = () => {
    const r = conferirParametro(campo, texto ?? String(salvo));
    setErroCampo(r.ok ? undefined : r.erro);
    if (r.ok) p.enviar(r.valor);
  };
  const testId = `vendedor-parametros-pedidos.${chave}`;
  return (
    <div className="flex flex-col gap-3">
      {p.erroApi && <Notice tone="danger">{p.erroApi}</Notice>}
      <CampoFormulario rotulo={campo.rotulo} erro={erroCampo} className="max-w-[260px]">
        <span className="text-[13px] font-normal text-ink-2">{campo.ajuda}</span>
        <span className="flex items-center gap-2">
          <input
            className={CLASSE_CAMPO}
            inputMode="numeric"
            value={texto ?? String(salvo)}
            aria-invalid={erroCampo ? true : undefined}
              aria-describedby={erroCampo ? 'pedido-minimo-erro' : undefined}
            data-testid={`${testId}.campo`}
            onChange={(e) => {
              setTexto(somenteDigitos(e.target.value));
              setErroCampo(undefined);
              p.limparSucesso();
            }}
          />
          <span className="text-[15px] font-normal text-ink-2">dias</span>
        </span>
      </CampoFormulario>
      <RodapeSalvar testId={testId} ativo={alterado(texto, salvo)} gravando={p.gravando} sucesso={p.sucesso} texto={p.texto} onSalvar={salvar} />
    </div>
  );
}

/** Parâmetros › Pedidos › Título vencido (RN-VEN-13). */
export function TituloVencidoPanel() {
  return <PainelParametroPedidos chave="titulo_vencido_dias" />;
}

/** Parâmetros › Pedidos › Preço do orçamento (RN-VEN-18). */
export function PrecoOrcamentoPanel() {
  return <PainelParametroPedidos chave="validade_orcamento_dias" />;
}

/** Parâmetros › Pedidos › Pedido mínimo (RN-VEN-22, spec 7.5.1): "R$" dentro do campo, vírgula na digitação, centavos na API. */
export function PedidoMinimoPanel() {
  const p = useParametroPedidos('pedido_minimo_cents');
  const [modo, setModo] = useState<'sem' | 'exigir' | null>(null);
  const [texto, setTexto] = useState<string | null>(null);
  const [erroCampo, setErroCampo] = useState<string | undefined>();
  const salvo = p.salvo;
  if (p.q.isPending) return <LoadingBlock label="Carregando…" />;
  if (p.q.isError || salvo === undefined) return <ErrorBlock message={errorMessage(p.q.error)} onRetry={() => void p.q.refetch()} />;
  const efetivo = modo ?? (salvo > 0 ? 'exigir' : 'sem');
  const valorTexto = texto ?? (salvo > 0 ? textoDeCentavos(salvo) : '');
  const alteradoAgora = efetivo === 'sem' ? salvo > 0 : salvo === 0 || (texto !== null && centavosDoTexto(texto) !== salvo);
  const escolher = (m: 'sem' | 'exigir') => {
    setModo(m);
    // voltar para "Sem pedido mínimo" esconde o campo; o valor digitado não fica guardado
    if (m === 'sem') setTexto(null);
    setErroCampo(undefined);
    p.limparSucesso();
  };
  const salvar = () => {
    if (efetivo === 'sem') return p.enviar(0);
    const r = conferirPedidoMinimo(valorTexto);
    setErroCampo(r.ok ? undefined : r.erro);
    if (r.ok) p.enviar(r.valor);
  };
  const testId = 'vendedor-parametros-pedidos.pedido_minimo_cents';
  return (
    <div className="flex flex-col gap-3">
      {p.erroApi && <Notice tone="danger">{p.erroApi}</Notice>}
      <GrupoOpcoesCartao rotulo="Pedido mínimo" testId={`${testId}.grupo`}>
        <OpcaoCartao nome="pedido-minimo" valor="sem" selecionada={efetivo === 'sem'} onSelecionar={() => escolher('sem')} rotulo="Sem pedido mínimo" testId={`${testId}.sem`} />
        <OpcaoCartao nome="pedido-minimo" valor="exigir" selecionada={efetivo === 'exigir'} onSelecionar={() => escolher('exigir')} rotulo="Exigir a partir de" testId={`${testId}.exigir`} />
      </GrupoOpcoesCartao>
      {efetivo === 'exigir' && (
        <div className="flex max-w-[260px] flex-col gap-1">
          <span className="text-[13px] font-normal text-ink-2">Abaixo desse valor, o pedido só sai como orçamento.</span>
          <span className="relative block">
            <span aria-hidden="true" className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-[15px] text-ink-2">
              R$
            </span>
            <input
              className={`${CLASSE_CAMPO} pl-10`}
              inputMode="decimal"
              aria-label="Valor mínimo"
              value={valorTexto}
              aria-invalid={erroCampo ? true : undefined}
              data-testid={`${testId}.campo`}
              onChange={(e) => {
                setTexto(e.target.value.replace(/[^\d.,]/g, ''));
                setErroCampo(undefined);
                p.limparSucesso();
              }}
            />
          </span>
          {erroCampo && (
            <span id="pedido-minimo-erro" className="flex items-start gap-1 text-[12px] font-normal text-danger">
              <IconAlert size={13} className="mt-[2px] shrink-0" />
              {erroCampo}
            </span>
          )}
        </div>
      )}
      <RodapeSalvar testId={testId} ativo={alteradoAgora} gravando={p.gravando} sucesso={p.sucesso} texto={p.texto} onSalvar={salvar} />
    </div>
  );
}

/** Painel de uma escolha entre ações em cartão (Crédito excedido e Estoque insuficiente, spec 7.5.2 e 7.5.3). */
function PainelDeAcao<C extends 'credito_excedido_acao' | 'estoque_insuficiente_acao'>({ chave, nome, rotuloDoGrupo, opcoes }: { chave: C; nome: string; rotuloDoGrupo: string; opcoes: readonly OpcaoDeAcao<ParametrosPedidos[C]>[] }) {
  const p = useParametroPedidos(chave);
  const [escolhida, setEscolhida] = useState<ParametrosPedidos[C] | null>(null);
  const salvo = p.salvo;
  if (p.q.isPending) return <LoadingBlock label="Carregando…" />;
  if (p.q.isError || salvo === undefined) return <ErrorBlock message={errorMessage(p.q.error)} onRetry={() => void p.q.refetch()} />;
  const atual = escolhida ?? salvo;
  const testId = `vendedor-parametros-pedidos.${chave}`;
  return (
    <div className="flex flex-col gap-3">
      {p.erroApi && <Notice tone="danger">{p.erroApi}</Notice>}
      <GrupoOpcoesCartao rotulo={rotuloDoGrupo} mostrarRotulo testId={`${testId}.grupo`}>
        {opcoes.map((o) => (
          <OpcaoCartao
            key={o.valor}
            nome={nome}
            valor={o.valor}
            selecionada={atual === o.valor}
            onSelecionar={() => {
              setEscolhida(o.valor);
              p.limparSucesso();
            }}
            rotulo={o.rotulo}
            {...(o.apoio ? { apoio: o.apoio } : {})}
            testId={`${testId}.${o.valor}`}
          />
        ))}
      </GrupoOpcoesCartao>
      <RodapeSalvar
        testId={testId}
        ativo={atual !== salvo}
        gravando={p.gravando}
        sucesso={p.sucesso}
        texto={p.texto}
        onSalvar={() => {
          // a escolha só se limpa depois do PUT e do refetch; no erro ela fica
          p.enviar(atual, () => setEscolhida(null));
        }}
      />
    </div>
  );
}

/** Parâmetros › Pedidos › Crédito excedido (RN-VEN-12, P-6). */
export function CreditoExcedidoPanel() {
  return <PainelDeAcao chave="credito_excedido_acao" nome="credito-excedido" rotuloDoGrupo="Pedido a prazo acima do crédito disponível" opcoes={OPCOES_CREDITO_EXCEDIDO} />;
}

/** Parâmetros › Pedidos › Estoque insuficiente (RN-VEN-20). */
export function EstoqueInsuficientePanel() {
  return <PainelDeAcao chave="estoque_insuficiente_acao" nome="estoque-insuficiente" rotuloDoGrupo="Item com quantidade acima do estoque da filial" opcoes={OPCOES_ESTOQUE_INSUFICIENTE} />;
}
