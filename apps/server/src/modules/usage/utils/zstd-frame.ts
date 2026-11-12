const Magic = 0xfd2fb528;
const DictionaryIdBytes = [0, 1, 2, 4];
const ShortSizeOffset = 256;

export const ZstdFrameHeaderBytes = 18;

export function zstdContentSizeOf(head: Buffer) {
  if (head.length < 6 || head.readUInt32LE(0) !== Magic) return undefined;
  const descriptor = head[4]!;
  const sizeFlag = descriptor >> 6;
  const isSingleSegment = (descriptor & 0x20) !== 0;
  const at = 5 + (isSingleSegment ? 0 : 1) + DictionaryIdBytes[descriptor & 0x03]!;
  if (sizeFlag === 0) return isSingleSegment && head.length > at ? head[at] : undefined;
  const bytes = 2 ** sizeFlag;
  if (head.length < at + bytes) return undefined;
  if (sizeFlag === 1) return head.readUInt16LE(at) + ShortSizeOffset;
  if (sizeFlag === 2) return head.readUInt32LE(at);
  return Number(head.readBigUInt64LE(at));
}
