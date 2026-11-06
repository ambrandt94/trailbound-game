/** Room pins are deferred. The colour hash stays so the ported map draw still compiles. */
export interface ChatBubble {
  id: string;
  peerId: string;
  name: string;
  text: string;
  until: number;
}

const PEER_MARKER_COLORS = [
  '#f0a06a',
  '#5fc4b8',
  '#d4c05a',
  '#8aabe8',
  '#e8a0c0',
  '#a8d46a',
  '#e09060',
  '#70b8d8',
  '#d888b0',
  '#90c878',
  '#e8b070',
] as const;

export function peerMarkerColor(peerId: string): string {
  let h = 2166136261;
  for (let i = 0; i < peerId.length; i++) h = Math.imul(h ^ peerId.charCodeAt(i), 16777619);
  return PEER_MARKER_COLORS[(h >>> 0) % PEER_MARKER_COLORS.length]!;
}
