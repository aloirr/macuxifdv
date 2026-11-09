/**
 * Entrada do app (antes o `main` era `expo-router/entry` direto; a troca é a recomendada pelo expo-router).
 * ADR 0017: a tarefa `macuxi-sync-delta` é definida no escopo global na carga do bundle, porque o Android acorda o app
 * fechado para rodá-la sem montar telas (`TaskManager.defineTask` não pode ficar dentro de componente).
 */
// relato de 08/11 (o app fechava sem deixar rastro): o erro fatal fora do React fica gravado para o Diagnóstico do Perfil
// (import com efeito, ANTES dos outros: os imports sobem, então a chamada solta aqui rodaria só depois deles)
import './src/services/erros-globais';
import 'expo-router/entry';
import './src/services/segundo-plano';
// RN-CORE-23 item 3: push silencioso com o app fechado (tarefa `macuxi-push-sync`, também no escopo global)
import './src/services/push';
