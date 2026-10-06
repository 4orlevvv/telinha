// Teste automático do Telinha: abre 3 a 5 pessoas no Chrome de verdade (sinalização PeerJS real, precisa de internet)
// e confere tela, áudio estéreo, chat, reações, voz, mixer, pausa, qualidade, codec, troca de tela, print, gravação,
// lupa, modo cinema, atraso x fluidez, imagens no chat, qualidade por espectador e automática, apertar para falar,
// sensibilidade do microfone, celular, proteção do hub, tela cheia e a troca de hub quando quem hospeda sai.
// Uso (uma vez): npm i playwright-core     Depois: node teste-e2e.mjs index.html
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";

const file = process.argv[2];
const srv = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(fs.readFileSync(file)); }).listen(0);
const base = `http://localhost:${srv.address().port}/`;
const room = "e2e-" + Math.random().toString(36).slice(2, 7);
const browser = await chromium.launch({
  executablePath: "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true,
  args: ["--autoplay-policy=no-user-gesture-required", "--use-fake-ui-for-media-stream", "--use-fake-device-for-media-stream"],
});

const errors = [];
let fails = 0;
const step = async (name, fn) => {
  const t0 = Date.now();
  try { await fn(); console.log(`  ok   ${name} (${Date.now() - t0} ms)`); }
  catch (e) { fails++; console.log(`  FAIL ${name}: ${e.message.split("\n")[0]}`); }
};

// Tela falsa: canvas animado + tom de 440 Hz, no lugar do seletor do navegador.
const fakeDisplay = () => {
  navigator.mediaDevices.getDisplayMedia = async (opts) => {
    window.__gdm = opts;
    const c = document.createElement("canvas"); c.width = 1280; c.height = 720;
    const g = c.getContext("2d"); let f = 0;
    const draw = () => { f++; g.fillStyle = `hsl(${f * 3 % 360} 70% 45%)`; g.fillRect(0, 0, 1280, 720); g.fillStyle = "#fff"; g.font = "bold 90px sans-serif"; g.fillText("TELINHA " + f, 80, 380); };
    draw(); setInterval(draw, 33);
    const s = c.captureStream(30);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination();
    o.frequency.value = 440; o.connect(d); o.start();
    s.addTrack(d.stream.getAudioTracks()[0]);
    return s;
  };
};

async function person(name) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  await ctx.addInitScript(fakeDisplay);
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await p.goto(base + "#" + room);
  await p.fill("#ln", name);
  await p.click("#lf button[type=submit]");
  return { name, ctx, p };
}
const count = (x, n, timeout = 30000) => x.p.waitForFunction(n => document.querySelector("#cnt").dataset.s === "ok" && document.querySelector("#cnt").textContent.trim().startsWith(n + " "), n, { timeout });
const videoLive = (x, timeout = 30000) => x.p.waitForFunction(() => [...document.querySelectorAll(".tile:not([data-id=me]) video")].some(v => v.videoWidth > 0 && v.currentTime > 0), null, { timeout });

console.log("sala:", room);
const A = await person("Ana");
await step("A entra e vira hub", () => count(A, 1));
const B = await person("Bruno");
const C = await person("Caio");
await step("3 pessoas veem 3 na sala", async () => { await count(A, 3); await count(B, 3); await count(C, 3); });
for (const x of [A, B, C]) console.log("    id", x.name, (await x.p.evaluate(() => me.id)).slice(0, 6));
await step("lista de pessoas tem 3 linhas", async () => { const n = await A.p.$$eval("#people .person", e => e.length); if (n !== 3) throw new Error("linhas=" + n); });

