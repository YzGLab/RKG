use std::{fs, path::{Path, PathBuf}};

fn save_path(filename: &str) -> Option<PathBuf> {
  let dialog = rfd::FileDialog::new().set_file_name(filename);
  let path = match Path::new(filename)
    .extension()
    .and_then(|ext| ext.to_str())
    .map(|ext| ext.to_ascii_lowercase())
    .as_deref()
  {
    Some("csv") => dialog.add_filter("CSV", &["csv"]).save_file(),
    Some("png") => dialog.add_filter("PNG image", &["png"]).save_file(),
    _ => dialog.save_file(),
  };

  path.map(|mut selected| {
    if selected.extension().is_none() {
      if let Some(ext) = Path::new(filename).extension() {
        selected.set_extension(ext);
      }
    }
    selected
  })
}

#[tauri::command]
fn save_text_file(filename: String, content: String) -> Result<bool, String> {
  let Some(path) = save_path(&filename) else {
    return Ok(false);
  };

  fs::write(path, content).map_err(|err| err.to_string())?;
  Ok(true)
}

#[tauri::command]
fn save_binary_file(filename: String, bytes: Vec<u8>) -> Result<bool, String> {
  let Some(path) = save_path(&filename) else {
    return Ok(false);
  };

  fs::write(path, bytes).map_err(|err| err.to_string())?;
  Ok(true)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .invoke_handler(tauri::generate_handler![save_text_file, save_binary_file])
    .setup(|app| {
      if cfg!(debug_assertions) {
        app.handle().plugin(
          tauri_plugin_log::Builder::default()
            .level(log::LevelFilter::Info)
            .build(),
        )?;
      }
      Ok(())
    })
    .run(tauri::generate_context!())
    .expect("error while running tauri application");
}
