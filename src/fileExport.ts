import { invoke } from '@tauri-apps/api/core'

function isTauriRuntime() {
  return typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window
}

function browserDownload(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  link.remove()
  URL.revokeObjectURL(url)
}

export async function saveTextFile(filename: string, content: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType })
  if (!isTauriRuntime()) {
    browserDownload(filename, blob)
    return
  }

  const saved = await invoke<boolean>('save_text_file', { filename, content })
  if (!saved) return
}

export async function saveBlobFile(filename: string, blob: Blob) {
  if (!isTauriRuntime()) {
    browserDownload(filename, blob)
    return
  }

  const bytes = Array.from(new Uint8Array(await blob.arrayBuffer()))
  const saved = await invoke<boolean>('save_binary_file', { filename, bytes })
  if (!saved) return
}