await step("A compartilha a tela", () => A.p.click("#share"));
await step("B e C recebem o vídeo", async () => { await videoLive(B); await videoLive(C); });
await step("opções do getDisplayMedia corretas", async () => {
  const o = await A.p.evaluate(() => window.__gdm);
  if (o.video.width.max !== 1920 || o.video.frameRate.max !== 60 || o.systemAudio !== "include" || o.selfBrowserSurface !== "exclude") throw new Error(JSON.stringify(o));
});
await step("vídeo recebido tem faixa de áudio (mixer)", async () => {
  const n = await B.p.$eval(".tile:not([data-id=me]) video", v => v.srcObject.getAudioTracks().length);
  if (n !== 1) throw new Error("faixas=" + n);
});
await step("áudio da tela negociado em estéreo (Opus stereo=1) nos dois lados", async () => {
  const fmtp = (x, dir) => x.p.evaluate(async dir => {
    const c = dir === "in" ? [...inc.values()].find(x => x.kind === "screen")?.c : [...out.entries()].find(([k]) => k.startsWith("screen:"))?.[1];
    const st = await c.peerConnection.getStats(); let f = "";
    st.forEach(s => { if (s.type === (dir === "in" ? "inbound-rtp" : "outbound-rtp") && s.kind === "audio") f = st.get(s.codecId)?.sdpFmtpLine || "" });
    return f;
  }, dir);
  await B.p.waitForTimeout(1500);
  const a = await fmtp(A, "out"), b = await fmtp(B, "in");
  if (!/stereo=1/.test(a) || !/stereo=1/.test(b)) throw new Error(`envio="${a}" recebimento="${b}"`);
  console.log("    opus:", a);
});
await step("estatísticas aparecem no tile de B", async () => {
  await B.p.waitForFunction(() => /fps/.test(document.querySelector(".tile:not([data-id=me]) .stt")?.textContent || ""), null, { timeout: 10000 });
});
await step("A vê 'Enviando para 2'", () => A.p.waitForFunction(() => /Enviando para 2/.test(document.querySelector(".tile[data-id=me] .stt")?.textContent || ""), null, { timeout: 15000 }));
await step("B mostra A transmitindo na lista", () => B.p.waitForFunction(() => document.querySelectorAll("#people .shr").length === 1, null, { timeout: 10000 }));

await step("chat B -> A e C com link", async () => {
  await B.p.fill("#ci", "olá galera https://example.com/x");
  await B.p.press("#ci", "Enter");
  for (const x of [A, C]) await x.p.waitForFunction(() => [...document.querySelectorAll("#msgs .mt")].some(p => p.textContent.includes("olá galera") && p.querySelector("a[href='https://example.com/x']")), null, { timeout: 10000 });
});
await step("histórico do chat chega para quem entra depois", async () => {
  const D = await person("Duda");
  await count(D, 4);
  await D.p.waitForFunction(() => document.querySelector("#msgs").textContent.includes("olá galera"), null, { timeout: 10000 });
  await D.ctx.close();
  await count(A, 3, 40000);
});
await step("reação por atalho (tecla 2) chega em A", async () => {
  await C.p.keyboard.press("2");
  await A.p.waitForSelector("#fx .rx", { timeout: 8000 });
});

await step("B liga o microfone e A vê o ícone", async () => {
  await B.p.click("#mic");
  await A.p.waitForFunction(() => [...document.querySelectorAll("#people .person")].some(r => r.textContent.includes("Bruno") && r.querySelectorAll(".pi .i").length >= 1), null, { timeout: 15000 });
});
await step("A vê B falando (anel verde)", () => A.p.waitForFunction(() => [...document.querySelectorAll("#people .person.speaking")].some(r => r.textContent.includes("Bruno")), null, { timeout: 20000 }));
await step("B desliga o microfone e o anel some", async () => {
  await B.p.click("#mic");
  await A.p.waitForFunction(() => ![...document.querySelectorAll("#people .person.speaking")].some(r => r.textContent.includes("Bruno")), null, { timeout: 10000 });
});

await step("mixer: A adiciona entrada de áudio falsa", async () => {
  await A.p.click("#mb");
  await A.p.waitForSelector("#mixpop:popover-open");
  if (await A.p.isVisible("#perm")) { await A.p.click("#perm"); }
  await A.p.waitForFunction(() => document.querySelectorAll("#addlist .addi[data-dev]").length >= 1, null, { timeout: 10000 });
  await A.p.click("#addlist .addi[data-dev]");
  await A.p.waitForFunction(() => document.querySelectorAll("#msrcs .msrc").length === 2, null, { timeout: 10000 });
  await A.p.waitForFunction(() => parseFloat(getComputedStyle(document.querySelector("#mvu")).getPropertyValue("--l")) > 0.1, null, { timeout: 5000 });
  await A.p.keyboard.press("Escape");
});

