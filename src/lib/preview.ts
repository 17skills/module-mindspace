import { unzipSync } from "fflate";

/** Small JPEG/PNG data URL used as card preview. */
export async function filePreview(file: File): Promise<string | null> {
  const name = file.name.toLowerCase();
  try {
    if (name.endsWith(".pdf")) return await pdfPreview(file);
    if (name.endsWith(".pptx") || name.endsWith(".docx")) return officePreview(file);
    if (file.type.startsWith("image/")) return await downscale(await createImageBitmap(file));
  } catch {
    return null;
  }
  return null;
}

async function pdfPreview(file: File): Promise<string | null> {
  const { getDocumentProxy } = await import("unpdf");
  const buffer = new Uint8Array(await file.arrayBuffer());
  const pdf = await getDocumentProxy(buffer);
  const page = await pdf.getPage(1);
  const base = page.getViewport({ scale: 1 });
  const scale = Math.min(480 / base.width, 2);
  const viewport = page.getViewport({ scale });
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(viewport.width);
  canvas.height = Math.round(viewport.height);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.fillStyle = "#ffffff";
  context.fillRect(0, 0, canvas.width, canvas.height);
  await page.render({ canvas, canvasContext: context, viewport }).promise;
  return canvas.toDataURL("image/jpeg", 0.7);
}

function officePreview(file: File): Promise<string | null> {
  return file.arrayBuffer().then((buffer) => {
    const files = unzipSync(new Uint8Array(buffer));
    const key = Object.keys(files).find((n) => /^docProps\/thumbnail\.(jpeg|jpg|png|emf)$/i.test(n));
    if (!key || key.endsWith(".emf")) return null;
    const bytes = files[key]!;
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    const mime = key.endsWith(".png") ? "image/png" : "image/jpeg";
    return `data:${mime};base64,${btoa(binary)}`;
  });
}

async function downscale(bitmap: ImageBitmap): Promise<string | null> {
  const scale = Math.min(480 / bitmap.width, 1);
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const context = canvas.getContext("2d");
  if (!context) return null;
  context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL("image/jpeg", 0.7);
}
