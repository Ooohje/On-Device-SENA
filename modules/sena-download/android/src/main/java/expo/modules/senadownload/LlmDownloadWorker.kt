package expo.modules.senadownload

import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.content.Context
import android.content.pm.ServiceInfo
import android.os.Build
import androidx.core.app.NotificationCompat
import androidx.work.ForegroundInfo
import androidx.work.Worker
import androidx.work.WorkerParameters
import java.io.File
import java.io.FileOutputStream
import java.io.IOException
import java.net.HttpURLConnection
import java.net.URL

// 대화 모델(2.5GB) 받기 작업. Android 다운로드 관리자는 Drive 주소를 이어 받지 못해(ERROR_CANNOT_RESUME 1008, 2026-10-25 에뮬레이터)
// 연결이 잠깐만 끊겨도 실패했다 → 직접 받는다.
// - WorkManager 작업이라 앱을 닫아도 계속되고, 상단바 알림에 진행률을 보여 준다(포그라운드 작업)
// - 연결이 끊기면 Result.retry() → 인터넷이 다시 연결되면 WorkManager가 다시 실행하고, 받은 만큼(.part 크기)부터 Range 요청으로 이어 받는다
// - 진행 상황은 SharedPreferences에 써 두고 앱 화면이 1초마다 읽는다(SenaDownloadModule.status)
class LlmDownloadWorker(private val ctx: Context, params: WorkerParameters) : Worker(ctx, params) {
  override fun doWork(): Result {
    val url = inputData.getString(KEY_URL) ?: return Result.failure()
    val rel = inputData.getString(KEY_REL) ?: return Result.failure()
    val expected = inputData.getLong(KEY_BYTES, -1L)
    val part = File(ctx.getExternalFilesDir(null), rel)
    part.parentFile?.mkdirs()
    if (expected > 0 && part.length() == expected) return done(expected)

    try {
      setForegroundAsync(foregroundInfo(part.length(), expected)).get()
    } catch (e: Exception) {
      // Android 12+는 앱이 뒤에 있을 때 포그라운드 시작을 막는다(다시 시도하는 실행). 알림 없이 계속 받는다
    }

    var conn: HttpURLConnection? = null
    try {
      val from = part.length()
      conn = (URL(url).openConnection() as HttpURLConnection).apply {
        connectTimeout = 20_000
        readTimeout = 30_000
        instanceFollowRedirects = true
        if (from > 0) setRequestProperty("Range", "bytes=$from-")
      }
      val code = conn.responseCode
      if (code == 416 && expected > 0 && part.length() == expected) return done(expected)
      if (code != 200 && code != 206) {
        // 403·429: Drive 이용량 한도 등 — 잠시 뒤 다시 시도. 그 밖의 오류는 실패로 알린다
        return if (code == 403 || code == 429 || code >= 500) waiting("server", code) else failed("http", code)
      }
      val append = code == 206 && from > 0 // 200이면 서버가 이어 받기를 무시한 것 → 처음부터
      var got = if (append) from else 0L
      write(STATE_RUNNING, got, expected)
      conn.inputStream.use { input ->
        FileOutputStream(part, append).use { out ->
          val buf = ByteArray(256 * 1024)
          var last = 0L
          while (true) {
            if (isStopped) return Result.retry() // 취소·시간 제한: 취소면 앱이 상태를 지운다, 시간 제한이면 다시 실행돼 이어 받는다
            val n = input.read(buf)
            if (n < 0) break
            out.write(buf, 0, n)
            got += n
            val now = System.currentTimeMillis()
            if (now - last > 1000) {
              last = now
              write(STATE_RUNNING, got, expected)
              notifyProgress(got, expected)
            }
          }
        }
      }
      if (expected > 0 && got != expected) return waiting("short", 0)
      return done(got)
    } catch (e: IOException) {
      return waiting("network", 0) // 인터넷이 다시 연결되면 이어 받는다
    } finally {
      conn?.disconnect()
    }
  }