await step("B pausa a tela de A e A passa a enviar para 1", async () => {
  await B.p.hover(".tile:not([data-id=me])");
  await B.p.click(".tile:not([data-id=me]) .pause");
  await B.p.waitForSelector(".tile[data-state=paused]", { timeout: 5000 });
  await A.p.waitForFunction(() => /Enviando para 1/.test(document.querySelector(".tile[data-id=me] .stt")?.textContent || ""), null, { timeout: 15000 });
});
await step("B volta a assistir", async () => {
  await B.p.click(".tile[data-state=paused] .watch");
  await videoLive(B);
});
await step("A troca qualidade ao vivo para 720p30", async () => {
  await A.p.click("#qb");
  await A.p.click("#qlist label:has(input[value=\"720p30\"])");
  await A.p.keyboard.press("Escape");
  await B.p.waitForTimeout(2000);
  await videoLive(B);
  const q = await A.p.$eval("#qlist input:checked", e => e.value); if (q !== "720p30") throw new Error("q=" + q);
});
await step("A troca codec para H264 (reconecta) e B volta a ver", async () => {
  await A.p.click("#qb");
  await A.p.selectOption("#codec", "H264");
  await A.p.keyboard.press("Escape");
  await B.p.waitForTimeout(3000);
  await videoLive(B);
  await B.p.waitForFunction(() => /H264/.test(document.querySelector(".tile:not([data-id=me]) .stt")?.textContent || ""), null, { timeout: 15000 });
});
await step("foco: clicar numa tela destaca quando há 2 telas", async () => {
  await C.p.click("#share");
  await B.p.waitForFunction(() => document.querySelectorAll(".tile:not([data-id=me])").length === 2, null, { timeout: 20000 });
  await B.p.click(".tile:not([data-id=me]) .frame", { position: { x: 30, y: 60 } });
  await B.p.waitForSelector("#grid.focus .tile.big", { timeout: 3000 });
  await C.p.click("#share");
  await B.p.waitForFunction(() => document.querySelectorAll(".tile:not([data-id=me])").length === 1, null, { timeout: 20000 });
});

