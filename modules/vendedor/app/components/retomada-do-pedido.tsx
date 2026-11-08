/**
 * RN-VEN-38 (T-0128): retomada do Novo pedido depois que o sistema fechou o app. Na primeira tela depois de reabrir (o Início,
 * pelo card do Vendedor), sobe a folha "Pedido não terminado" com "Continuar pedido de <cliente>" ou "Descartar" (com confirmação).
 * Lê só o rascunho do aparelho (SQLite); nada na tela enquanto o vendedor edita. "Agora não" guarda o rascunho: ele volta na
 * próxima abertura do app (um de cada vez, o mais recente primeiro).
 */
import { useAmbiente, useMotorSync } from '@macuxi/platform-sdk/react';
import { apoioDaRetomada, FolhaRetomarRascunho, tituloDaRetomada } from '@macuxi/ui/mobile';
import { useEffect, useState } from 'react';

import { rascunhoParaRetomar, textoAlteradoEm, textoDeItens, TEXTOS_DA_SAIDA } from '../../domain/sair-do-pedido';
import { criarRepositorio } from '../lib/repositorio';
import { irParaNovoPedido } from '../rotas';

/** Uma oferta por abertura do app: "Agora não" não pergunta de novo até o sistema fechar o app outra vez. */
let ofertadoNestaAbertura = false;

interface Oferta {
  chave: string;
  customerId: string;
  cliente: string;
  apoio: string;
}

export function RetomadaDoPedido() {
  const { motor } = useMotorSync();
  const ambiente = useAmbiente();
  const usuario = ambiente.usuario();
  const [oferta, setOferta] = useState<Oferta | null>(null);

  useEffect(() => {
    if (!motor || ofertadoNestaAbertura) return;
    let vivo = true;
    void (async () => {
      const dados = await criarRepositorio(motor.armazenamentoDoModulo('vendedor')).carregar();
      if (!vivo || ofertadoNestaAbertura) return;
      const achado = rascunhoParaRetomar(dados.rascunhos);
      if (!achado) return;
      const cliente = dados.clientes.find((c) => c.id === achado.rascunho.customer_id);
      if (!cliente) return; // cliente fora da carteira: o rascunho fica guardado, sem oferecer um pedido que não abre
      ofertadoNestaAbertura = true;
      const tz = usuario?.fuso || 'America/Sao_Paulo';
      setOferta({
        chave: achado.chave,
        customerId: cliente.id,
        cliente: cliente.trade_name,
        apoio: apoioDaRetomada([textoDeItens(achado.rascunho), textoAlteradoEm(achado.rascunho.updated_at, new Date(), tz)]),
      });
    })();
    return () => {
      vivo = false;
    };
  }, [motor]);

  if (!oferta) return null;
  const fechar = () => setOferta(null);
  return (
    <FolhaRetomarRascunho
      visivel
      titulo="Pedido não terminado"
      continuar={{ rotulo: tituloDaRetomada('pedido', oferta.cliente), subtitulo: oferta.apoio, testID: 'retomar-continuar' }}
      descartar={{ rotulo: TEXTOS_DA_SAIDA.descartar.rotulo, subtitulo: TEXTOS_DA_SAIDA.descartar.subtitulo, testID: 'retomar-descartar', confirmacao: TEXTOS_DA_SAIDA.confirmacao }}
      depois="Agora não"
      onAcao={(acao) => {
        const o = oferta;
        fechar();
        if (acao === 'continuar') irParaNovoPedido({ customerId: o.customerId });
        else if (acao === 'descartar' && motor) void criarRepositorio(motor.armazenamentoDoModulo('vendedor')).limparRascunho(o.chave);
      }}
    />
  );
}
