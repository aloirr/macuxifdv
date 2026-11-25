'use client';

import { useEffect, useMemo, useState } from 'react';
import { downloadBlob, errorMessage } from '@macuxi/platform-sdk/web';
import { Button, CampoBusca, type ColunaDaTabela, ErrorBlock, EstadoVazio, FilterBar, LoadingBlock, type AcaoDoMenu, MenuAcoes, PageHeader, SelectField, TabelaDados, useToast } from '@macuxi/ui/web';
import { localIsoDate } from '@macuxi/comum/fuso';
import {
  buscaDosFiltrosFormas,
  descricaoNaTabela,
  FILTROS_FORMAS_VAZIOS,
  lerFiltrosFormas,
  linhasDePrazos,
  prazoEfetivamenteAtivo,
  prazosToCsv,
  diasDasParcelas,
  textoDoPrazoMedio,
  type FiltrosFormas,
  type LinhaPrazo,
} from '../lib/formas-pagamento';
import { useFormasEPrazos, useSessaoDoBko } from '../lib/queries';

/**
 * Cadastros → Formas de pagamento e prazos (RN-VEN-24, ADR 0072): só consulta, numa tabela única de prazos (a forma é uma coluna;
 * Cartão 1X/2X/3X são prazos da forma Cartão de crédito). Tudo vem do ERP: não há criar, editar nem inativar. Busca, forma e situação
 * na URL, exportar CSV. A proteção real é na API (as rotas de escrita respondem 403). Promotor nunca chega aqui (regra 7).
 */
export function FormasPagamentoPage() {
  const sessao = useSessaoDoBko();
  const toast = useToast();
  const [filtros, setFiltros] = useState<FiltrosFormas>(() => lerFiltrosFormas(typeof window === 'undefined' ? '' : window.location.search));
  const dados = useFormasEPrazos();
  const [busca, setBusca] = useState(filtros.q);
  // busca ao digitar, com espera de 300 ms (§P4)
  useEffect(() => {
    if (busca === filtros.q) return;
    const t = setTimeout(() => mudar({ q: busca }), 300);
    return () => clearTimeout(t);
  }, [busca]);

  const mudar = (patch: Partial<FiltrosFormas>) =>
    setFiltros((atual) => {
      const novo = { ...atual, ...patch };
      window.history.replaceState(window.history.state, '', `${window.location.pathname}${buscaDosFiltrosFormas(novo)}`);
      return novo;
    });

  const formas = useMemo(() => dados.data?.formas ?? [], [dados.data]);
  const prazos = useMemo(() => dados.data?.prazos ?? [], [dados.data]);
  const linhas = useMemo(() => linhasDePrazos(formas, prazos, filtros), [formas, prazos, filtros]);
  const total = linhas.length;
  const temBusca = Boolean(filtros.q || filtros.ativas || filtros.forma);

  const exportar = () => {
    downloadBlob(new Blob([prazosToCsv(linhas)], { type: 'text/csv;charset=utf-8' }), `prazos_pagamento_${localIsoDate(new Date(), sessao.fuso)}.csv`);
    toast('success', `CSV com ${total} ${total === 1 ? 'prazo' : 'prazos'} exportado.`);
  };
  const acoesDaPagina: AcaoDoMenu[] = [{ id: 'csv', rotulo: 'Exportar CSV', aoEscolher: exportar, desligada: total === 0, testId: 'formas-pagamento.exportar-csv' }];
  const colunas: ColunaDaTabela<LinhaPrazo>[] = [
    { id: 'codigo', titulo: 'Código', celula: (l) => <span className="font-mono" data-testid={`formas-pagamento.prazo-${l.prazo.codigo}`}>{l.prazo.codigo}</span>, texto: (l) => l.prazo.codigo, largura: '14%' },
    { id: 'descricao', titulo: 'Descrição', celula: (l) => descricaoNaTabela(l), texto: (l) => descricaoNaTabela(l) },
    { id: 'forma', titulo: 'Forma', celula: (l) => l.formaNome, largura: '18%' },
    { id: 'prazo', titulo: 'Prazo', celula: (l) => diasDasParcelas(l.prazo.parcelas_dias), prioridade: 2, largura: '140px' },
    { id: 'medio', titulo: 'Prazo médio', numero: true, celula: (l) => textoDoPrazoMedio(l.prazo.prazo_medio_dias), prioridade: 2, largura: '120px' },
  ];

  return (
    <div className="flex w-full max-w-[1180px] flex-col gap-5" data-testid="formas-pagamento.tela">
      <PageHeader title="Formas de pagamento e prazos" actions={<MenuAcoes acoes={acoesDaPagina} />} />

      <FilterBar>
        <CampoBusca rotulo="Buscar prazo ou forma" value={busca} maxLength={60} onChange={(e) => setBusca(e.target.value)} data-testid="formas-pagamento.filtro-busca" />
        <SelectField label="Forma" value={filtros.forma} onChange={(e) => mudar({ forma: e.target.value })} data-testid="formas-pagamento.filtro-forma">
          <option value="">Todas</option>
          {formas.map((f) => (
            <option key={f.id} value={f.id}>
              {f.nome}
            </option>
          ))}
        </SelectField>
        <SelectField label="Situação" value={filtros.ativas} onChange={(e) => mudar({ ativas: e.target.value === '1' ? '1' : '' })} data-testid="formas-pagamento.filtro-situacao">
          <option value="">Todas</option>
          <option value="1">Só ativos</option>
        </SelectField>
        {temBusca && (
          <Button
            size="sm"
            onClick={() => {
              setBusca('');
              mudar(FILTROS_FORMAS_VAZIOS);
            }}
            data-testid="formas-pagamento.limpar-filtros"
          >
            Limpar filtros
          </Button>
        )}
      </FilterBar>

      {dados.isError && <ErrorBlock message={errorMessage(dados.error)} onRetry={() => void dados.refetch()} />}
      {dados.isPending && <LoadingBlock label="Carregando as formas de pagamento…" />}
      {dados.data && (
        <div className={linhas.length === 0 ? '' : 'rounded-2xl border border-line bg-surface p-4'}>
          <TabelaDados
            rotulo="Prazos de pagamento"
            colunas={colunas}
            linhas={linhas}
            chave={(l) => l.prazo.id}
            testId="formas-pagamento.tabela"
            vazio={<EstadoVazio testId="formas-pagamento.vazio-prazos" titulo={temBusca ? 'Nenhum prazo com essa busca.' : 'Nenhum prazo recebido do ERP.'} />}
            esmaecida={(l) => !prazoEfetivamenteAtivo(l)}
          />
        </div>
      )}
    </div>
  );
}
