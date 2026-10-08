// Teste da tela de salas do Telinha: lista, criar com e sem senha, senha errada/certa, convite por link, intruso que
// tenta pular a senha, sair e voltar para a lista, queda de quem hospeda numa sala com senha, nome repetido e apagar a sala
// (só quem criou consegue: hub forjando "apagada" e segredo falso não funcionam).
// Usa a sinalização PeerJS de verdade (precisa de internet). Uso: npm i playwright-core   e   node teste-salas.mjs index.html
import { chromium } from "playwright-core";
import http from "node:http";
import fs from "node:fs";

const file = process.argv[2], shots = process.argv[3] || "";
const srv = http.createServer((q, r) => { r.writeHead(200, { "content-type": "text/html; charset=utf-8" }); r.end(fs.readFileSync(file)); }).listen(0);
const base = `http://localhost:${srv.address().port}/`;
const tag = Math.random().toString(36).slice(2, 7);
const R = "trancada-" + tag, OPEN = "aberta-" + tag, PW = "pipoca42";
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
const fakeDisplay = () => {
  navigator.mediaDevices.getDisplayMedia = async () => {
    const c = document.createElement("canvas"); c.width = 640; c.height = 360;
    const g = c.getContext("2d"); let f = 0;
    setInterval(() => { f++; g.fillStyle = `hsl(${f % 360} 60% 40%)`; g.fillRect(0, 0, 640, 360); }, 50);
    const s = c.captureStream(20);
    const ac = new AudioContext(), o = ac.createOscillator(), d = ac.createMediaStreamDestination(); o.connect(d); o.start();
    s.addTrack(d.stream.getAudioTracks()[0]);
    return s;
  };
};
// Abre o Telinha, digita o nome e aperta o botão principal (sem # vai para a lista de salas; com # vai para o convite)
async function visit(name, hash = "", viewport = { width: 1280, height: 800 }) {
  const ctx = await browser.newContext({ viewport });
  await ctx.addInitScript(fakeDisplay);
  const p = await ctx.newPage();
  p.on("pageerror", e => errors.push(`${name}: ${e.message}`));
  p.on("console", m => { if (m.type() === "error" && !/favicon|fonts\.g/.test(m.text())) errors.push(`${name} console: ${m.text()}`); });
  await p.goto(base + (hash ? "#" + hash : ""));
  await p.fill("#ln", name);
  await p.click("#go");
  return { name, ctx, p };
}
const inRoom = (x, n, timeout = 30000) => x.p.waitForFunction(n => !document.querySelector("#app").hidden && document.querySelector("#cnt").dataset.s === "ok" && document.querySelector("#cnt").textContent.trim().startsWith(n + " "), n, { timeout });
const listed = (x, room, timeout = 25000) => x.p.waitForFunction(r => [...document.querySelectorAll("#rlist .rrow b")].some(b => b.textContent === r), room, { timeout });
const rowText = (x, room) => x.p.evaluate(r => [...document.querySelectorAll("#rlist .rrow")].find(li => li.querySelector("b").textContent === r)?.textContent || "", room);
const enterFromList = (x, room) => x.p.click(`#rlist .rrow:has(b:text-is("${room}")) button`);
const shot = async (x, n) => { if (shots) { fs.mkdirSync(shots, { recursive: true }); await x.p.waitForTimeout(400); await x.p.screenshot({ path: `${shots}/${n}.png` }); } };

