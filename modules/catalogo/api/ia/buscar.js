/**
 * Orquestração da interpretação da busca na API (RF-CAT-01, RN-CAT-03): mede a duração, registra log estruturado
 * (tenant e duração, nunca o texto da pergunta nem dado pessoal) e debita a cota SÓ quando o provedor respondeu.
 * A decisão (fallback sem IA, aviso, desfecho) é do domain (`interpretarBusca`); aqui só entram I/O e medição.
 * Ordem na rota: cache (não consome) → `verificarConsultaIa` → `interpretarComMedicao` → persistir o uso.
 */
import { interpretarBusca, resumoDaInterpretacao } from '../../domain';
export async function interpretarComMedicao(e) {
    const relogio = e.relogio ?? (() => performance.now());
    const inicio = relogio();
    const { tenant_id, texto, vocabulario, porta, online, ia, signal } = e;
    const { log, timeoutMs, debitarCota } = e;
    const r = await interpretarBusca({ tenant_id, texto, vocabulario, porta, online, ia, signal });
    const duracaoMs = Math.max(0, Math.round(relogio() - inicio));
    if (r.chamouProvedor) {
        const dados = { evento: 'catalogo.ia.interpretacao', tenant_id: e.tenant_id, duracao_ms: duracaoMs, desfecho: r.desfecho, origem: r.origem, timeout_ms: timeoutMs ?? null };
        if (r.desfecho === 'respondida')
            log.info(dados, 'Busca inteligente respondida pelo provedor.');
        else
            log.warn(dados, 'Provedor de IA indisponível: busca atendida sem IA.');
    }
    let cotaDebitada = false;
    if (r.consomeCota && debitarCota) {
        try {
            await debitarCota();
            cotaDebitada = true;
        }
        catch {
            log.warn({ evento: 'catalogo.ia.debito_falhou', tenant_id: e.tenant_id }, 'Não foi possível debitar a cota de IA.');
        }
    }
    return { ...r, resumo: resumoDaInterpretacao(r), duracaoMs, cotaDebitada };
}
