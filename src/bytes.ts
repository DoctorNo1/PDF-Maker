/** Копія байтів як самостійний ArrayBuffer (Uint8Array може дивитись у більший буфер). */
export function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  return data.buffer.slice(
    data.byteOffset,
    data.byteOffset + data.byteLength,
  ) as ArrayBuffer;
}