console.log("salas:", R, OPEN);
const A = await visit("Ana");
await step("depois do nome aparece a tela de salas (e não entra em sala nenhuma)", async () => {
  await A.p.waitForSelector("#rooms:not([hidden])", { timeout: 5000 });
  if (!(await A.p.isHidden("#app"))) throw new Error("entrou numa sala");
  await A.p.waitForFunction(() => /Nenhuma sala|aberta/.test(document.querySelector("#rstat").textContent), null, { timeout: 25000 });
  if (await A.p.evaluate(() => location.hash)) throw new Error("hash inesperado");
});
await shot(A, "01-salas-vazio");
await step("Ana cria uma sala com senha e entra", async () => {
  await A.p.click("#newbtn");
  await A.p.fill("#nrname", R);
  await A.p.check("#nrlock");
  await A.p.fill("#nrpw", PW);
  await shot(A, "02-criar-com-senha");
  await A.p.click("#nrgo");
  await inRoom(A, 1);
  if ((await A.p.evaluate(() => location.hash)) !== "#" + R) throw new Error("hash da sala");
});
const B = await visit("Bruno");
await step("Bruno vê a sala na lista, com cadeado e 1 pessoa", async () => {
  await listed(B, R);
  const t = await rowText(B, R);
  if (!/1 pessoa/.test(t) || !/com senha/.test(t)) throw new Error(t);
  if (!(await B.p.$(`#rlist .rrow:has(b:text-is("${R}")) .i`))) throw new Error("sem ícone de cadeado");
});
await shot(B, "03-lista-com-sala");
await step("senha errada é recusada, senha certa entra", async () => {
  await enterFromList(B, R);
  await B.p.waitForSelector("#pwdlg[open]", { timeout: 15000 });
  await B.p.fill("#pwin", "errada1");
  await B.p.click("#pwok");
  await B.p.waitForFunction(() => /incorreta/.test(document.querySelector("#pwerr").textContent) && !document.querySelector("#pwerr").hidden, null, { timeout: 15000 });
  await shot(B, "04-senha-errada");
  if (!(await B.p.isHidden("#app"))) throw new Error("entrou com senha errada");
  await B.p.fill("#pwin", PW);
  await B.p.click("#pwok");
  await inRoom(B, 2);
  await inRoom(A, 2);
});
const C = await visit("Caio", R);
await step("convite por link pede a senha; cancelar não entra; com a senha entra", async () => {
  await C.p.waitForSelector("#pwdlg[open]", { timeout: 20000 });
  await C.p.click("#pwno");
  await C.p.waitForTimeout(500);
  if (!(await C.p.isHidden("#app"))) throw new Error("entrou sem senha");
  await C.p.click("#go");
  await C.p.waitForSelector("#pwdlg[open]", { timeout: 20000 });
  await C.p.fill("#pwin", PW);
  await C.p.press("#pwin", "Enter");
  await inRoom(C, 3);
});
const D = await visit("Davi");
await step("intruso falando direto com o hub, sem senha, não recebe nada nem entra", async () => {
  await listed(D, R);
  const got = await D.p.evaluate(room => new Promise(res => {
    const c = lobbyPeer.connect("telinha-" + room, { reliable: true, serialization: "json" }), got = [];
    c.on("open", () => {
      c.send({ t: "me", name: "intruso", sharing: false, mic: false, paused: [] });
      c.send({ t: "chat", text: "entrei sem senha" });
      c.send({ t: "auth", cn: "0123456789abcdef0123" });
      setTimeout(() => c.send({ t: "proof", p: "00".repeat(32) }), 600);
    });
    c.on("data", d => got.push(d && d.t));
    setTimeout(() => res(got), 3000);
  }), R);
  if (JSON.stringify(got) !== JSON.stringify(["chal", "denied"])) throw new Error("recebeu: " + JSON.stringify(got));
  await A.p.waitForTimeout(500);
  if (await B.p.evaluate(() => /entrei sem senha/.test(document.querySelector("#msgs").textContent))) throw new Error("chat do intruso apareceu");
  if (await A.p.evaluate(() => roster.some(r => r.name === "intruso"))) throw new Error("intruso na lista");
  await inRoom(A, 3);
});
await step("sala sem senha: Davi cria; Bruno sai, volta para a lista e entra nela direto", async () => {
  await D.p.click("#newbtn");
  await D.p.fill("#nrname", OPEN);
  await D.p.click("#nrgo");
  await inRoom(D, 1);
  // Bruno sai: volta direto para a lista (sem pedir o nome de novo)
  await B.p.click("#leave");
  await B.p.waitForSelector("#rooms:not([hidden])", { timeout: 15000 });
  if (await B.p.evaluate(() => location.hash)) throw new Error("hash ficou");
  await listed(B, OPEN);
  const t = await rowText(B, OPEN);
  if (/com senha/.test(t)) throw new Error("aberta aparece com senha: " + t);
  await enterFromList(B, OPEN);
  await inRoom(B, 2);
  if (await B.p.isVisible("#pwdlg")) throw new Error("pediu senha numa sala aberta");
  await inRoom(A, 2); // Bruno saiu da sala trancada
});
const E = await visit("Elisa");
await step("lista mostra as duas salas, com quantas pessoas e quem está ao vivo", async () => {
  await D.p.click("#share");
  await listed(E, R); await listed(E, OPEN);
  await E.p.waitForFunction(r => [...document.querySelectorAll("#rlist .rrow")].some(li => li.querySelector("b").textContent === r && /2 pessoas/.test(li.textContent) && /ao vivo/.test(li.textContent)), OPEN, { timeout: 20000 });
  if (!/2 pessoas/.test(await rowText(E, R))) throw new Error(await rowText(E, R));
});
await shot(E, "05-lista-duas-salas");
await step("nome repetido: não deixa criar outra sala com o mesmo nome", async () => {
  await E.p.click("#newbtn");
  await E.p.fill("#nrname", R);
  await E.p.click("#nrgo");
  await E.p.waitForFunction(() => /Já existe/.test(document.querySelector("#nrerr").textContent), null, { timeout: 20000 });
  if (!(await E.p.isHidden("#app"))) throw new Error("entrou");
});
await step("quem hospeda a sala trancada sai: a sala continua, com senha, e volta para a lista", async () => {
  await A.ctx.close(); // Ana segurava o hub (e o diretório)
  await inRoom(C, 1, 40000);
  await E.p.waitForFunction(r => [...document.querySelectorAll("#rlist .rrow")].some(li => li.querySelector("b").textContent === r && /1 pessoa/.test(li.textContent)), R, { timeout: 45000 });
  // senha errada continua barrada no hub novo
  await enterFromList(E, R);
  await E.p.waitForSelector("#pwdlg[open]", { timeout: 15000 });
  await E.p.fill("#pwin", "outra-senha");
  await E.p.click("#pwok");
  await E.p.waitForFunction(() => /incorreta/.test(document.querySelector("#pwerr").textContent), null, { timeout: 15000 });
  await E.p.fill("#pwin", PW);
  await E.p.click("#pwok");
  await inRoom(E, 2);
  await inRoom(C, 2);
});
await step("chat funciona na sala trancada depois da troca de hub", async () => {
  await E.p.fill("#ci", "cheguei");
  await E.p.press("#ci", "Enter");
  await C.p.waitForFunction(() => /cheguei/.test(document.querySelector("#msgs").textContent), null, { timeout: 10000 });
});
// ---- apagar a sala (quem criou) ----
const ownerTag = (x, who) => x.p.waitForFunction(w => [...document.querySelectorAll("#people .person")].some(r => r.textContent.includes(w) && /criou a sala/.test(r.textContent)), who, { timeout: 15000 });
await step("lista de pessoas mostra quem criou a sala (para todos e para quem criou)", async () => {
  await ownerTag(B, "Davi");
  await ownerTag(D, "você");
});
await step("quem não criou a sala sai direto, sem a pergunta", async () => {
  if (await C.p.evaluate(() => roomOwner === myId)) throw new Error("Caio virou dono");
});
await step("quem criou escolhe 'Só sair': a sala continua para os outros", async () => {
  await D.p.click("#leave");
  await D.p.waitForSelector("#leavedlg[open]", { timeout: 5000 });
  await shot(D, "07-sair-ou-apagar");
  await D.p.click("#lvkeep");
  await D.p.waitForSelector("#rooms:not([hidden])", { timeout: 15000 });
  await inRoom(B, 1, 40000);
  await listed(D, OPEN, 30000);
});
await step("quem criou volta para a sala e continua sendo quem pode apagá-la", async () => {
  await enterFromList(D, OPEN);
  await inRoom(D, 2);
  await ownerTag(B, "Davi");
});
await step("ninguém além de quem criou consegue apagar (hub forjando 'apagada', membro com segredo falso)", async () => {
  // Bruno segura o hub desta sala (assumiu quando Davi saiu) mas não a criou
  if (!(await B.p.evaluate(() => !!hubPeer))) throw new Error("Bruno não é o hub (cenário do teste mudou)");
  await B.p.evaluate(() => { hubAll({ t: "ended", by: "Davi", e: "ab".repeat(32) }); toHub({ t: "end", e: "cd".repeat(32) }); });
  await D.p.evaluate(() => toHub({ t: "end", e: "ef".repeat(32) })); // até o dono, com o segredo errado
  await D.p.waitForTimeout(3000);
  if (await D.p.evaluate(() => leaving) || await D.p.isHidden("#app")) throw new Error("Davi saiu com um 'apagada' forjado");
  if (await B.p.evaluate(() => leaving || hubEnded)) throw new Error("a sala foi apagada com segredo falso");
  await inRoom(D, 2); await inRoom(B, 2);
});
let F = null;
await step("quem criou apaga: todos voltam para a lista com aviso, a sala some e um convite logo depois não a reabre", async () => {
  await D.p.click("#leave");
  await D.p.waitForSelector("#leavedlg[open]", { timeout: 5000 });
  await D.p.click("#lvdel");
  F = await visit("Fabio", OPEN); // convite aberto logo depois de apagar
  await F.p.waitForFunction(() => /apagada/.test(document.querySelector("#lerr").textContent) && !document.querySelector("#lerr").hidden, null, { timeout: 15000 });
  if (!(await F.p.isHidden("#app"))) throw new Error("o convite reabriu a sala apagada");
  await B.p.waitForSelector("#rooms:not([hidden])", { timeout: 20000 });
  await B.p.waitForFunction(() => /foi apagada por Davi/.test(document.querySelector("#rstat").textContent), null, { timeout: 10000 });
  await shot(B, "08-sala-apagada");
  await D.p.waitForSelector("#rooms:not([hidden])", { timeout: 20000 });
  await D.p.waitForFunction(() => /Você apagou/.test(document.querySelector("#rstat").textContent), null, { timeout: 10000 });
  await D.p.waitForFunction(r => ![...document.querySelectorAll("#rlist .rrow b")].some(b => b.textContent === r), OPEN, { timeout: 25000 });
  if (await D.p.evaluate(r => !!JSON.parse(localStorage.getItem("tl2-own") || "{}")[r], OPEN)) throw new Error("chave de dono ficou guardada");
});

