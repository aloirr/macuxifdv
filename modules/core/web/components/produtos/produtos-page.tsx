'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { usePode } from '@macuxi/platform-sdk/react';
import { api, errorMessage } from '@macuxi/platform-sdk/web';
import { formatBRL, formatPct } from '@macuxi/comum';
import { Badge, Button, CampoBusca, CampoFormulario, CLASSE_CAMPO, Drawer, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, Notice, PageHeader, Panel, rotuloComContagem, TabelaDados, useToast, type ColunaDaTabela } from '@macuxi/ui/web';
import { ProdutoParametrosSchema, ProdutosPrecoListaSchema, type ProdutoPreco } from '../../../contracts';
import { fraseDoVazio, LimparFiltros, QuadroDaLista, useBuscaComEspera } from '../../lib/lista-bko';
import { rotuloMedidaDoProduto } from '../../lib/medidas';
import { filtrarMedidas, MedidasPanel, useMedidas } from './medidas-panel';
import { ProdutoMedidasDialog } from './produto-medidas-dialog';
import { descontoMaximoAplicavel, lucroCents, margemNoMinimoPct, margemPct, markupPct, precoMinimoCents } from '../../../domain';

const pct = (v: number | null) => (v === null ? '—' : formatPct(v, 2));
const brl = (v: number | null) => (v === null ? '—' : formatBRL(v));
/** "12,34" ou "12.34" em reais vira centavos; vazio = nulo; inválido = `undefined`. */
const paraCentavos = (t: string): number | null | undefined => {
  const s = t.trim().replace(/\./g, '').replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 ? Math.round(n * 100) : undefined;
};
const paraPct = (t: string): number | null | undefined => {
  const s = t.trim().replace(',', '.');
  if (s === '') return null;
  const n = Number(s);
  return Number.isFinite(n) && n >= 0 && n <= 100 ? n : undefined;
};
const emReais = (c: number | null) => (c === null ? '' : (c / 100).toFixed(2).replace('.', ','));

interface Rascunho {
  id: string;
  nome: string;
  custo: string;
  preco: string;
  desconto: string;
}

/**
 * Preço e custo do produto (RN-CORE-18, RN-VEN-11; T-0062). Margem, markup, lucro, preço mínimo e margem no mínimo são
 * calculados pelo domínio (a mesma regra da API) e aparecem no diálogo enquanto se digita. O custo é dado interno: só
 * gerente, analista e admin veem (ação `produto.editar_preco`), e ele nunca vai ao app. A aba Parâmetros define o desconto
 * máximo padrão do tenant (analista e admin).
 */
