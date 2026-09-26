// Eşek Game Node.js sunucusu
// server.js dosyasına çift tıklayarak başlatabilirsin.
const {execSync}=require("child_process");
try{require.resolve("ws")}catch{console.log("Gerekli paket kuruluyor...");execSync("npm install ws",{stdio:"inherit"})}
const http=require("http"),WebSocket=require("ws"),fs=require("fs"),path=require("path");
const players=new Map();
const mime={".html":"text/html; charset=utf-8",".js":"text/javascript; charset=utf-8",".css":"text/css; charset=utf-8"};
const server=http.createServer((req,res)=>{let u=decodeURIComponent(req.url.split("?")[0]);if(u==="/")u="/EsekGame.html";const f=path.join(__dirname,u);
if(!f.startsWith(__dirname)){res.writeHead(403);return res.end("Forbidden")}fs.readFile(f,(e,d)=>{if(e){res.writeHead(404);return res.end("Bulunamadı")}res.writeHead(200,{"Content-Type":mime[path.extname(f)]||"application/octet-stream"});res.end(d)})});
const wss=new WebSocket.Server({server});
function broadcast(){const msg=JSON.stringify({type:"players",players:Object.fromEntries(players)});for(const c of wss.clients)if(c.readyState===WebSocket.OPEN)c.send(JSON.stringify({...JSON.parse(msg),me:c.esekId}))}
wss.on("connection",s=>{const id=Math.random().toString(36).slice(2,9);s.esekId=id;players.set(id,{x:0,z:0});broadcast();
s.on("message",raw=>{try{const d=JSON.parse(raw);if(d.type==="move"){const p=players.get(id);p.x=Math.max(-14,Math.min(14,Number(d.x)||0));p.z=Math.max(-14,Math.min(14,Number(d.z)||0));broadcast()}}catch{}});
s.on("close",()=>{players.delete(id);broadcast()})});
const PORT = Number(process.env.PORT) || 8080;
server.listen(PORT, "0.0.0.0", () => { console.log(`EŞEK GAME ONLINE SUNUCUSU - port ${PORT}`); });