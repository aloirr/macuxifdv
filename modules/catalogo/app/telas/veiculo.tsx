/**
 * Folha Veículo do Catálogo (RN-CAT-22; spec `docs/design/filtro-veiculo/spec.md` §4): a `FolhaCascata` do kit alimentada pela cascata do
 * domain sobre as linhas locais (funciona sem sinal). Aqui só a fiação: quem diz os níveis, as opções e o que se preenche sozinho é o
 * domain; tocar avança, no último nível aplica e fecha, `Ver peças` aplica o que já foi escolhido e o ✕ fecha sem mudar o veículo.
 */
import { relogioReal } from '@macuxi/comum/relogio';
import { FolhaCascata, type OpcaoCascata } from '@macuxi/ui/mobile';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { VeiculoEscolhido, VeiculoParcial, VeiculosSaida } from '../../contracts';
import { anoCivilNoFuso } from '../../domain/ano-civil';
import { cascataLocal } from '../veiculos-consulta';
import type { LeitorLocal } from '../lib/local';
import { escolhaAntesDoPasso, escolhaDoResultadoDaBusca, escolherOpcao, nenhumModeloCom, parcialDoVeiculo, ROTULO_DO_NIVEL, TEXTOS_VEICULO, veiculoDaEscolha } from '../lib/veiculo-tela';

/** Espera antes do `Loading` embutido no nível (spec §9: só se passar de 300 ms). */
const ESPERA_CARREGANDO_MS = 300;

export function FolhaVeiculoCatalogo({ visivel, leitor, fuso, aplicado, escopo, onAplicar, onFechar }: { visivel: boolean; leitor: LeitorLocal; fuso: string; aplicado: VeiculoEscolhido | null; escopo?: ReadonlySet<string> | null; onAplicar: (v: VeiculoEscolhido) => void; onFechar: () => void }) {
  const [cascata, setCascata] = useState<VeiculosSaida | null>(null);
  const [textoBusca, setTextoBusca] = useState('');
  const [carregando, setCarregando] = useState(false);
  const rodada = useRef(0);
  const anoAtual = useCallback(() => anoCivilNoFuso(relogioReal().agora(), fuso), [fuso]);

  /** Carrega a cascata da `escolha`; quando não há mais nível a escolher, aplica e fecha. Rodada velha não escreve. */
  const carregar = useCallback(
    async (escolha: VeiculoParcial, busca: string, aplicarSeFechou: boolean) => {
      const minha = ++rodada.current;
      const espera = setTimeout(() => minha === rodada.current && setCarregando(true), ESPERA_CARREGANDO_MS);
      try {
        const c = await cascataLocal(leitor, { escolha, escopo, ...(busca ? { busca } : {}) }, anoAtual());
        if (minha !== rodada.current) return;
        const v = veiculoDaEscolha(c.escolha);
        if (aplicarSeFechou && c.nivel === null && v) return onAplicar(v);
        setCascata(c);
      } finally {
        clearTimeout(espera);
        if (minha === rodada.current) setCarregando(false);
      }
    },
    [leitor, anoAtual, onAplicar, escopo],
  );

  // ao abrir: no último nível escolhido (o veículo aplicado volta ao nível em que se escolheu), ou no 1º
  useEffect(() => {
    if (!visivel) return;
    setTextoBusca('');
    let vivo = true;
    void (async () => {
      let p: VeiculoParcial = aplicado ? parcialDoVeiculo(aplicado) : {};
      let c = await cascataLocal(leitor, { escolha: p, escopo }, anoAtual());
      while (c.nivel === null && c.trilha.length > 0) {
        const k = c.trilha.map((x) => x.automatico).lastIndexOf(false);
        p = escolhaAntesDoPasso(c.trilha, k < 0 ? 0 : k);
        c = await cascataLocal(leitor, { escolha: p, escopo }, anoAtual());
      }
      if (vivo) setCascata(c);
    })();
    return () => {
      vivo = false;
    };
    // abre uma vez por vez que fica visível
  }, [visivel]);

  if (!cascata || !cascata.disponivel) return null;
  const nivel = cascata.nivel;
  const primeiro = cascata.trilha.length === 0;
  const aplicarEscolha = () => {
    const v = veiculoDaEscolha(cascata.escolha);
    if (v) onAplicar(v);
  };
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
      titulo={TEXTOS_VEICULO.titulo}
      rotuloFechar={TEXTOS_VEICULO.fechar}
      trilha={cascata.trilha.map((p, i) => ({ rotulo: p.rotulo, automatico: p.automatico, onPress: () => void carregar(escolhaAntesDoPasso(cascata.trilha, i), '', false), testID: `veiculo-trilha-${p.nivel}` }))}
      rotuloNivel={nivel ? ROTULO_DO_NIVEL[nivel] : ''}
      opcoes={opcoes}
      grade={nivel === 'ano'}
      {...(primeiro
        ? {
            busca: {
              valor: textoBusca,
              placeholder: TEXTOS_VEICULO.buscaPlaceholder,
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
              rotuloLimpar: TEXTOS_VEICULO.buscaLimpar,
              testID: 'veiculo-busca',
            },
          }
        : {})}
      {...(primeiro && cascata.recentes.length > 0
        ? {
            recentes: {
              rotulo: TEXTOS_VEICULO.recentes,
              itens: cascata.recentes.map((r, i): OpcaoCascata => ({ valor: String(i), rotulo: r.rotulos.curto, apoio: r.veiculo.montadora, temProximo: false, testID: `veiculo-recente-${i}` })),
              onEscolher: (valor: string) => {
                const r = cascata.recentes[Number(valor)];
                if (r) onAplicar(r.veiculo);
              },
            },
          }
        : {})}
      {...(nivel === 'ano' || nivel === 'motor' || nivel === 'versao' ? (cascata.ultimo ? {} : { rodape: { rotulo: TEXTOS_VEICULO.verPecas, onPress: aplicarEscolha, testID: 'veiculo-ver-pecas' } }) : {})}
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
