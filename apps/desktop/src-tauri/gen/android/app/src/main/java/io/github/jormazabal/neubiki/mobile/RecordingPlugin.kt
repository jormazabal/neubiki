package io.github.jormazabal.neubiki.mobile

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import app.tauri.annotation.Command
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.JSObject
import app.tauri.plugin.Plugin
import androidx.core.content.ContextCompat
import org.json.JSONObject

@TauriPlugin
class RecordingPlugin(private val activity: Activity): Plugin(activity) {
    @Command
    fun control(invoke: Invoke) {
        val args = invoke.getArgs()
        val action = args.optString("action")
        val root = args.optString("root")
        val payload = args.optJSONObject("payload")
        if (action.isBlank() || root.isBlank() || payload == null) {
            invoke.reject("Solicitud de grabación no válida.")
            return
        }
        activity.getSharedPreferences("recording-runtime",0).edit().putString("root",root).apply()
        if(action=="preview-stop" && !RecordingBridge.command("snapshot").optBoolean("preview")) {
            invoke.resolve(JSObject(RecordingBridge.command("snapshot").toString()));return
        }
        if (action == "start" || action == "resume" || action == "preview") {
            val permissions=mutableListOf(Manifest.permission.RECORD_AUDIO)
            if(android.os.Build.VERSION.SDK_INT>=33)permissions.add(Manifest.permission.POST_NOTIFICATIONS)
            if (permissions.any{ContextCompat.checkSelfPermission(activity,it)!=PackageManager.PERMISSION_GRANTED}) {
                activity.requestPermissions(permissions.toTypedArray(),8102)
                invoke.reject("Permite el micrófono y las notificaciones para disponer de controles en segundo plano; después vuelve a iniciar.")
                return
            }
        }
        if (action == "queue") {
            try { val value=RecordingBridge.command(action,payload);RecordingWorker.enqueue(activity);invoke.resolve(JSObject(value.toString())) } catch (e:Exception) {invoke.reject(e.message ?: "Error de grabación")}
            return
        }
        val requestId=java.util.UUID.randomUUID().toString()
        MeetingRecordingService.replies[requestId]=invoke
        val intent=Intent(activity,MeetingRecordingService::class.java).putExtra("action",action).putExtra("payload",payload.toString()).putExtra("requestId",requestId)
        try { ContextCompat.startForegroundService(activity,intent) } catch (e:Exception) { MeetingRecordingService.replies.remove(requestId);invoke.reject(e.message ?: "No se pudo iniciar el servicio de micrófono") }
    }
}

object RecordingBridge {
    @JvmStatic external fun nativeInit(root:String):String
    @JvmStatic external fun nativeCommand(action:String,payload:String):String
    @JvmStatic external fun nativeSamples(id:String,bytes:ByteArray):String
    @JvmStatic external fun nativeWork():String
    fun unwrap(raw:String):JSONObject {val result=JSONObject(raw);if(!result.optBoolean("ok"))throw IllegalStateException(result.optString("error"));return result.optJSONObject("value")?:JSONObject()}
    fun command(action:String,payload:JSONObject=JSONObject()):JSONObject=unwrap(nativeCommand(action,payload.toString()))
    fun init(context:android.content.Context) {
        System.loadLibrary("neubiki_desktop_lib")
        CredentialVault.install(context)
        val root=context.getSharedPreferences("recording-runtime",0).getString("root",null)?:throw IllegalStateException("Abre Neubiki para inicializar la grabación")
        unwrap(nativeInit(root))
    }
}