await step("depois de apagada, uma sala nova com o mesmo nome pode ser criada e aparece na lista", async () => {
  await B.p.waitForTimeout(9500); // fim da janela em que o hub antigo ainda responde "apagada"
  await B.p.click("#newbtn");
  await B.p.fill("#nrname", OPEN);
  await B.p.click("#nrgo");
  await inRoom(B, 1, 30000);
  await listed(D, OPEN, 30000);
});
await step("quem criou e está sozinho: Sair pergunta e só oferece fechar a sala", async () => {
  await B.p.click("#leave");
  await B.p.waitForSelector("#leavedlg[open]", { timeout: 5000 });
  if (await B.p.isVisible("#lvkeep")) throw new Error("ofereceu 'Só sair' estando sozinho");
  if (!/Sair e fechar a sala/.test(await B.p.textContent("#lvdel"))) throw new Error("botão: " + await B.p.textContent("#lvdel"));
  if (!/sozinho/.test(await B.p.textContent("#lvd"))) throw new Error("texto não explica");
  await shot(B, "09-sozinho-fechar");
  await B.p.click("#lvdel");
  await B.p.waitForSelector("#rooms:not([hidden])", { timeout: 15000 });
});

const M = await visit("Mari", "", { width: 360, height: 760 });
await step("celular (360 px): tela de salas sem rolagem lateral", async () => {
  await listed(M, R);
  const sw = await M.p.evaluate(() => document.documentElement.scrollWidth);
  if (sw > 360) throw new Error("rolagem lateral: " + sw);
  await M.p.click("#newbtn");
  await M.p.check("#nrlock");
  const sw2 = await M.p.evaluate(() => document.documentElement.scrollWidth);
  if (sw2 > 360) throw new Error("rolagem lateral com o formulário: " + sw2);
});
await shot(M, "06-celular");

console.log(errors.length ? "\nERROS DE PÁGINA:\n" + errors.join("\n") : "\nsem erros de página");
console.log(fails ? `\n${fails} FALHA(S)` : "\nTUDO OK");
await browser.close(); srv.close();
process.exit(fails ? 1 : 0);