await step("mixer: áudio de um programa vira 3ª fonte", async () => {
  await A.p.click("#mb");
  await A.p.waitForSelector("#mixpop:popover-open");
  await A.p.click("#addlist .addi:first-child");
  await A.p.waitForFunction(() => document.querySelectorAll("#msrcs .msrc").length === 3, null, { timeout: 8000 });
  const o = await A.p.evaluate(() => window.__gdm);
  if (o.windowAudio !== "window" || o.displaySurface !== "window") throw new Error(JSON.stringify(o));
  await A.p.keyboard.press("Escape");
});
await step("trocar a tela sem derrubar quem assiste", async () => {
  const before = await B.p.$eval(".tile:not([data-id=me])", t => t.dataset.id);
  await A.p.click("#qb");
  await A.p.click("#swap");
  await A.p.waitForFunction(() => /Trocado/.test(document.querySelector("#toasts").textContent), null, { timeout: 8000 });
  await B.p.waitForTimeout(1500);
  await videoLive(B);
  const after = await B.p.$eval(".tile:not([data-id=me])", t => t.dataset.id);
  if (before !== after) throw new Error("tile trocou");
  const srcs = await A.p.$$eval("#msrcs .msrc", e => e.length);
  if (srcs !== 3) throw new Error("fontes=" + srcs);
});
await step("print da tela (área de transferência ou download)", async () => {
  await B.p.hover(".tile:not([data-id=me])");
  await B.p.click(".tile:not([data-id=me]) .shot");
  await B.p.waitForFunction(() => /Print/.test(document.querySelector("#toasts").textContent), null, { timeout: 8000 });
});
await step("gravar 2 s da tela de A gera arquivo", async () => {
  await B.p.hover(".tile:not([data-id=me])");
  await B.p.click(".tile:not([data-id=me]) .rec");
  await B.p.waitForTimeout(2200);
  const [dl] = await Promise.all([B.p.waitForEvent("download", { timeout: 10000 }), B.p.click(".tile:not([data-id=me]) .rec")]);
  const name = dl.suggestedFilename();
  if (!/^telinha-ana-\d{8}-\d{4}\.(mp4|webm)$/.test(name)) throw new Error("nome=" + name);
  const p = await dl.path(); const size = fs.statSync(p).size; if (size < 20000) throw new Error("tamanho=" + size);
  console.log("    arquivo:", name, size, "bytes");
});
// ---------------- v3 ----------------
const rv = ".tile:not([data-id=me])";
await step("lupa: roda do mouse dá zoom, arrastar move, Esc volta", async () => {
  const bb = await (await B.p.$(rv + " .frame")).boundingBox();
  await B.p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2);
  await B.p.mouse.wheel(0, -500);
  await B.p.waitForFunction(rv => /scale\(/.test(document.querySelector(rv + " video").style.transform), rv, { timeout: 3000 });
  if (!(await B.p.isVisible(rv + " .zchip"))) throw new Error("zchip invisível");
  const t0 = await B.p.$eval(rv + " video", v => v.style.transform);
  await B.p.mouse.down(); await B.p.mouse.move(bb.x + bb.width / 2 - 90, bb.y + bb.height / 2 - 40, { steps: 6 }); await B.p.mouse.up();
  const t1 = await B.p.$eval(rv + " video", v => v.style.transform);
  if (t0 === t1) throw new Error("arrastar não moveu: " + t1);
  if (await B.p.$("#grid.focus")) throw new Error("arrastar virou clique (foco)");
  await B.p.keyboard.press("Escape");
  await B.p.waitForFunction(rv => document.querySelector(rv + " video").style.transform === "", rv, { timeout: 3000 });
});
await step("modo cinema: T entra (sem dock, tela cheia), T sai", async () => {
  await B.p.keyboard.press("t");
  await B.p.waitForFunction(() => document.body.classList.contains("cinema") && getComputedStyle(document.querySelector(".dock")).display === "none" && getComputedStyle(document.querySelector("#side")).display === "none", null, { timeout: 3000 });
  await B.p.waitForFunction(() => document.fullscreenElement === document.body, null, { timeout: 3000 });
  await B.p.mouse.move(200, 200); await B.p.mouse.move(260, 240);
  await B.p.waitForFunction(() => document.body.classList.contains("ui") && getComputedStyle(document.querySelector("#cinebar")).display === "flex", null, { timeout: 3000 });
  await B.p.keyboard.press("t");
  await B.p.waitForFunction(() => !document.body.classList.contains("cinema") && !document.fullscreenElement, null, { timeout: 3000 });
});
await step("modo cinema: botão do tile entra e Esc sai", async () => {
  await B.p.hover(rv);
  await B.p.click(rv + " .cine");
  await B.p.waitForFunction(() => document.body.classList.contains("cinema"), null, { timeout: 3000 });
  await B.p.keyboard.press("Escape");
  await B.p.waitForFunction(() => !document.body.classList.contains("cinema"), null, { timeout: 3000 });
});
await step("atraso × fluidez: B escolhe +500 ms e o buffer muda", async () => {
  if (await B.p.evaluate(() => !jbOk)) throw new Error("navegador sem jitterBufferTarget");
  const read = () => B.p.evaluate(() => [...inc.values()].filter(x => x.kind === "screen").flatMap(x => x.c.peerConnection.getReceivers().map(r => r.jitterBufferTarget)));
  await B.p.evaluate(() => { const r = document.querySelector("#jb"); r.value = "500"; r.dispatchEvent(new Event("input")); });
  let v = await read(); if (!v.length || v.some(x => x !== 500)) throw new Error("500? " + JSON.stringify(v));
  if (!/\+500 ms/.test(await B.p.textContent("#jbv"))) throw new Error("rótulo");
  await B.p.evaluate(() => { const r = document.querySelector("#jb"); r.value = "0"; r.dispatchEvent(new Event("input")); });
  v = await read(); if (v.some(x => x)) throw new Error("0? " + JSON.stringify(v));
});
await step("imagem no chat: tamanho real lido de JPEG e WebP (VP8, VP8L, VP8X); PNG recusado", async () => {
  const r = await B.p.evaluate(async () => {
    const out = {};
    const mk = async (type, q, alpha) => { const c = document.createElement("canvas"); c.width = 123; c.height = 45; const g = c.getContext("2d"); if (!alpha) { g.fillStyle = "#3a6"; g.fillRect(0, 0, 123, 45) } else { g.fillStyle = "rgba(200,0,0,.5)"; g.fillRect(10, 10, 50, 20) } const b = await new Promise(r => c.toBlob(r, type, q)); const u = new Uint8Array(await b.arrayBuffer()); return { d: imgDims(u, b.type), f: b.type === "image/webp" ? String.fromCharCode(...u.slice(12, 16)) : b.type } };
    out.png = await mk("image/png"); out.jpg = await mk("image/jpeg", .8); out.webp = await mk("image/webp", .8); out.webpL = await mk("image/webp", 1); out.webpA = await mk("image/webp", .8, true);
    // o Chrome sempre gera VP8X; cabeçalhos VP8 e VP8L montados à mão (123×45)
    const riff = f => { const u = new Uint8Array(40); u.set([82, 73, 70, 70, 32, 0, 0, 0, 87, 69, 66, 80, ...[...f].map(c => c.charCodeAt(0))]); return u };
    const v8 = riff("VP8 "); v8.set([0x9d, 0x01, 0x2a, 123, 0, 45, 0], 23); out.vp8 = { d: imgDims(v8, "image/webp"), f: "VP8 " };
    const bits = (122 | 44 << 14) >>> 0, v8l = riff("VP8L"); v8l.set([0x2f, bits & 255, bits >> 8 & 255, bits >> 16 & 255, bits >>> 24], 20); out.vp8l = { d: imgDims(v8l, "image/webp"), f: "VP8L" };
    return out;
  });
  const fmts = Object.values(r).map(x => x.f).join(",");
  if (r.png.d !== null) throw new Error("PNG deveria ser recusado: " + JSON.stringify(r.png)); delete r.png;
  for (const [k, x] of Object.entries(r)) if (!x.d || x.d[0] !== 123 || x.d[1] !== 45) throw new Error(k + " " + JSON.stringify(x));
  console.log("    formatos:", fmts);
});
await step("imagem no chat: B manda um print e A e C recebem", async () => {
  const png = await B.p.screenshot();
  await B.p.setInputFiles("#file", { name: "print.png", mimeType: "image/png", buffer: png });
  await B.p.waitForFunction(() => { const i = document.querySelector("#msgs .mimg"); return i && !i.classList.contains("sending") && i.naturalWidth > 0 }, null, { timeout: 15000 });
  for (const x of [A, C]) await x.p.waitForFunction(() => [...document.querySelectorAll("#msgs .mimg")].some(i => i.naturalWidth > 0), null, { timeout: 20000 });
  const w = await A.p.$eval("#msgs .mimg", i => [i.naturalWidth, i.naturalHeight]);
  console.log("    imagem recebida:", w.join("×"), "de print", png.length, "bytes");
  await A.p.click("#msgs .mimg");
  await A.p.waitForSelector("#imgview[open]", { timeout: 3000 });
  await A.p.click("#imgx");
});
await step("imagem no chat: pedaços inválidos são ignorados", async () => {
  const n0 = await C.p.$$eval("#msgs .mimg", e => e.length);
  await B.p.evaluate(() => { toHub({ t: "img", iid: "zzzz", i: 0, n: 1, mime: "text/html", data: "PGgxPg==" }); toHub({ t: "img", iid: "BAD!", i: 0, n: 1, mime: "image/png", data: "AAAA" }); toHub({ t: "img", iid: "yyyy", i: 0, n: 1, mime: "image/png", data: "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" }); });
  await C.p.waitForTimeout(1500);
  if (await C.p.$$eval("#msgs .mimg", e => e.length) !== n0) throw new Error("C mostrou imagem inválida");
});
const vEnc = (x, id) => x.p.evaluate(id => out.get("screen:" + id)?.peerConnection?.getSenders().find(s => s.track?.kind === "video")?.getParameters().encodings[0], id);
await step("espectador com a aba escondida: A para de mandar vídeo só para ele", async () => {
  const bid = await B.p.evaluate(() => myId), cid = await C.p.evaluate(() => myId);
  await B.p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")) });
  await A.p.waitForFunction(id => out.get("screen:" + id)?.peerConnection?.getSenders().find(s => s.track?.kind === "video")?.getParameters().encodings[0].active === false, bid, { timeout: 10000 });
  if ((await vEnc(A, cid)).active !== true) throw new Error("C também foi cortado");
  await A.p.waitForFunction(() => /com a tela fechada/.test(document.querySelector("#upl").textContent), null, { timeout: 5000 });
  await B.p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")) });
  await A.p.waitForFunction(id => out.get("screen:" + id).peerConnection.getSenders().find(s => s.track?.kind === "video").getParameters().encodings[0].active === true, bid, { timeout: 10000 });
  await videoLive(B);
});
await step("gravando: a tela continua chegando inteira com a aba escondida", async () => {
  const bid = await B.p.evaluate(() => myId);
  await B.p.hover(rv); await B.p.click(rv + " .rec");
  await B.p.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); document.dispatchEvent(new Event("visibilitychange")) });
  await B.p.waitForTimeout(1500);
  const e = await vEnc(A, bid);
  await B.p.evaluate(() => { delete document.hidden; document.dispatchEvent(new Event("visibilitychange")) });
  await B.p.hover(rv);
  await Promise.all([B.p.waitForEvent("download", { timeout: 10000 }), B.p.click(rv + " .rec")]);
  if (e.active !== true || e.scaleResolutionDownBy !== 1) throw new Error("vídeo cortado durante a gravação: " + JSON.stringify(e));
});
await step("espectador vendo em miniatura recebe versão leve", async () => {
  const bid = await B.p.evaluate(() => myId), cid = await C.p.evaluate(() => myId);
  await C.p.click("#share");
  await B.p.waitForFunction(() => document.querySelectorAll(".tile:not([data-id=me])").length === 2, null, { timeout: 20000 });
  await B.p.click(`.tile[data-id="${cid}"] .frame`, { position: { x: 30, y: 60 } });
  await B.p.waitForSelector(`#grid.focus .tile.big[data-id="${cid}"]`, { timeout: 3000 });
  await A.p.waitForFunction(id => out.get("screen:" + id).peerConnection.getSenders().find(s => s.track?.kind === "video").getParameters().encodings[0].scaleResolutionDownBy > 1, bid, { timeout: 10000 });
  const e = await vEnc(A, bid);
  console.log("    miniatura:", "escala", e.scaleResolutionDownBy, "·", e.maxFramerate, "fps ·", e.maxBitrate / 1000, "kbps");
  await A.p.waitForFunction(() => /em miniatura/.test(document.querySelector("#upl").textContent), null, { timeout: 5000 });
  await C.p.click("#share");
  await B.p.waitForFunction(() => document.querySelectorAll(".tile:not([data-id=me])").length === 1, null, { timeout: 20000 });
  await A.p.waitForFunction(id => out.get("screen:" + id).peerConnection.getSenders().find(s => s.track?.kind === "video").getParameters().encodings[0].scaleResolutionDownBy === 1, bid, { timeout: 10000 });
});
await step("qualidade automática: desce depois de 6 s no limite e sobe quando melhora", async () => {
  const r = await A.p.evaluate(() => {
    const was = set.auto; set.auto = true; autoLvl = 0; limSec = okSec = 0; upNeed = 30; autoCool = 0;
    const base = PRESETS[set.q], log = [];
    for (let i = 0; i < 5; i++) autoStep(new Set(["cpu"]), 1);
    log.push(autoLvl);
    autoStep(new Set(["cpu"]), 1);
    log.push(autoLvl, capPreset()[2], Math.round(capPreset()[3] / base[3] * 100), document.querySelector("#share").textContent.includes("auto"), document.querySelector("#toasts").textContent.includes("Processador no limite"));
    autoStep(new Set(["cpu"]), 1); log.push(autoLvl); // em espera de 10 s: não desce de novo
    autoCool = 0; for (let i = 0; i < 59; i++) autoStep(new Set(), 1); log.push(autoLvl);
    autoStep(new Set(), 1); log.push(autoLvl, document.querySelector("#toasts").textContent.includes("Melhorou"));
    set.auto = was; autoLvl = 0; applyQuality(); renderDock();
    return log;
  });
  const want = [0, 1, 30, 70, true, true, 1, 1, 0, true];
  if (JSON.stringify(r) !== JSON.stringify(want)) throw new Error(JSON.stringify(r));
  await videoLive(B);
});
await step("apertar para falar: só transmite segurando V", async () => {
  const speaking = () => A.p.evaluate(() => [...document.querySelectorAll("#people .person.speaking")].some(r => r.textContent.includes("Bruno")));
  await B.p.evaluate(() => document.querySelector("#micmodes input[value=ptt]").click());
  await B.p.click("#mic");
  await B.p.waitForSelector("#ptt:not([hidden])", { timeout: 5000 });
  await A.p.waitForFunction(() => [...document.querySelectorAll("#people .person")].some(r => r.textContent.includes("Bruno") && r.querySelectorAll(".pi .i").length >= 1), null, { timeout: 15000 });
  await A.p.waitForTimeout(2500);
  if (await speaking()) throw new Error("falou sem apertar");
  await B.p.keyboard.down("v");
  await A.p.waitForFunction(() => [...document.querySelectorAll("#people .person.speaking")].some(r => r.textContent.includes("Bruno")), null, { timeout: 10000 });
  if (!(await B.p.evaluate(() => document.querySelector("#ptt").classList.contains("on")))) throw new Error("botão Falar não acendeu");
  await B.p.keyboard.up("v");
  await A.p.waitForFunction(() => ![...document.querySelectorAll("#people .person.speaking")].some(r => r.textContent.includes("Bruno")), null, { timeout: 10000 });
  const bb = await (await B.p.$("#ptt")).boundingBox();
  await B.p.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await B.p.mouse.down();
  if (!(await B.p.evaluate(() => pttHeld))) throw new Error("segurar o botão não liga");
  await B.p.mouse.up();
  if (await B.p.evaluate(() => pttHeld)) throw new Error("soltar o botão não desliga");
});
await step("microfone por voz: o portão corta o chiado e reabre com a sensibilidade", async () => {
  await B.p.evaluate(() => { document.querySelector("#micmodes input[value=voice]").click(); const g = document.querySelector("#gate"); g.value = "-20"; g.dispatchEvent(new Event("input")) });
  // o processador do portão, renderizado offline: 0,5 s de voz alta e depois um chiado de -63 dB (limite padrão -55)
  const r = await B.p.evaluate(async () => {
    const oc = new OfflineAudioContext(1, 96000, 48000), url = URL.createObjectURL(new Blob([GATE_SRC], { type: "text/javascript" }));
    await oc.audioWorklet.addModule(url);
    const o = oc.createOscillator(), g = oc.createGain(), n = new AudioWorkletNode(oc, "tl-gate", { outputChannelCount: [1] });
    g.gain.setValueAtTime(.5, 0); g.gain.setValueAtTime(.001, .5); o.connect(g); g.connect(n); n.connect(oc.destination); o.start();
    const d = (await oc.startRendering()).getChannelData(0), rms = (a, b) => { a = Math.round(a * 48000); b = Math.round(b * 48000); let s = 0; for (let i = a; i < b; i++) s += d[i] * d[i]; return Math.sqrt(s / (b - a)) };
    return [rms(.1, .45), rms(.55, .8), rms(1.3, 2)];
  });
  console.log("    portão (rms): voz", r[0].toFixed(3), "· logo depois (segura)", r[1].toExponential(1), "· chiado", r[2].toExponential(1));
  if (!(r[0] > .3 && r[1] > 3e-4 && r[2] < 1e-5)) throw new Error("portão: " + r.join(" "));
  await B.p.evaluate(() => { const g = document.querySelector("#gate"); g.value = "-70"; g.dispatchEvent(new Event("input")) });
  await B.p.waitForFunction(() => gate.open, null, { timeout: 5000 });
  await B.p.evaluate(() => { const g = document.querySelector("#gate"); g.value = "-55"; g.dispatchEvent(new Event("input")) });
  await B.p.click("#mic");
});
await step("celular (390 px): sem rolagem lateral e cinema funciona", async () => {
  await B.p.setViewportSize({ width: 390, height: 844 });
  await B.p.waitForTimeout(400);
  const sw = await B.p.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 390) throw new Error("rolagem lateral: " + sw);
  await B.p.keyboard.press("t");
  await B.p.waitForFunction(() => document.body.classList.contains("cinema"), null, { timeout: 3000 });
  await B.p.keyboard.press("t");
  await B.p.setViewportSize({ width: 1280, height: 800 });
  await B.p.waitForTimeout(300);
});

