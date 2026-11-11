package expo.modules.macuxisaida

import android.annotation.TargetApi
import android.app.ActivityManager
import android.app.ApplicationExitInfo
import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import org.json.JSONArray
import org.json.JSONObject

/**
 * T-0144 (o app fechava na 1ª abertura sem tela de erro): por que o processo do app terminou, segundo o próprio Android.
 * - `ultimasSaidas(limite)`: as últimas saídas do processo (`ActivityManager.getHistoricalProcessExitReasons`, Android 11+),
 *   em JSON: motivo, sinal ou código, importância, memória e, no ANR, o começo da pilha da linha principal.
 * - `ultimoErroJava()`: o último erro Java não tratado (classe, mensagem e começo da pilha), gravado pelo tratador global
 *   instalado na criação do módulo, antes de o Android encerrar o app.
 * Só leitura e diagnóstico: nada aqui muda o comportamento do app. As regras (o que é queda, o texto do Diagnóstico e a
 * máscara de dado pessoal) ficam no JS (`apps/mobile/src/lib/saida-android.ts`).
 */
class MacuxiSaidaModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("MacuxiSaida")

    OnCreate {
      val contexto = appContext.reactContext
      if (contexto != null) ErroJava.instalar(contexto.applicationContext)
    }

    Function("ultimasSaidas") { limite: Int ->
      val contexto = appContext.reactContext
      if (contexto == null) "[]" else Saidas.ler(contexto, limite)
    }

    Function("ultimoErroJava") {
      val contexto = appContext.reactContext
      if (contexto == null) "" else ErroJava.ler(contexto)
    }
  }
}

internal object Saidas {
  fun ler(contexto: Context, limite: Int): String {
    if (Build.VERSION.SDK_INT < 30) return "[]"
    return try {
      lerNoAndroid11(contexto, limite)
    } catch (_: Throwable) {
      "[]"
    }
  }

  @TargetApi(30)
  private fun lerNoAndroid11(contexto: Context, limite: Int): String {
    val gerente = contexto.getSystemService(Context.ACTIVITY_SERVICE) as? ActivityManager ?: return "[]"
    val lista = JSONArray()
    val saidas = gerente.getHistoricalProcessExitReasons(contexto.packageName, 0, limite.coerceIn(1, 16))
    for (s in saidas) {
      val o = JSONObject()
      o.put("motivo", s.reason)
      o.put("status", s.status)
      o.put("importancia", s.importance)
      o.put("quando", s.timestamp)
      o.put("pss_kb", s.pss)
      o.put("rss_kb", s.rss)
      o.put("descricao", s.description ?: "")
      o.put("processo", s.processName ?: "")
      if (s.reason == ApplicationExitInfo.REASON_ANR) o.put("pilha", trechoDoAnr(s))
      lista.put(o)
    }
    return lista.toString()
  }

  /** ANR: só as linhas de pilha da linha principal (`"main"`), no máximo 12. */
  @TargetApi(30)
  private fun trechoDoAnr(s: ApplicationExitInfo): String {
    return try {
      val entrada = s.traceInputStream ?: return ""
      entrada.bufferedReader().use { leitor ->
        val linhas = ArrayList<String>()
        var naPrincipal = false
        var lidas = 0
        while (lidas < 5000 && linhas.size < 12) {
          val linha = leitor.readLine() ?: break
          lidas++
          if (!naPrincipal) {
            if (linha.startsWith("\"main\"")) naPrincipal = true
            continue
          }
          val limpa = linha.trim()
          if (limpa.isEmpty()) break
          if (limpa.startsWith("at ") || limpa.startsWith("native:")) linhas.add(limpa.take(200))
        }
        linhas.joinToString("\n")
      }
    } catch (_: Throwable) {
      ""
    }
  }
}

internal object ErroJava {
  private const val ARQUIVO = "macuxi_saida"
  private const val CHAVE_TEXTO = "erro_java"
  private const val CHAVE_QUANDO = "erro_java_quando"

  @Volatile
  private var instalado = false

  @Synchronized
  fun instalar(contexto: Context) {
    if (instalado) return
    instalado = true
    val anterior = Thread.getDefaultUncaughtExceptionHandler()
    Thread.setDefaultUncaughtExceptionHandler { linha, erro ->
      try {
        contexto.getSharedPreferences(ARQUIVO, Context.MODE_PRIVATE)
          .edit()
          .putString(CHAVE_TEXTO, resumo(linha, erro))
          .putLong(CHAVE_QUANDO, System.currentTimeMillis())
          .commit()
      } catch (_: Throwable) {
        // registrar nunca impede o Android de seguir com o erro
      }
      anterior?.uncaughtException(linha, erro)
    }
  }

  fun ler(contexto: Context): String {
    return try {
      val p = contexto.getSharedPreferences(ARQUIVO, Context.MODE_PRIVATE)
      val texto = p.getString(CHAVE_TEXTO, null)
      if (texto == null) "" else JSONObject().put("quando", p.getLong(CHAVE_QUANDO, 0L)).put("texto", texto).toString()
    } catch (_: Throwable) {
      ""
    }
  }

  /** Classe, mensagem (até 300 caracteres) e as primeiras linhas da pilha do erro e de até 3 causas. */
  private fun resumo(linha: Thread, erro: Throwable): String {
    val partes = ArrayList<String>()
    partes.add("linha ${linha.name}")
    var atual: Throwable? = erro
    var nivel = 0
    while (atual != null && nivel < 4) {
      val mensagem = (atual.message ?: "").take(300)
      val prefixo = if (nivel == 0) "" else "causa: "
      partes.add(prefixo + atual.javaClass.name + (if (mensagem.isEmpty()) "" else ": $mensagem"))
      for (quadro in atual.stackTrace.take(if (nivel == 0) 8 else 4)) partes.add("  at $quadro")
      atual = atual.cause
      nivel++
    }
    return partes.joinToString("\n").take(4000)
  }
}
