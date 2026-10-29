// 대화 흐름(시퀀스 다이어그램)을 PNG 이미지로 그린다.
// 화면을 캡처하지 않고 같은 내용을 캔버스에 직접 그려서, 스크롤에 가려진 부분까지 한 장에 담는다.
import { endpointAddr, endpointName, flowGuide, flowTitle } from '../core/describe.ts';
import type { Flow, Packet } from '../core/types.ts';
import type { Messages } from '../i18n/index.ts';

const WIDTH = 960;
const PAD = 24;
const TIME_COL = 84;
const LINE = 18;
/** 캔버스가 너무 커지면 브라우저가 그리지 못하므로 그 안에서 선명도를 정한다 */
const MAX_CANVAS = 30000;

interface Theme {
  bg: string;
  text: string;
  muted: string;
  line: string;
  soft: string;
  out: string;
  back: string;
  font: string;
}

/** 지금 화면의 색과 글꼴을 그대로 쓴다 */
function theme(): Theme {
  const css = getComputedStyle(document.documentElement);
  const v = (name: string) => css.getPropertyValue(name).trim();
  return { bg: v('--panel'), text: v('--text'), muted: v('--muted'), line: v('--line'), soft: v('--bg'), out: v('--accent'), back: '#5b8def', font: getComputedStyle(document.body).fontFamily };
}

const badgeColors = new Map<string, string>();
/** 배지 색은 CSS에 정해 둔 것을 읽어 와서 화면과 같게 맞춘다 */
function badgeColor(app: string): string {
  let color = badgeColors.get(app);
  if (!color) {
    const probe = document.createElement('span');
    probe.className = 'badge';
    probe.dataset.app = app;
    probe.style.position = 'absolute';
    probe.style.visibility = 'hidden';
    document.body.append(probe);
    color = getComputedStyle(probe).backgroundColor;
    probe.remove();
    badgeColors.set(app, color);
  }
  return color;
}

/** 주어진 폭에 맞게 줄을 나눈다. 띄어쓰기가 없는 긴 낱말은 글자 단위로 자른다. */
function wrap(ctx: CanvasRenderingContext2D, text: string, width: number, firstIndent = 0): string[] {
  const lines: string[] = [];
  let line = '';
  let room = width - firstIndent;
  for (const word of text.split(/(?<= )/)) {
    if (ctx.measureText(line + word).width <= room) {
      line += word;
      continue;
    }
    if (line) {
      lines.push(line.trimEnd());
      line = '';
      room = width;
    }
    for (const ch of word) {
      if (ctx.measureText(line + ch).width > room && line) {
        lines.push(line);
        line = '';
        room = width;
      }
      line += ch;
    }
  }
  if (line) lines.push(line.trimEnd());
  return lines.length ? lines : [''];
}

type Row = { kind: 'stage'; text: string; height: number } | { kind: 'packet'; packet: Packet; lines: string[]; height: number };

