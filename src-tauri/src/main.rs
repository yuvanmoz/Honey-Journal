#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

use tauri::api::dialog::blocking::FileDialogBuilder;

#[tauri::command]
fn select_folder() -> Option<String> {
  let folder = FileDialogBuilder::new().pick_folder();
  folder.map(|p| p.to_string_lossy().into_owned())
}

fn main() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![select_folder])
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
