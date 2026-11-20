/**
 * Hooks das abas Histórico e Documentação (T-0186; P15, P17). Tudo vem do servidor ao abrir a aba e fica só na memória da tela: nada vai
 * para o SQLite nem para o disco. Sem conexão, o erro traz a ação "Tentar de novo".
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { CarteiraClienteResposta, DocumentoLinhaContrato, HistoricoNfResposta, LinhaHistoricoNfContrato, NotaDetalhe } from '../../contracts';
import { filtrarNotas, inicioDoPeriodoNf } from '../../domain';
import type { AbrirArquivo } from './abrir-arquivo';
import { buscarCarteiraDoCliente, buscarDocumento, buscarNota, buscarNotas, buscarDocumentos, falhaDaConsulta, FALHA_SEM_INTERNET, type FalhaOnline } from './ficha-online';
import { filtroDeNotas, filtroPrecisaDoServidor, intervaloDoFiltro, type EstadoDaConsulta, type FiltroDaFicha } from './ficha-v2';
import { httpDe } from './http';

export interface NotasDoCliente {
  estado: EstadoDaConsulta;
  falha: FalhaOnline | null;
  /** Já filtradas, da mais recente para a mais antiga. */
  linhas: LinhaHistoricoNfContrato[];
  /** Formas de pagamento que aparecem nas notas (grupo do filtro). */
  formas: string[];
  recarregar: () => void;
}

/** Lê a lista de notas do período do filtro; o status, a forma e o Nº da NF filtram na tela (`filtrarNotas`). */
export function useNotasDoCliente(clienteId: string, filtro: FiltroDaFicha, hoje: string, ligado: boolean): NotasDoCliente {
  const { motor } = useMotorSync();
  // até 90 dias: uma consulta só (a janela do aparelho) e o filtro roda na tela; além disso, o período pedido vai ao servidor (P17)
  const { de, ate } = filtroPrecisaDoServidor(filtro, hoje) ? intervaloDoFiltro(filtro, hoje) : { de: inicioDoPeriodoNf('90d', hoje), ate: hoje };
  const [resposta, setResposta] = useState<HistoricoNfResposta | null>(null);
  const [estado, setEstado] = useState<EstadoDaConsulta>('ocioso');
  const [falha, setFalha] = useState<FalhaOnline | null>(null);
  const [tentativa, setTentativa] = useState(0);
  const chave = `${clienteId}|${de}|${ate}|${tentativa}`;
  const ultima = useRef('');

  useEffect(() => {
    if (!ligado || ultima.current === chave) return;
    ultima.current = chave;
    const http = httpDe(motor);
    if (!http) {
      setEstado('erro');
      setFalha(FALHA_SEM_INTERNET);
      return;
    }
    let ativo = true;
    setEstado('carregando');
    setFalha(null);
    buscarNotas(http, clienteId, { de, ate })
      .then((r) => {
        if (!ativo) return;
        setResposta(r);
        setEstado('ok');
      })
      .catch((e: unknown) => {
        if (!ativo) return;
        setFalha(falhaDaConsulta(e));
        setEstado('erro');
      });
    return () => {
      ativo = false;
      ultima.current = '';
    };
  }, [ligado, chave, motor, clienteId, de, ate]);

  const linhas = useMemo(() => (resposta ? filtrarNotas(resposta.itens, filtroDeNotas(filtro, hoje)) : []), [resposta, filtro, hoje]);
  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  return { estado, falha, linhas, formas: resposta?.formas_pagamento ?? [], recarregar };
}

export interface DetalheDaNota {
  /** A nota tocada: a folha pergunta "Baixar a NF …?" antes de buscar. */
  linha: LinhaHistoricoNfContrato | null;
  estado: EstadoDaConsulta;
  falha: FalhaOnline | null;
  nota: NotaDetalhe | null;
  abrir: (l: LinhaHistoricoNfContrato) => void;
  /** "Baixar": busca a NF no servidor. */
  baixar: () => void;
  tentarDeNovo: () => void;
  /** Ao fechar, a NF é descartada: o próximo toque busca de novo. */
  fechar: () => void;
}

/** P17: ao tocar na linha a folha pede a autorização; "Baixar" busca a NF online; fechar descarta tudo. */
export function useDetalheDaNota(clienteId: string): DetalheDaNota {
  const { motor } = useMotorSync();
  const [linha, setLinha] = useState<LinhaHistoricoNfContrato | null>(null);
  const [nota, setNota] = useState<NotaDetalhe | null>(null);
  const [estado, setEstado] = useState<EstadoDaConsulta>('ocioso');
  const [falha, setFalha] = useState<FalhaOnline | null>(null);
  const atual = useRef<string | null>(null);

  const buscar = useCallback(
    (l: LinhaHistoricoNfContrato) => {
      const http = httpDe(motor);
      atual.current = l.id;
      setNota(null);
      setFalha(null);
      if (!http) {
        setEstado('erro');
        setFalha(FALHA_SEM_INTERNET);
        return;
      }
      setEstado('carregando');
      buscarNota(http, clienteId, l.id)
        .then((n) => {
          if (atual.current !== l.id) return;
          setNota(n);
          setEstado('ok');
        })
        .catch((e: unknown) => {
          if (atual.current !== l.id) return;
          setFalha(falhaDaConsulta(e));
          setEstado('erro');
        });
    },
    [motor, clienteId],
  );
  const abrir = useCallback((l: LinhaHistoricoNfContrato) => {
    atual.current = null;
    setLinha(l);
    setNota(null);
    // spec §4: sem internet o toque abre direto "Sem internet" + "Tentar de novo", sem a pergunta
    if (!httpDe(motor)) {
      setFalha(FALHA_SEM_INTERNET);
      setEstado('erro');
      return;
    }
    setFalha(null);
    setEstado('ocioso');
  }, [motor]);
  const baixar = useCallback(() => {
    if (linha) buscar(linha);
  }, [linha, buscar]);
  const fechar = useCallback(() => {
    atual.current = null;
    setLinha(null);
    setNota(null);
    setFalha(null);
    setEstado('ocioso');
  }, []);
  const tentarDeNovo = useCallback(() => {
    if (linha) buscar(linha);
  }, [linha, buscar]);
  return { linha, estado, falha, nota, abrir, baixar, tentarDeNovo, fechar };
}

