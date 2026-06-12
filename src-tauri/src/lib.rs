use tauri_plugin_dialog::DialogExt;
use std::fs;
use std::path::Path;

// Desktop: opens native folder picker dialog.
// Mobile:  auto-returns the shared HoneyJournal path without any picker.
#[tauri::command]
fn select_folder(app: tauri::AppHandle) -> Option<String> {
  #[cfg(desktop)]
  {
    let folder = app.dialog().file().blocking_pick_folder();
    folder.and_then(|p| p.into_path().ok()).map(|pb| pb.to_string_lossy().into_owned())
  }
  #[cfg(mobile)]
  {
    let _ = app; // suppress unused warning
    Some("/storage/emulated/0/HoneyJournal".to_string())
  }
}

// Check if the app can actually write to the shared HoneyJournal folder.
// On Android this is only possible after MANAGE_EXTERNAL_STORAGE is granted.
// Returns true if the folder exists AND we can write a test file inside it.
#[tauri::command]
fn check_storage_permission() -> bool {
  #[cfg(target_os = "android")]
  {
    let base = Path::new("/storage/emulated/0/HoneyJournal");
    if fs::create_dir_all(base).is_err() {
      return false;
    }
    let probe = base.join(".honey_probe");
    if fs::write(&probe, b"ok").is_err() {
      return false;
    }
    let _ = fs::remove_file(&probe);
    true
  }
  #[cfg(not(target_os = "android"))]
  {
    true
  }
}

// Open the system Settings screen that lets the user enable
// "Allow management of all files" for this app.
// Uses the Android Activity Manager shell tool (available on all Android versions).
#[tauri::command]
fn request_storage_permission(app: tauri::AppHandle) -> Result<(), String> {
  #[cfg(target_os = "android")]
  {
    use tauri::Manager;
    use jni::objects::JValue;

    let webview_window = app.get_webview_window("main")
      .ok_or_else(|| "Failed to get main webview window".to_string())?;

    webview_window.with_webview(|webview| {
      webview.jni_handle().exec(move |env, context, _webview| {
        // 1. Find classes
        let intent_class = env.find_class("android/content/Intent").unwrap();
        let settings_class = env.find_class("android/provider/Settings").unwrap();

        // 2. Get static action string Settings.ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION
        let action_field = env.get_static_field(
          settings_class,
          "ACTION_MANAGE_APP_ALL_FILES_ACCESS_PERMISSION",
          "Ljava/lang/String;"
        ).unwrap();
        let action_str = action_field.l().unwrap();

        // 3. Create Intent: new Intent(action)
        let intent = env.new_object(
          intent_class,
          "(Ljava/lang/String;)V",
          &[JValue::Object(&action_str)]
        ).unwrap();

        // 4. Create Uri: Uri.parse("package:com.honeyjournal.app")
        let uri_class = env.find_class("android/net/Uri").unwrap();
        let package_uri_str = env.new_string("package:com.honeyjournal.app").unwrap();
        let package_uri = env.call_static_method(
          uri_class,
          "parse",
          "(Ljava/lang/String;)Landroid/net/Uri;",
          &[JValue::Object(&package_uri_str)]
        ).unwrap().l().unwrap();

        // 5. Set data: intent.setData(package_uri)
        env.call_method(
          &intent,
          "setData",
          "(Landroid/net/Uri;)Landroid/content/Intent;",
          &[JValue::Object(&package_uri)]
        ).unwrap();

        // 6. Start activity: context.startActivity(intent)
        env.call_method(
          context,
          "startActivity",
          "(Landroid/content/Intent;)V",
          &[JValue::Object(&intent)]
        ).unwrap();
      });
    }).map_err(|e| e.to_string())?;
  }
  #[cfg(not(target_os = "android"))]
  {
    let _ = app; // suppress unused warning
  }
  Ok(())
}

#[tauri::command]
fn fs_write_text_file(path: String, content: String) -> Result<(), String> {
  // Ensure parent directory exists before writing
  if let Some(parent) = Path::new(&path).parent() {
    fs::create_dir_all(parent).map_err(|e| e.to_string())?;
  }
  fs::write(Path::new(&path), content).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_text_file(path: String) -> Result<String, String> {
  fs::read_to_string(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_remove_file(path: String) -> Result<(), String> {
  fs::remove_file(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_create_dir(path: String) -> Result<(), String> {
  fs::create_dir_all(Path::new(&path)).map_err(|e| e.to_string())
}

#[tauri::command]
fn fs_read_dir_json(path: String) -> Result<Vec<String>, String> {
  let dir_path = Path::new(&path);
  if !dir_path.exists() {
    return Ok(Vec::new());
  }
  let entries = fs::read_dir(dir_path).map_err(|e| e.to_string())?;
  let mut results = Vec::new();
  for entry in entries {
    if let Ok(entry) = entry {
      let file_path = entry.path();
      if file_path.is_file() && file_path.extension().map_or(false, |ext| ext == "json") {
        if let Ok(content) = fs::read_to_string(&file_path) {
          results.push(content);
        }
      }
    }
  }
  Ok(results)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_dialog::init())
    .plugin(tauri_plugin_fs::init())
    .invoke_handler(tauri::generate_handler![
      select_folder,
      check_storage_permission,
      request_storage_permission,
      fs_write_text_file,
      fs_read_text_file,
      fs_remove_file,
      fs_create_dir,
      fs_read_dir_json
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