  private fun done(bytes: Long): Result {
    write(STATE_DONE, bytes, bytes)
    notifyMgr().cancel(NOTIF_ID)
    notifyMgr().notify(
      NOTIF_ID + 1,
      NotificationCompat.Builder(ctx, CHANNEL)
        .setSmallIcon(android.R.drawable.stat_sys_download_done)
        .setContentTitle("SENA 대화 모델을 받았어요")
        .setContentText("이제 자유 대화를 할 수 있어요.")
        .setContentIntent(openApp())
        .setAutoCancel(true)
        .build(),
    )
    return Result.success()
  }

  private fun waiting(reason: String, code: Int): Result {
    prefs().edit().putString(KEY_STATE, STATE_WAITING).putString(KEY_REASON, reason).putInt(KEY_CODE, code).apply()
    return Result.retry()
  }

  private fun failed(reason: String, code: Int): Result {
    prefs().edit().putString(KEY_STATE, STATE_FAILED).putString(KEY_REASON, reason).putInt(KEY_CODE, code).apply()
    notifyMgr().cancel(NOTIF_ID)
    return Result.failure()
  }

  private fun write(state: String, got: Long, total: Long) {
    prefs().edit().putString(KEY_STATE, state).putLong(KEY_GOT, got).putLong(KEY_TOTAL, total).putString(KEY_REASON, "").apply()
  }

  private fun prefs() = ctx.getSharedPreferences(PREFS, Context.MODE_PRIVATE)
  private fun notifyMgr() = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager

  private fun openApp(): PendingIntent? =
    ctx.packageManager.getLaunchIntentForPackage(ctx.packageName)?.let {
      PendingIntent.getActivity(ctx, 0, it, PendingIntent.FLAG_IMMUTABLE or PendingIntent.FLAG_UPDATE_CURRENT)
    }

  private fun progressNotification(got: Long, total: Long) =
    NotificationCompat.Builder(ctx, CHANNEL)
      .setSmallIcon(android.R.drawable.stat_sys_download)
      .setContentTitle("SENA 대화 모델 받는 중")
      .setContentText(if (total > 0) "%.2f / %.2fGB".format(got / 1e9, total / 1e9) else "휴대폰 안에서 동작하는 영어 대화 AI")
      .setProgress(100, if (total > 0) (got * 100 / total).toInt() else 0, total <= 0)
      .setOngoing(true)
      .setOnlyAlertOnce(true)
      .setContentIntent(openApp())
      .build()

  private fun notifyProgress(got: Long, total: Long) {
    try {
      notifyMgr().notify(NOTIF_ID, progressNotification(got, total))
    } catch (e: SecurityException) {
      // 알림 권한이 없으면 알림 없이 받는다
    }
  }

  private fun foregroundInfo(got: Long, total: Long): ForegroundInfo {
    ensureChannel(ctx)
    val n = progressNotification(got, total)
    return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) ForegroundInfo(NOTIF_ID, n, ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC) else ForegroundInfo(NOTIF_ID, n)
  }

  companion object {
    const val WORK_NAME = "sena-llm-download"
    const val PREFS = "sena_llm_download"
    const val KEY_URL = "url"
    const val KEY_REL = "rel"
    const val KEY_BYTES = "bytes"
    const val KEY_STATE = "state"
    const val KEY_GOT = "got"
    const val KEY_TOTAL = "total"
    const val KEY_REASON = "reason"
    const val KEY_CODE = "code"
    const val STATE_RUNNING = "running"
    const val STATE_WAITING = "waiting"
    const val STATE_DONE = "done"
    const val STATE_FAILED = "failed"
    const val CHANNEL = "sena_download"
    const val NOTIF_ID = 4201

    fun ensureChannel(ctx: Context) {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.O) return
      val nm = ctx.getSystemService(Context.NOTIFICATION_SERVICE) as NotificationManager
      if (nm.getNotificationChannel(CHANNEL) == null)
        nm.createNotificationChannel(NotificationChannel(CHANNEL, "대화 모델 받기", NotificationManager.IMPORTANCE_LOW))
    }
  }
}