export function ProdutosPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const podeParametros = usePode('produto.parametros');
  const podeMedidas = usePode('medida.gerenciar');
  const [aba, setAba] = useState<'produtos' | 'medidas' | 'parametros'>('produtos');
  const [medidasDe, setMedidasDe] = useState<ProdutoPreco | null>(null);
  const medidas = useMedidas();
  const [termoMedidas, setTermoMedidas] = useState('');
  const [busca, setBusca] = useState('');
  const campoBusca = useBuscaComEspera(busca, (v) => setBusca(v.trim()));
  const [rascunho, setRascunho] = useState<Rascunho | null>(null);
  const [erroApi, setErroApi] = useState<string | null>(null);
  const [padraoTexto, setPadraoTexto] = useState<string | null>(null);

  const lista = useQuery({
    queryKey: ['core', 'produtos', busca],
    queryFn: async ({ signal }) => ProdutosPrecoListaSchema.parse(await api<unknown>('/core/produtos', { query: busca ? { q: busca } : {}, signal })),
  });
  const padrao = lista.data?.padrao_desconto_pct ?? 15;

  const salvar = useMutation({
    mutationFn: (r: { id: string; custo: number | null; preco: number | null; desconto: number | null }) =>
      api(`/core/produtos/${r.id}/preco`, { method: 'PUT', body: { custo_cents: r.custo, preco_venda_cents: r.preco, desconto_maximo_pct: r.desconto } }),
    onSuccess: async () => {
      setRascunho(null);
      toast('success', 'Produto salvo.');
      await qc.invalidateQueries({ queryKey: ['core', 'produtos'] });
    },
    onError: (e) => setErroApi(errorMessage(e)),
  });
  const salvarPadrao = useMutation({
    mutationFn: (v: number) => api('/core/produtos/parametros', { method: 'PUT', body: ProdutoParametrosSchema.parse({ desconto_maximo_produto_pct: v }) }),
    onSuccess: async () => {
      setPadraoTexto(null);
      toast('success', 'Desconto máximo padrão salvo.');
      await qc.invalidateQueries({ queryKey: ['core', 'produtos'] });
    },
    onError: (e) => toast('danger', errorMessage(e)),
  });

  const custo = rascunho ? paraCentavos(rascunho.custo) : null;
  const preco = rascunho ? paraCentavos(rascunho.preco) : null;
  const desconto = rascunho ? paraPct(rascunho.desconto) : null;
  const valido = custo !== undefined && preco !== undefined && desconto !== undefined;
  const calc =
    valido && preco !== null && preco !== undefined
      ? {
          margem: margemPct(preco, custo ?? null),
          markup: markupPct(preco, custo ?? null),
          lucro: lucroCents(preco, custo ?? null),
          minimo: precoMinimoCents(preco, desconto ?? null, padrao),
          margemMinimo: margemNoMinimoPct(preco, custo ?? null, desconto ?? null, padrao),
          aplicavel: descontoMaximoAplicavel(desconto ?? null, padrao),
        }
      : null;

  const abrir = (p: ProdutoPreco) => {
    setErroApi(null);
    setRascunho({ id: p.id, nome: p.nome, custo: emReais(p.custo_cents), preco: emReais(p.preco_venda_cents), desconto: p.desconto_maximo_pct === null ? '' : String(p.desconto_maximo_pct).replace('.', ',') });
  };
  const valorPadrao = padraoTexto ?? String(padrao).replace('.', ',');
  const padraoNovo = paraPct(valorPadrao);
  const produtos = lista.data?.itens ?? [];

  const colunas: ReadonlyArray<ColunaDaTabela<ProdutoPreco>> = [
    {
      id: 'produto',
      titulo: 'Produto',
      largura: '30%',
      texto: (p) => p.nome,
      celula: (p) => (
        <>
          {p.nome}
          <span className="block truncate font-mono text-[12px] font-normal text-ink-2">{p.sku}</span>
          {!p.vendavel && <Badge tone="warning">Sem preço: não vendável</Badge>}
        </>
      ),
    },
    { id: 'preco', titulo: 'Preço', numero: true, largura: '110px', celula: (p) => brl(p.preco_venda_cents), texto: (p) => brl(p.preco_venda_cents) },
    { id: 'custo', titulo: 'Custo', numero: true, prioridade: 2, largura: '110px', celula: (p) => (p.custo_nao_informado ? '—' : brl(p.custo_cents)), texto: (p) => (p.custo_nao_informado ? 'Custo não informado' : brl(p.custo_cents)) },
    { id: 'margem', titulo: 'Margem', numero: true, prioridade: 2, largura: '90px', celula: (p) => pct(p.margem_pct), texto: (p) => pct(p.margem_pct) },
    {
      id: 'medida',
      titulo: 'Medida',
      prioridade: 2,
      largura: '90px',
      celula: (p) => <span data-testid={`produtos.medida.${p.sku}`}>{rotuloMedidaDoProduto(p)}</span>,
      texto: (p) => rotuloMedidaDoProduto(p),
    },
    {
      id: 'desconto',
      titulo: 'Desc. máx.',
      numero: true,
      prioridade: 2,
      largura: '100px',
      celula: (p) => formatPct(p.desconto_maximo_aplicavel_pct, 2),
      texto: (p) => `${formatPct(p.desconto_maximo_aplicavel_pct, 2)}${p.desconto_maximo_pct === null ? ' (padrão)' : ''}`,
    },
    {
      id: 'unidades',
      titulo: 'Unidades de venda',
      prioridade: 3,
      largura: '18%',
      texto: (p) => (p.unidades ?? []).map((u) => u.rotulo).join(', '),
      celula: (p) => (
        // RN-VEN-15: UN/CX e fator vindos do ERP; a padrão marcada. Sem cadastro, só a unidade base.
        <span className="flex gap-1" data-testid={`produtos.unidades.${p.sku}`}>
          {(p.unidades ?? []).map((u) => (
            <Badge key={`${u.unidade}-${u.fator}`} tone={u.padrao ? 'success' : 'neutral'}>
              {u.rotulo}
              {u.padrao ? ' · padrão' : ''}
            </Badge>
          ))}
        </span>
      ),
    },
    { id: 'minimo', titulo: 'Preço mínimo', numero: true, prioridade: 3, largura: '110px', celula: (p) => brl(p.preco_minimo_cents), texto: (p) => brl(p.preco_minimo_cents) },
  ];

  const erroDoCampo = (v: number | null | undefined, msg: string) => (v === undefined ? msg : undefined);

  return (
    <div className="flex w-full max-w-[1100px] flex-col gap-5" data-testid="produtos.tela">
      <PageHeader title="Preço e custo dos produtos" />
      <div className="flex gap-2" role="tablist">
        <Button variant={aba === 'produtos' ? 'primary' : undefined} onClick={() => setAba('produtos')} data-testid="produtos.aba-produtos">
          {rotuloComContagem('Produtos', lista.data ? produtos.length : 0)}
        </Button>
        <Button variant={aba === 'medidas' ? 'primary' : undefined} onClick={() => setAba('medidas')} data-testid="produtos.aba-medidas">
          {rotuloComContagem('Medidas', medidas.data ? filtrarMedidas(medidas.data, termoMedidas).length : 0)}
        </Button>
        {podeParametros && (
          <Button variant={aba === 'parametros' ? 'primary' : undefined} onClick={() => setAba('parametros')} data-testid="produtos.aba-parametros">
            Parâmetros
          </Button>
        )}
      </div>

      {aba === 'medidas' && <MedidasPanel termo={termoMedidas} setTermo={setTermoMedidas} />}

      {aba === 'parametros' && podeParametros && (
        <Panel title="Desconto máximo padrão">
          <div className="flex max-w-[260px] flex-col gap-3">
            <CampoFormulario rotulo="Desconto máximo do produto (%)" erro={padraoNovo === undefined ? 'Informe um valor entre 0 e 100.' : undefined}>
              <input inputMode="decimal" value={valorPadrao} onChange={(e) => setPadraoTexto(e.target.value)} aria-invalid={padraoNovo === undefined} data-testid="produtos.parametro-desconto" className={CLASSE_CAMPO} />
            </CampoFormulario>
            <div>
              <Button variant="primary" disabled={salvarPadrao.isPending || padraoNovo === undefined || padraoNovo === null} onClick={() => padraoNovo != null && salvarPadrao.mutate(padraoNovo)} data-testid="produtos.parametro-salvar">
                {salvarPadrao.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </div>
          </div>
        </Panel>
      )}

      {aba === 'produtos' && (
        <>
          <FilterBar>
            <CampoBusca
              rotulo="Buscar código ou nome do produto"
              {...campoBusca}
              data-testid="produtos.busca"
            />
            <LimparFiltros ligado={busca !== ''} onLimpar={() => setBusca('')} testId="produtos.limpar-filtros" />
          </FilterBar>
          {lista.isError && <ErrorBlock message={errorMessage(lista.error)} onRetry={() => void lista.refetch()} />}
          {lista.isPending && <LoadingBlock label="Carregando os produtos…" />}
          {lista.data && (
            <QuadroDaLista vazia={produtos.length === 0} vazio={<EstadoVazio titulo={fraseDoVazio('produto', false, busca !== '')} testId="produtos.vazio" />}>
              <TabelaDados
                rotulo="Produtos"
                colunas={colunas}
                linhas={produtos}
                chave={(p) => p.id}
                linhaTestId={(p) => `produtos.linha.${p.sku}`}
                aoAbrir={abrir}
                acoes={(p) => [
                  { id: 'editar', rotulo: 'Editar', aoEscolher: () => abrir(p), testId: `produtos.editar.${p.sku}` },
                  ...(podeMedidas ? [{ id: 'medidas', rotulo: 'Medidas', aoEscolher: () => setMedidasDe(p), desligada: !medidas.data, testId: `produtos.medidas.${p.sku}` }] : []),
                ]}
              />
            </QuadroDaLista>
          )}
        </>
      )}

      {medidasDe && medidas.data && <ProdutoMedidasDialog produto={medidasDe} medidas={medidas.data} onFechar={() => setMedidasDe(null)} onSalvo={() => setMedidasDe(null)} />}

      <Drawer
        open={rascunho !== null}
        title={rascunho ? `Editar ${rascunho.nome}` : ''}
        onClose={() => setRascunho(null)}
        rodape={
          rascunho && (
            <>
              <Button onClick={() => setRascunho(null)}>Cancelar</Button>
              <Button
                variant="primary"
                disabled={salvar.isPending || !valido}
                onClick={() => valido && salvar.mutate({ id: rascunho.id, custo: custo ?? null, preco: preco ?? null, desconto: desconto ?? null })}
                data-testid="produtos.salvar"
              >
                {salvar.isPending ? 'Salvando…' : 'Salvar'}
              </Button>
            </>
          )
        }
      >
        {rascunho && (
          <div className="flex flex-col gap-4">
            {erroApi && <Notice tone="danger">{erroApi}</Notice>}
            <CampoFormulario rotulo="Custo (R$)" erro={erroDoCampo(custo, 'Use um número positivo.')}>
              <input inputMode="decimal" value={rascunho.custo} onChange={(e) => setRascunho({ ...rascunho, custo: e.target.value })} aria-invalid={custo === undefined} data-testid="produtos.custo" className={CLASSE_CAMPO} />
            </CampoFormulario>
            <CampoFormulario rotulo="Preço de venda (R$)" erro={erroDoCampo(preco, 'Use um número positivo.')}>
              <input inputMode="decimal" value={rascunho.preco} onChange={(e) => setRascunho({ ...rascunho, preco: e.target.value })} aria-invalid={preco === undefined} data-testid="produtos.preco" className={CLASSE_CAMPO} />
            </CampoFormulario>
            <CampoFormulario rotulo="Desconto máximo (%)" opcional erro={erroDoCampo(desconto, 'Use um valor de 0 a 100.')}>
              <input
                inputMode="decimal"
                value={rascunho.desconto}
                placeholder={`Padrão ${formatPct(padrao, 2)}`}
                onChange={(e) => setRascunho({ ...rascunho, desconto: e.target.value })}
                aria-invalid={desconto === undefined}
                data-testid="produtos.desconto"
                className={CLASSE_CAMPO}
              />
            </CampoFormulario>
            {calc && (
              <dl className="m-0 grid grid-cols-2 gap-x-4 gap-y-1 rounded-xl border border-field p-3 text-[13px]" data-testid="produtos.calculo">
                <dt>Margem</dt>
                <dd className="m-0 text-right tabular-nums">{pct(calc.margem)}</dd>
                <dt>Markup</dt>
                <dd className="m-0 text-right tabular-nums">{pct(calc.markup)}</dd>
                <dt>Lucro</dt>
                <dd className="m-0 text-right tabular-nums">{brl(calc.lucro)}</dd>
                <dt>Desconto máximo aplicado</dt>
                <dd className="m-0 text-right tabular-nums">{formatPct(calc.aplicavel, 2)}</dd>
                <dt>Preço mínimo</dt>
                <dd className="m-0 text-right tabular-nums">{brl(calc.minimo)}</dd>
                <dt>Margem no preço mínimo</dt>
                <dd className="m-0 text-right tabular-nums">{pct(calc.margemMinimo)}</dd>
              </dl>
            )}
            {valido && preco === null && <p className="m-0 text-[13px] text-ink-2">Sem preço de venda o produto não é vendável.</p>}
          </div>
        )}
      </Drawer>
    </div>
  );
}
