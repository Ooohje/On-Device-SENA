package expo.modules.senadownload

import android.content.Context
import androidx.work.BackoffPolicy
import androidx.work.Constraints
import androidx.work.ExistingWorkPolicy
import androidx.work.NetworkType
import androidx.work.Data
import androidx.work.OneTimeWorkRequest
import androidx.work.WorkInfo
import androidx.work.WorkManager
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import java.io.File
import java.util.concurrent.TimeUnit

// 대화 모델(2.5GB) 받기와 앱 전용 외부 저장소(Android/data/<앱>/files) 파일 다루기.
// 받기는 LlmDownloadWorker(WorkManager)가 한다 — 앱을 닫아도 계속, 상단바 진행률, 연결이 끊기면 이어 받기
class SenaDownloadModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("React context가 없습니다")

  private fun prefs() = context.getSharedPreferences(LlmDownloadWorker.PREFS, Context.MODE_PRIVATE)

  override fun definition() = ModuleDefinition {
    Name("SenaDownload")

    // 앱 전용 외부 저장소 경로 (예: /storage/emulated/0/Android/data/com.sena.mobile/files)
    Function("externalDir") {
      context.getExternalFilesDir(null)?.absolutePath
    }

    // 받기 시작. relPath는 externalDir 기준(예: models/llm.gguf.part). 이미 받은 부분이 있으면 이어 받는다
    Function("start") { url: String, relPath: String, bytes: Double ->
      LlmDownloadWorker.ensureChannel(context)
      prefs().edit().clear().putString(LlmDownloadWorker.KEY_STATE, LlmDownloadWorker.STATE_RUNNING).putLong(LlmDownloadWorker.KEY_TOTAL, bytes.toLong()).apply()
      val input = Data.Builder()
        .putString(LlmDownloadWorker.KEY_URL, url)
        .putString(LlmDownloadWorker.KEY_REL, relPath)
        .putLong(LlmDownloadWorker.KEY_BYTES, bytes.toLong())
        .build()
      val req = OneTimeWorkRequest.Builder(LlmDownloadWorker::class.java)
        .setInputData(input)
        .setConstraints(Constraints.Builder().setRequiredNetworkType(NetworkType.CONNECTED).build())
        .setBackoffCriteria(BackoffPolicy.LINEAR, 10, TimeUnit.SECONDS)
        .build()
      WorkManager.getInstance(context).enqueueUniqueWork(LlmDownloadWorker.WORK_NAME, ExistingWorkPolicy.REPLACE, req)
    }

    // 진행 상황. 받는 작업이 없으면 null
    Function("status") {
      val p = prefs()
      val state = p.getString(LlmDownloadWorker.KEY_STATE, null) ?: return@Function null
      val infos = WorkManager.getInstance(context).getWorkInfosForUniqueWork(LlmDownloadWorker.WORK_NAME).get()
      val work = infos.firstOrNull()?.state
      // 작업이 인터넷을 기다리며 대기 중이면(ENQUEUED) 받는 중이 아니라 기다리는 중
      val shown = if (state == LlmDownloadWorker.STATE_RUNNING && work == WorkInfo.State.ENQUEUED && p.getLong(LlmDownloadWorker.KEY_GOT, 0) > 0) LlmDownloadWorker.STATE_WAITING else state
      mapOf(
        "status" to shown,
        "downloaded" to p.getLong(LlmDownloadWorker.KEY_GOT, 0).toDouble(),
        "total" to p.getLong(LlmDownloadWorker.KEY_TOTAL, 0).toDouble(),
        "reason" to (p.getString(LlmDownloadWorker.KEY_REASON, "") ?: ""),
        "code" to p.getInt(LlmDownloadWorker.KEY_CODE, 0),
        "work" to (work?.name ?: "NONE"),
      )
    }

    // 취소(또는 다 받은 뒤 정리): 작업을 멈추고 상태를 지운다. 받던 파일은 앱이 지운다
    Function("cancel") {
      WorkManager.getInstance(context).cancelUniqueWork(LlmDownloadWorker.WORK_NAME)
      prefs().edit().clear().apply()
      (context.getSystemService(Context.NOTIFICATION_SERVICE) as android.app.NotificationManager).cancel(LlmDownloadWorker.NOTIF_ID)
    }

    // 파일 다루기: expo-file-system은 앱 전용 외부 저장소에 쓰기를 허용하지 않아(Missing 'WRITE' permission) 여기서 직접 한다
    Function("exists") { path: String -> File(path).exists() }
    Function("size") { path: String -> File(path).let { if (it.exists()) it.length().toDouble() else -1.0 } }
    Function("delete") { path: String -> File(path).let { !it.exists() || it.delete() } }
    Function("rename") { from: String, to: String ->
      val dest = File(to)
      if (dest.exists()) dest.delete()
      File(from).renameTo(dest)
    }
    // 앞 4바이트(모델 파일이면 "GGUF")
    Function("head") { path: String ->
      File(path).inputStream().use { s ->
        val b = ByteArray(4)
        val n = s.read(b)
        if (n <= 0) "" else String(b, 0, n, Charsets.ISO_8859_1)
      }
    }
  }
}