/** 대화의 앞에서부터 packets까지를 그림으로 그린다 */
export function drawFlow(flow: Flow, packets: Packet[], names: Map<string, string>, L: Messages): HTMLCanvasElement {
  const t = theme();
  const font = (size: number, weight = 400) => `${weight} ${size}px ${t.font}`;
  const scratch = document.createElement('canvas').getContext('2d')!;
  const arrowLeft = PAD + TIME_COL;
  const arrowRight = WIDTH - PAD;
  const labelWidth = arrowRight - arrowLeft - 28;

  // 1. 줄 나누기와 높이 계산
  scratch.font = font(17, 700);
  const titleLines = wrap(scratch, flowTitle(flow, names, L), WIDTH - PAD * 2, 0);
  scratch.font = font(13);
  const guideLines = wrap(scratch, flowGuide(flow, L), WIDTH - PAD * 2);
  const rows: Row[] = [];
  packets.forEach((p, i) => {
    if (p.stage && p.stage !== packets[i - 1]?.stage) rows.push({ kind: 'stage', text: L.flow.stages[p.stage], height: 30 });
    scratch.font = font(11, 600);
    const badge = scratch.measureText(p.proto).width + 14 + 6;
    scratch.font = font(13);
    const lines = wrap(scratch, p.summary, labelWidth, badge);
    rows.push({ kind: 'packet', packet: p, lines, height: lines.length * LINE + 22 });
  });
  const headerHeight = PAD + titleLines.length * 24 + guideLines.length * LINE + 16;
  const endsHeight = 64;
  const bodyHeight = rows.reduce((n, r) => n + r.height, 0);
  const footerHeight = 40;
  const height = headerHeight + endsHeight + bodyHeight + footerHeight;
  const scale = Math.max(1, Math.min(2, Math.floor(MAX_CANVAS / height)));

  // 2. 그리기
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d')!;
  ctx.scale(scale, scale);
  ctx.fillStyle = t.bg;
  ctx.fillRect(0, 0, WIDTH, height);
  ctx.textBaseline = 'top';

  const roundRect = (x: number, y: number, w: number, h: number, r: number, fill: string, stroke?: string) => {
    ctx.beginPath();
    ctx.roundRect(x, y, w, h, r);
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.stroke();
    }
  };
  const badge = (app: string, x: number, y: number) => {
    ctx.font = font(11, 600);
    const w = ctx.measureText(app).width + 14;
    roundRect(x, y, w, 18, 4, badgeColor(app));
    ctx.fillStyle = '#fff';
    ctx.fillText(app, x + 7, y + 3);
    return w;
  };

  let y = PAD;
  ctx.font = font(17, 700);
  ctx.fillStyle = t.text;
  for (const line of titleLines) {
    ctx.fillText(line, PAD, y);
    y += 24;
  }
  ctx.font = font(13);
  ctx.fillStyle = t.muted;
  for (const line of guideLines) {
    ctx.fillText(line, PAD, y);
    y += LINE;
  }
  y += 16;

  // 양쪽 상대
  const end = (role: string, name: string, addr: string, right: boolean) => {
    const w = 300;
    const x = right ? arrowRight - w : arrowLeft;
    roundRect(x, y, w, 52, 8, t.soft, t.line);
    ctx.textAlign = right ? 'right' : 'left';
    const tx = right ? x + w - 12 : x + 12;
    ctx.font = font(11);
    ctx.fillStyle = t.muted;
    ctx.fillText(role, tx, y + 6);
    ctx.font = font(13, 700);
    ctx.fillStyle = t.text;
    ctx.fillText(name, tx, y + 20, w - 24);
    if (addr && addr !== name) {
      ctx.font = font(11);
      ctx.fillStyle = t.muted;
      ctx.fillText(addr, tx, y + 36, w - 24);
    }
    ctx.textAlign = 'left';
  };
  end(L.flow.initiator, endpointName(flow.a, names), endpointAddr(flow.a), false);
  end(L.flow.peer, endpointName(flow.b, names), endpointAddr(flow.b), true);
  y += endsHeight;

  // 생명선: 양쪽 상대 아래로 내려오는 세로선
  ctx.strokeStyle = t.line;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(arrowLeft, y - 12);
  ctx.lineTo(arrowLeft, y + bodyHeight);
  ctx.moveTo(arrowRight, y - 12);
  ctx.lineTo(arrowRight, y + bodyHeight);
  ctx.stroke();

  const start = flow.firstTs;
  for (const row of rows) {
    if (row.kind === 'stage') {
      roundRect(arrowLeft + 8, y + 6, arrowRight - arrowLeft - 16, 20, 5, t.soft);
      ctx.font = font(12, 600);
      ctx.fillStyle = t.muted;
      ctx.textAlign = 'center';
      ctx.fillText(row.text, (arrowLeft + arrowRight) / 2, y + 10);
      ctx.textAlign = 'left';
      y += row.height;
      continue;
    }
    const p = row.packet;
    const ltr = p.fromA !== false;
    const color = ltr ? t.out : t.back;
    const textTop = y + 8;
    ctx.font = font(11);
    ctx.fillStyle = t.muted;
    ctx.fillText(`+${L.ui.seconds((p.ts - start).toFixed(3))}`, PAD, textTop + row.lines.length * LINE - 6);

    // 글자: 오른쪽으로 가는 화살표는 왼쪽 정렬, 왼쪽으로 오는 화살표는 오른쪽 정렬
    row.lines.forEach((line, i) => {
      ctx.font = font(13);
      const lineWidth = ctx.measureText(line).width;
      ctx.font = font(11, 600);
      const badgeWidth = i === 0 ? ctx.measureText(p.proto).width + 14 + 6 : 0;
      const x = ltr ? arrowLeft + 14 : arrowRight - 14 - badgeWidth - lineWidth;
      if (i === 0) badge(p.proto, x, textTop - 1);
      ctx.font = font(13);
      ctx.fillStyle = t.text;
      ctx.fillText(line, x + badgeWidth, textTop + i * LINE);
    });

    // 화살표
    const ay = textTop + row.lines.length * LINE + 4;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(arrowLeft + 4, ay);
    ctx.lineTo(arrowRight - 4, ay);
    ctx.stroke();
    const tip = ltr ? arrowRight - 2 : arrowLeft + 2;
    const back = ltr ? -8 : 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.moveTo(tip, ay);
    ctx.lineTo(tip + back, ay - 5);
    ctx.lineTo(tip + back, ay + 5);
    ctx.fill();
    y += row.height;
  }

  ctx.font = font(11);
  ctx.fillStyle = t.muted;
  ctx.fillText(L.ui.exportFooter(flow.packets.length, packets.length), PAD, y + 14);
  return canvas;
}

const toBlob = (canvas: HTMLCanvasElement) => new Promise<Blob>((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('empty'))), 'image/png'));

/** 그림을 PNG 파일로 내려받게 한다 */
export async function saveFlowImage(canvas: HTMLCanvasElement, name: string) {
  const url = URL.createObjectURL(await toBlob(canvas));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** 그림을 클립보드에 넣는다. 노션이나 블로그에 바로 붙여 넣을 수 있다. */
export async function copyFlowImage(canvas: HTMLCanvasElement) {
  // 클릭한 순간에 ClipboardItem을 만들어야 브라우저가 허락하므로, 그림은 약속(Promise)으로 넘긴다
  // 창에 초점이 없으면 브라우저가 답을 주지 않고 멈춰 있기도 해서, 잠시 뒤에는 실패로 본다
  const giveUp = new Promise<never>((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000));
  await Promise.race([navigator.clipboard.write([new ClipboardItem({ 'image/png': toBlob(canvas) })]), giveUp]);
}
