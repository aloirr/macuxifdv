/**
 * `FolhaVeiculo` (spec docs/design/filtro-veiculo/spec.md §4 e §9; desenho técnico docs/desenho/filtro-veiculo.md §6.3):
 * a folha Veículo única do Catálogo e do Novo pedido, sobre a `FolhaCascata` do kit. Só fiação e tipos estruturais (não importa
 * `modules/*`): a consulta (`consultar`), os apoios puros (`navegacao`) e os textos (`textos`) chegam do módulo.
 * Tocar avança; no último nível, aplica e fecha; "Ver peças" aplica o que já foi escolhido; o Voltar volta um nível (no 1º, fecha);
 * o ✕ fecha sem mudar o veículo. Abre no último nível escolhido. Resposta velha (rodada anterior) não escreve.
 * Parte pura em `folha-veiculo-estado.ts` (testada).
 */
import { useCallback, useEffect, useRef, useState } from 'react';

import { FolhaCascata, type OpcaoCascata } from './cascata-rn';
import {
  abrirCascata,
  aplicacaoDaCascata,
  destinoDaCascata,
  ESPERA_CARREGANDO_FOLHA_VEICULO_MS,
  indiceParaVoltar,
  mostrarVerPecas,
  nivelEmGrade,
  noPrimeiroNivel,
  type CascataConsultada,
  type NavegacaoCascata,
} from './folha-veiculo-estado';

type Rotulos = { curto: string; completo: string };

/** Os textos da folha (o Catálogo passa `TEXTOS_VEICULO`). */
export interface TextosFolhaVeiculo {
  titulo: string;
  fechar: string;
  buscaPlaceholder: string;
  buscaLimpar: string;
  recentes: string;
  verPecas: string;
  rotuloDoNivel: Readonly<Record<string, string>>;
  nenhumModeloCom(texto: string): string;
}

export function FolhaVeiculo<E, V extends { montadora: string | null }>({
  visivel,
  consultar,
  navegacao,
  textos,
  aplicado,
  onAplicar,
  onFechar,
  testID = 'veiculo-folha',
}: {
  visivel: boolean;
  consultar: (entrada: { escolha: E; busca?: string }) => Promise<CascataConsultada<E, V> | null>;
  navegacao: NavegacaoCascata<E, V>;
  textos: TextosFolhaVeiculo;
  aplicado: V | null;
  onAplicar: (v: { veiculo: V; rotulos: Rotulos }) => void;
  onFechar: () => void;
  testID?: string;
}) {
  const [cascata, setCascata] = useState<CascataConsultada<E, V> | null>(null);
  const [textoBusca, setTextoBusca] = useState('');
  const [carregando, setCarregando] = useState(false);
  const rodada = useRef(0);

  /** Carrega a cascata da `escolha`; quando não há mais nível a escolher, aplica e fecha. Rodada velha não escreve. */
  const carregar = useCallback(
    async (escolha: E, busca: string, aplicarSeFechou: boolean) => {
      const minha = ++rodada.current;
      const espera = setTimeout(() => minha === rodada.current && setCarregando(true), ESPERA_CARREGANDO_FOLHA_VEICULO_MS);
      try {
        const c = await consultar({ escolha, ...(busca ? { busca } : {}) });
        if (minha !== rodada.current || !c) return;
        const destino = destinoDaCascata(c, navegacao, aplicarSeFechou);
        if (destino.tipo === 'aplicar') return onAplicar({ veiculo: destino.veiculo, rotulos: destino.rotulos });
        setCascata(c);
      } finally {
        clearTimeout(espera);
        if (minha === rodada.current) setCarregando(false);
      }
    },
    [consultar, navegacao, onAplicar],
  );

  // ao abrir: no último nível escolhido (o veículo aplicado volta ao nível em que se escolheu), ou no 1º
  useEffect(() => {
    if (!visivel) return;
    setTextoBusca('');
    setCarregando(false);
    const minha = ++rodada.current;
    void abrirCascata(consultar, navegacao, aplicado).then((c) => {
      if (minha === rodada.current && c) setCascata(c);
    });
    return () => {
      rodada.current++;
    };
    // abre uma vez por vez que fica visível (o veículo aplicado e a consulta da hora de abrir)
  }, [visivel]);

  if (!cascata || !cascata.disponivel) return null;
  const c = cascata;
  const nivel = c.nivel;
  const primeiro = noPrimeiroNivel(c);
  const opcoes: OpcaoCascata[] = c.opcoes.map((o) => ({ valor: o.valor, rotulo: o.rotulo, apoio: o.apoio, temProximo: !c.ultimo, testID: `veiculo-opcao-${o.valor}` }));
  const resultados: OpcaoCascata[] = (c.busca ?? []).map((r) => ({ valor: r.valor, rotulo: r.rotulo, apoio: r.apoio, temProximo: true }));
  const voltar = () => {
    if (primeiro) return onFechar();
    void carregar(navegacao.antesDoPasso(c.trilha, indiceParaVoltar(c.trilha)), '', false);
  };
  const verPecas = () => {
    const a = aplicacaoDaCascata(c, navegacao);
    if (a) onAplicar(a);
  };
  return (
    <FolhaCascata
      visivel={visivel}
      titulo={textos.titulo}
      rotuloFechar={textos.fechar}
      trilha={c.trilha.map((p, i) => ({ rotulo: p.rotulo, automatico: p.automatico, onPress: () => void carregar(navegacao.antesDoPasso(c.trilha, i), '', false), testID: `veiculo-trilha-${p.nivel}` }))}
      rotuloNivel={nivel ? (textos.rotuloDoNivel[nivel] ?? '') : ''}
      opcoes={opcoes}
      grade={nivelEmGrade(nivel, navegacao)}
      {...(primeiro
        ? {
            busca: {
              valor: textoBusca,
              placeholder: textos.buscaPlaceholder,
              onMudar: (t: string) => {
                setTextoBusca(t);
                void carregar(navegacao.vazia, t.trim(), false);
              },
              resultados,
              vazio: textos.nenhumModeloCom(textoBusca.trim()),
              onEscolher: (valor: string) => {
                const r = c.busca?.find((x) => x.valor === valor);
                if (!r) return;
                setTextoBusca('');
                void carregar(navegacao.daBusca(r), '', true);
              },
              rotuloLimpar: textos.buscaLimpar,
              testID: 'veiculo-busca',
            },
          }
        : {})}
      {...(primeiro && c.recentes.length > 0
        ? {
            recentes: {
              rotulo: textos.recentes,
              itens: c.recentes.map((r, i): OpcaoCascata => ({ valor: String(i), rotulo: r.rotulos.curto, apoio: r.veiculo.montadora, temProximo: false, testID: `veiculo-recente-${i}` })),
              onEscolher: (valor: string) => {
                const r = c.recentes[Number(valor)];
                if (r) onAplicar({ veiculo: r.veiculo, rotulos: r.rotulos });
              },
            },
          }
        : {})}
      {...(mostrarVerPecas(c, navegacao) ? { rodape: { rotulo: textos.verPecas, onPress: verPecas, testID: 'veiculo-ver-pecas' } } : {})}
      carregando={carregando}
      onEscolher={(valor) => {
        if (!nivel) return;
        void carregar(navegacao.escolher(c.escolha, nivel, valor), '', true);
      }}
      onVoltar={voltar}
      onFechar={onFechar}
      testID={testID}
    />
  );
}
