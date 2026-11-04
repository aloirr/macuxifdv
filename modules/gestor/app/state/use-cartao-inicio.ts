/**
 * Dados do card do Início (T-0073): lê SÓ o cache do Gestor (offline-first) e relê quando o motor termina uma
 * sincronização. Sem timer nem consulta própria (RN-CORE-23); quem atualiza é o motor de sync.
 */
import { useMotorSync } from '@macuxi/platform-sdk/react';
import { useEffect, useMemo, useState } from 'react';
import { criarCache, DADOS_VAZIOS, type DadosGestor } from '../lib/cache';

export function useCartaoInicio(): DadosGestor {
  const { motor, estado } = useMotorSync();
  const cache = useMemo(() => (motor ? criarCache(motor.armazenamentoDoModulo('gestor')) : null), [motor]);
  const [dados, setDados] = useState<DadosGestor>(DADOS_VAZIOS);
  useEffect(() => {
    if (!cache) return;
    let vivo = true;
    void cache.carregar().then((d) => {
      if (vivo) setDados(d);
    });
    return () => {
      vivo = false;
    };
  }, [cache, estado.sincronizado_em]);
  return dados;
}
