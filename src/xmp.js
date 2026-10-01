// MARK AN EXPORTED IMAGE AS AI-GENERATED, MACHINE-READABLY.
//
// WHY THIS EXISTS. EU AI Act Article 50(2) requires a provider of a system that
// generates synthetic images to mark its outputs "in a machine-readable format
// and detectable as artificially generated or manipulated". It applies from
// 2 August 2026, and it is triggered by selling into the EU rather than by
// where the seller sits, so a one-person business outside the EU is in scope
// the moment it takes a European customer.
//
// The disclaimer line printed on every image already covers the human-readable
// half. This is the other half, and nothing in the pipeline carried it: every
// export goes through canvas.toBlob, which encodes raw pixels, so whatever
// Google attached to the model's own output was gone long before the file
// reached the customer.
//
// WHAT IT WRITES. The IPTC vocabulary term for this, which is what checking
// tools look for:
//
//   Iptc4xmpExt:DigitalSourceType = ...digitalsourcetype/trainedAlgorithmicMedia
//
// C2PA Content Credentials are the stronger form -- a signed manifest that also
// proves the file has not been altered since. They need a signing certificate
// and a library, so this is the first step rather than the last one. XMP is
// standard, it is what the term was defined for, and it needs neither.
//
// NO DEPENDENCY, because the project has no build step and adding one for a few
// hundred bytes of metadata would be a poor trade. Both containers take the
// packet as a labelled block that decoders skip if they do not care about it:
// PNG in an ancillary iTXt chunk, JPEG in an APP1 segment.

/** The packet itself. Small, static, and identical in every export. */
export function xmpPacket({ tool = 'StyloPlan' } = {}) {
  return '<?xpacket begin="﻿" id="W5M0MpCehiHzreSzNTczkc9d"?>'
    + '<x:xmpmeta xmlns:x="adobe:ns:meta/">'
    + '<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">'
    + '<rdf:Description rdf:about=""'
    + ' xmlns:Iptc4xmpExt="http://iptc.org/std/Iptc4xmpExt/2008-02-29/"'
    + ' xmlns:xmp="http://ns.adobe.com/xap/1.0/">'
    + '<Iptc4xmpExt:DigitalSourceType>'
    + 'http://cv.iptc.org/newscodes/digitalsourcetype/trainedAlgorithmicMedia'
    + '</Iptc4xmpExt:DigitalSourceType>'
    + `<xmp:CreatorTool>${tool}</xmp:CreatorTool>`
    + '</rdf:Description></rdf:RDF></x:xmpmeta>'
    + '<?xpacket end="w"?>';
}

// PNG's own CRC, over the chunk type and data. An ancillary chunk with a wrong
// CRC is a corrupt file to a strict reader, so this is not optional.
const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(bytes) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A];
const utf8 = (s) => new TextEncoder().encode(s);

/**
 * Insert the packet as an iTXt chunk immediately before IEND.
 *
 * Before IEND rather than after IHDR because the position is free either way
 * and appending is the smaller edit: everything up to the final chunk is
 * copied through untouched.
 */
export function pngWithXmp(bytes, packet) {
  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (bytes[i] !== PNG_SIGNATURE[i]) throw new Error('not a PNG');
  }
  // keyword \0 compressionFlag compressionMethod languageTag \0 translated \0 text
  const head = utf8('XML:com.adobe.xmp');
  const text = utf8(packet);
  const data = new Uint8Array(head.length + 5 + text.length);
  data.set(head, 0);
  // data[head.length] is the keyword's terminating NUL, then two zero bytes for
  // "uncompressed" and "method 0", then two more NULs closing the empty
  // language tag and empty translated keyword. Five zeroes in a row, which is
  // why this reads as one gap rather than five writes.
  data.set(text, head.length + 5);

  const typed = new Uint8Array(4 + data.length);
  typed.set(utf8('iTXt'), 0);
  typed.set(data, 4);

  const chunk = new Uint8Array(4 + typed.length + 4);
  new DataView(chunk.buffer).setUint32(0, data.length);
  chunk.set(typed, 4);
  new DataView(chunk.buffer).setUint32(4 + typed.length, crc32(typed));

  // Walk the chunks to find IEND rather than assuming it is the last 12 bytes:
  // an encoder is free to append anything after it.
  let at = 8;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  while (at + 8 <= bytes.length) {
    const len = view.getUint32(at);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    if (type === 'IEND') break;
    at += 12 + len;
  }
  if (at + 8 > bytes.length) throw new Error('PNG has no IEND');

  const out = new Uint8Array(bytes.length + chunk.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(chunk, at);
  out.set(bytes.subarray(at), at + chunk.length);
  return out;
}

const XMP_APP1_ID = 'http://ns.adobe.com/xap/1.0/\0';

/**
 * Insert the packet as an APP1 segment, after SOI and after any APP0 the
 * encoder wrote, which is where a reader expects to find it.
 */
export function jpegWithXmp(bytes, packet) {
  if (bytes[0] !== 0xFF || bytes[1] !== 0xD8) throw new Error('not a JPEG');
  const body = utf8(XMP_APP1_ID + packet);
  // The length field counts itself but not the marker.
  const size = body.length + 2;
  if (size > 0xFFFF) throw new Error('XMP packet too large for one APP1 segment');
  const seg = new Uint8Array(4 + body.length);
  seg[0] = 0xFF; seg[1] = 0xE1;
  seg[2] = (size >> 8) & 0xFF; seg[3] = size & 0xFF;
  seg.set(body, 4);

  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xFF && bytes[at + 1] === 0xE0) {
    at += 2 + ((bytes[at + 2] << 8) | bytes[at + 3]);
  }

  const out = new Uint8Array(bytes.length + seg.length);
  out.set(bytes.subarray(0, at), 0);
  out.set(seg, at);
  out.set(bytes.subarray(at), at + seg.length);
  return out;
}

/**
 * The one function the compositor calls. Returns a new Blob of the same type.
 *
 * A FAILURE HERE MUST NOT COST SOMEBODY THEIR EXPORT. The metadata is a legal
 * marking, and it matters, but it is not the picture: if the bytes are not
 * shaped the way this expects, the original blob is handed back rather than an
 * error thrown at a customer who pressed Download.
 */
export async function markAiGenerated(blob, opts = {}) {
  try {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const packet = xmpPacket(opts);
    if (blob.type === 'image/png') return new Blob([pngWithXmp(bytes, packet)], { type: blob.type });
    if (blob.type === 'image/jpeg') return new Blob([jpegWithXmp(bytes, packet)], { type: blob.type });
    return blob;
  } catch {
    return blob;
  }
}
