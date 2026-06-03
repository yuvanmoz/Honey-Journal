#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use tauri::api::dialog::blocking::FileDialogBuilder;
use std::fs;
use std::path::Path;

#[tauri::command]
fn select_folder() -> Option<String> {
  let folder = FileDialogBuilder::new().pick_folder();
  folder.map(|p| p.to_string_lossy().into_owned())
}

#[tauri::command]
fn fs_write_text_file(path: String, content: String) -> Result<(), String> {
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

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![
      select_folder,
      fs_write_text_file,
      fs_read_text_file,
      fs_remove_file,
      fs_create_dir,
      fs_read_dir_json
    ])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
