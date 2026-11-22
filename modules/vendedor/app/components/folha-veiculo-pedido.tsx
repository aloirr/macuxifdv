/**
 * Folha Veículo da aba Itens (RN-CAT-22; spec `docs/design/filtro-veiculo/spec.md` §4 e §8): a `FolhaCascata` do kit alimentada pela consulta
 * `catalogo.veiculos@1`. Só fiação: quem diz os níveis, as opções e o que se preenche sozinho é o domain do Catálogo; tocar avança, no último
 * nível aplica e fecha, `Ver peças` aplica o que já foi escolhido e o ✕ fecha sem mudar o veículo.
 */
import type { VeiculoParcial, VeiculosSaida } from '@macuxi/catalogo/contracts';
import { FolhaCascata, type OpcaoCascata } from '@macuxi/ui/mobile';
import { useCallback, useEffect, useRef, useState } from 'react';

import { escolhaAntesDoPasso, escolhaDoResultadoDaBusca, escolherOpcao, nenhumModeloCom, parcialDoVeiculo, ROTULO_DO_NIVEL, TEXTOS_VEICULO_PEDIDO as T, veiculoDaEscolha, type VeiculoDoPedido } from '../lib/veiculo-pedido';

/** Espera antes do `Loading` embutido no nível (spec §9: só se passar de 300 ms). */
const ESPERA_CARREGANDO_MS = 300;

export type ConsultarVeiculos = (entrada: { escolha: VeiculoParcial; busca?: string }) => Promise<VeiculosSaida | null>;

export function FolhaVeiculoPedido({ visivel, consultar, aplicado, onAplicar, onFechar }: { visivel: boolean; consultar: ConsultarVeiculos; aplicado: VeiculoDoPedido | null; onAplicar: (v: VeiculoDoPedido) => void; onFechar: () => void }) {
  const [cascata, setCascata] = useState<VeiculosSaida | null>(null);
  const [textoBusca, setTextoBusca] = useState('');
  const [carregando, setCarregando] = useState(false);
  const rodada = useRef(0);

  const aplicarDe = useCallback(
    (c: VeiculosSaida): boolean => {
      const veiculo = veiculoDaEscolha(c.escolha);
      if (!veiculo || !c.rotulos) return false;
      onAplicar({ veiculo, rotulos: c.rotulos });
      return true;
    },
    [onAplicar],
  );

  /** Carrega a cascata da `escolha`; quando não há mais nível a escolher, aplica e fecha. Rodada velha não escreve. */
  const carregar = useCallback(
    async (escolha: VeiculoParcial, busca: string, aplicarSeFechou: boolean) => {
      const minha = ++rodada.current;
      const espera = setTimeout(() => minha === rodada.current && setCarregando(true), ESPERA_CARREGANDO_MS);
      try {
        const c = await consultar({ escolha, ...(busca ? { busca } : {}) });
        if (minha !== rodada.current || !c) return;
        if (aplicarSeFechou && c.nivel === null && aplicarDe(c)) return;
        setCascata(c);
      } finally {
        clearTimeout(espera);
        if (minha === rodada.current) setCarregando(false);
      }
    },
    [consultar, aplicarDe],
  );

  // ao abrir: no último nível escolhido (o veículo aplicado volta ao nível em que se escolheu), ou no 1º
  useEffect(() => {
    if (!visivel) return;
    setTextoBusca('');
    let vivo = true;
    void (async () => {
      let p: VeiculoParcial = aplicado ? parcialDoVeiculo(aplicado.veiculo) : {};
      let c = await consultar({ escolha: p });
      while (c && c.nivel === null && c.trilha.length > 0) {
        const k = c.trilha.map((x) => x.automatico).lastIndexOf(false);
        p = escolhaAntesDoPasso(c.trilha, k < 0 ? 0 : k);
        c = await consultar({ escolha: p });
      }
      if (vivo && c) setCascata(c);
    })();
    return () => {
      vivo = false;
    };
    // abre uma vez por vez que fica visível
  }, [visivel]);

  if (!cascata || !cascata.disponivel) return null;
  const nivel = cascata.nivel;
  const primeiro = cascata.trilha.length === 0;
  const opcoes: OpcaoCascata[] = cascata.opcoes.map((o) => ({ valor: o.valor, rotulo: o.rotulo, apoio: o.apoio, temProximo: !cascata.ultimo, testID: `veiculo-opcao-${o.valor}` }));
  const voltar = () => {
    if (primeiro) return onFechar();
    const k = cascata.trilha.map((x) => x.automatico).lastIndexOf(false);
    void carregar(escolhaAntesDoPasso(cascata.trilha, k < 0 ? 0 : k), '', false);
  };
  const resultados: OpcaoCascata[] = (cascata.busca ?? []).map((r) => ({ valor: r.valor, rotulo: r.rotulo, apoio: r.apoio, temProximo: true }));
  return (
    <FolhaCascata
      visivel={visivel}
      titulo={T.titulo}
      rotuloFechar={T.fechar}
      trilha={cascata.trilha.map((p, i) => ({ rotulo: p.rotulo, automatico: p.automatico, onPress: () => void carregar(escolhaAntesDoPasso(cascata.trilha, i), '', false), testID: `veiculo-trilha-${p.nivel}` }))}
      rotuloNivel={nivel ? ROTULO_DO_NIVEL[nivel] : ''}
      opcoes={opcoes}
      grade={nivel === 'ano'}
      {...(primeiro
        ? {
            busca: {
              valor: textoBusca,
              placeholder: T.buscaPlaceholder,
              onMudar: (t: string) => {
                setTextoBusca(t);
                void carregar({}, t.trim(), false);
              },
              resultados,
              vazio: nenhumModeloCom(textoBusca.trim()),
              onEscolher: (valor: string) => {
                const r = cascata.busca?.find((x) => x.valor === valor);
                if (!r) return;
                setTextoBusca('');
                void carregar(escolhaDoResultadoDaBusca(r), '', true);
              },
              rotuloLimpar: T.buscaLimpar,
              testID: 'veiculo-busca',
            },
          }
        : {})}
      {...(primeiro && cascata.recentes.length > 0
        ? {
            recentes: {
              rotulo: T.recentes,
              itens: cascata.recentes.map((r, i): OpcaoCascata => ({ valor: String(i), rotulo: r.rotulos.curto, apoio: r.veiculo.montadora, temProximo: false, testID: `veiculo-recente-${i}` })),
              onEscolher: (valor: string) => {
                const r = cascata.recentes[Number(valor)];
                if (r) onAplicar({ veiculo: r.veiculo, rotulos: r.rotulos });
              },
            },
          }
        : {})}
      {...(nivel === 'ano' || nivel === 'motor' || nivel === 'versao' ? (cascata.ultimo ? {} : { rodape: { rotulo: T.verPecas, onPress: () => void aplicarDe(cascata), testID: 'veiculo-ver-pecas' } }) : {})}
      carregando={carregando}
      onEscolher={(valor) => {
        if (!nivel) return;
        void carregar(escolherOpcao(cascata.escolha, nivel, valor), '', true);
      }}
      onVoltar={voltar}
      onFechar={onFechar}
      testID="veiculo-folha"
    />
  );
}