export interface DocumentosDoCliente {
  estado: EstadoDaConsulta;
  falha: FalhaOnline | null;
  itens: DocumentoLinhaContrato[];
  recarregar: () => void;
}

/** Consulta online da ficha (documentos, carteira): busca ao abrir, só na memória; sem conexão, erro com "Tentar de novo". */
function useConsultaOnline<T>(clienteId: string, ligado: boolean, buscar: (http: NonNullable<ReturnType<typeof httpDe>>, clienteId: string) => Promise<T>) {
  const { motor } = useMotorSync();
  const [dados, setDados] = useState<T | null>(null);
  const [estado, setEstado] = useState<EstadoDaConsulta>('ocioso');
  const [falha, setFalha] = useState<FalhaOnline | null>(null);
  const [tentativa, setTentativa] = useState(0);

  useEffect(() => {
    if (!ligado) return;
    const http = httpDe(motor);
    if (!http) {
      setEstado('erro');
      setFalha(FALHA_SEM_INTERNET);
      return;
    }
    let ativo = true;
    setEstado('carregando');
    setFalha(null);
    buscar(http, clienteId)
      .then((r) => {
        if (!ativo) return;
        setDados(r);
        setEstado('ok');
      })
      .catch((e: unknown) => {
        if (!ativo) return;
        setFalha(falhaDaConsulta(e));
        setEstado('erro');
      });
    return () => {
      ativo = false;
    };
  }, [ligado, motor, clienteId, tentativa, buscar]);

  const recarregar = useCallback(() => setTentativa((n) => n + 1), []);
  return { estado, falha, dados, recarregar };
}

/** Lista de documentos do perfil (a API já tirou o tipo que ele não vê e marcou a exceção por documento). */
export function useDocumentosDoCliente(clienteId: string, ligado: boolean): DocumentosDoCliente {
  const { estado, falha, dados, recarregar } = useConsultaOnline(clienteId, ligado, buscarDocumentos);
  return { estado, falha, itens: dados?.itens ?? [], recarregar };
}

export interface AberturaDeDocumento {
  /** Documento tocado cuja abertura falhou (folha "Sem internet" + "Tentar de novo"). */
  falhou: { id: string; nome: string; falha: FalhaOnline } | null;
  abrindo: string | null;
  abrir: (d: Pick<DocumentoLinhaContrato, 'id' | 'nome'>) => void;
  tentarDeNovo: () => void;
  fechar: () => void;
}

/** P15: o toque pede o arquivo ao servidor (que revalida) e entrega ao visualizador do shell; nada é baixado nem guardado. */
export function useAbrirDocumento(clienteId: string, visualizador: AbrirArquivo | null): AberturaDeDocumento {
  const { motor } = useMotorSync();
  const [abrindo, setAbrindo] = useState<string | null>(null);
  const [falhou, setFalhou] = useState<AberturaDeDocumento['falhou']>(null);
  const ultimo = useRef<Pick<DocumentoLinhaContrato, 'id' | 'nome'> | null>(null);

  const abrir = useCallback(
    (d: Pick<DocumentoLinhaContrato, 'id' | 'nome'>) => {
      ultimo.current = d;
      const http = httpDe(motor);
      if (!http || !visualizador) {
        setFalhou({ id: d.id, nome: d.nome, falha: FALHA_SEM_INTERNET });
        return;
      }
      setAbrindo(d.id);
      setFalhou(null);
      buscarDocumento(http, clienteId, d.id)
        .then((r) => {
          setAbrindo(null);
          visualizador({ arquivo_id: r.arquivo_id, titulo: r.nome, formato: r.formato });
        })
        .catch((e: unknown) => {
          setAbrindo(null);
          setFalhou({ id: d.id, nome: d.nome, falha: falhaDaConsulta(e) });
        });
    },
    [motor, clienteId, visualizador],
  );
  const tentarDeNovo = useCallback(() => {
    if (ultimo.current) abrir(ultimo.current);
  }, [abrir]);
  const fechar = useCallback(() => setFalhou(null), []);
  return { falhou, abrindo, abrir, tentarDeNovo, fechar };
}

export interface CarteiraDoClienteOnline {
  estado: EstadoDaConsulta;
  falha: FalhaOnline | null;
  resposta: CarteiraClienteResposta | null;
  recarregar: () => void;
}

/** Tabela "Carteira" do Gestão: consulta online ao abrir a ficha; sem cópia no aparelho. */
export function useCarteiraDoCliente(clienteId: string, ligado: boolean): CarteiraDoClienteOnline {
  const { estado, falha, dados, recarregar } = useConsultaOnline(clienteId, ligado, buscarCarteiraDoCliente);
  return { estado, falha, resposta: dados, recarregar };
}