await step("hub recusa conexão binária (BinaryPack) de estranhos", async () => {
  const id = await B.p.evaluate(() => new Promise(res => { const p = new Peer(); p.on("open", () => { window.__atk = p.connect(HUB, { serialization: "binary" }); res(p.id) }) }));
  await A.p.waitForTimeout(4000);
  if (await A.p.evaluate(id => members.has(id), id)) throw new Error("hub aceitou conexão binária");
  await B.p.evaluate(() => window.__atk?.provider?.destroy?.());
});
await step("tela cheia na tela de quem para de transmitir não quebra avisos", async () => {
  await B.p.dblclick(".tile:not([data-id=me]) video");
  await B.p.waitForFunction(() => !!document.fullscreenElement, null, { timeout: 5000 });
  await A.p.click("#share");
  await B.p.waitForFunction(() => !document.querySelector(".tile:not([data-id=me])") && !document.fullscreenElement, null, { timeout: 15000 });
  const ok = await B.p.evaluate(() => document.getElementById("fx")?.isConnected && document.getElementById("toasts")?.isConnected);
  if (!ok) throw new Error("#fx/#toasts sumiram");
  await C.p.keyboard.press("1");
  await B.p.waitForSelector("#fx .rx", { timeout: 8000 });
});
await step("A (hub) sai: B e C reorganizam a sala", async () => {
  await A.ctx.close();
  await count(B, 2, 40000); await count(C, 2, 40000);
  try { await B.p.waitForFunction(() => !document.querySelector(".tile"), null, { timeout: 25000 }); }
  catch (e) { console.log("    estado de B:", JSON.stringify(await B.p.evaluate(() => ({ tiles: [...tiles.entries()].map(([k, t]) => k.slice(0, 6) + ":" + t.dataset.state), inc: [...inc.entries()].map(([k, x]) => k.slice(0, 13) + " open=" + x.c.open + " pc=" + x.c.peerConnection?.connectionState + " tracks=" + x.s?.getTracks().map(t => t.kind + ":" + t.readyState + ":" + t.muted).join(",")), roster: roster.map(r => r.id.slice(0, 6) + "=" + r.name + (r.sharing ? "*" : "")), missing: [...missing.keys()], me: me.id.slice(0, 6) })))); throw e; }
});
await step("chat funciona depois da troca de hub", async () => {
  await C.p.fill("#ci", "depois da queda");
  await C.p.press("#ci", "Enter");
  await B.p.waitForFunction(() => document.querySelector("#msgs").textContent.includes("depois da queda"), null, { timeout: 15000 });
});
await step("nova pessoa entra na sala reorganizada", async () => {
  const E = await person("Eva");
  await count(E, 3, 40000); await count(B, 3);
  await E.ctx.close();
});

console.log(errors.length ? "\nERROS DE PÁGINA:\n" + [...new Set(errors)].join("\n") : "\nsem erros de página");
console.log(fails ? `\n${fails} FALHA(S)` : "\nTUDO OK");
await browser.close(); srv.close();
process.exit(fails || errors.length ? 1 : 0);
