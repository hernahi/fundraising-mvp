// Returns a local blob URL for previewing images without uploading anywhere.
export async function mockUploadImage(file) {
  if (!file) return null;
  return URL.createObjectURL(file); // remember: not persisted; page refresh clears it
}
