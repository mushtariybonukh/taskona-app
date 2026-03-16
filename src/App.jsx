import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ukrfnapkypperwvmgiie.supabase.co";
const SUPABASE_KEY = "sb_publishable_PSjKF-xddCU--82YhO4gIQ_BaH3ilc-";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ── GET USER ID ──────────────────────────────────────────────────────────────
function getUserId() {
  try {
    const tg = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tg?.id) return String(tg.id);
  } catch {}
  let uid = localStorage.getItem("taskona_uid");
  if (!uid) { uid = "user_" + Math.random().toString(36).slice(2); localStorage.setItem("taskona_uid", uid); }
  return uid;
}

// ── DETECT MOBILE ────────────────────────────────────────────────────────────
const isMobile = () => window.innerWidth < 768 || !!window.Telegram?.WebApp?.initData;

// ── HELPERS ──────────────────────────────────────────────────────────────────
const TODAY = () => new Date().toISOString().split("T")[0];
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().split("T")[0]; }
function daysDiff(d) { return Math.ceil((new Date(d) - new Date(TODAY())) / 86400000); }
function fmtDate(d) { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }
function fmtShort(d) { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { month:"short", day:"numeric" }); }

const PLATFORMS = ["Instagram","TikTok","YouTube","LinkedIn","Telegram","Facebook"];
const CTYPES = ["Graphic","Video","Carousel","Reel","Story","Text post"];
const STATUSES = { scheduled:"Scheduled", in_progress:"In Progress", posted:"Posted ✓", missed:"Missed" };
const ROLE_COLORS = { Designer:["#9d3eff22","#bb77ff"], Editor:["#3e9dff22","#77bbff"], PM:["#3eff9d22","#77ffbb"], Client:["#ff9d3e22","#ffbb77"] };
const DEFAULT_BUFFERS = { Graphic:2, Video:5, Carousel:2, Reel:5, Story:1, "Text post":1 };

function urgency(task) {
  const d = daysDiff(task.due_date);
  if (task.status==="missed"||(d<0&&task.status!=="posted")) return "burning";
  if (d===0) return "today";
  if (d<=2) return "urgent";
  return "normal";
}

// ── PARSE CSV ────────────────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = text.trim().split("\n").filter(l => l.trim());
  if (lines.length < 2) return [];
  const headers = lines[0].split(",").map(h => h.trim().toLowerCase().replace(/"/g,""));
  return lines.slice(1).map(line => {
    const vals = line.split(",").map(v => v.trim().replace(/"/g,""));
    const obj = {};
    headers.forEach((h, i) => { obj[h] = vals[i] || ""; });
    return obj;
  }).filter(r => r.title && r.date);
}

export default function Taskona() {
  const [posts, setPosts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [buffers, setBuffers] = useState(DEFAULT_BUFFERS);
  const [view, setView] = useState("dash");
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [importLoading, setImportLoading] = useState(false);
  const [importProgress, setImportProgress] = useState("");
  const [toast, setToast] = useState(null);
  const [mobile, setMobile] = useState(isMobile());
  const [userId] = useState(() => getUserId());
  const [form, setForm] = useState({ title:"", contentType:"Graphic", platform:"Instagram", pubDate:addDays(TODAY(),7), client:"", description:"" });
  const [analytics, setAnalytics] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [editBuffers, setEditBuffers] = useState(DEFAULT_BUFFERS);

  useEffect(() => {
    loadData();
    const handleResize = () => setMobile(isMobile());
    window.addEventListener("resize", handleResize);
    return () => window.removeEventListener("resize", handleResize);
  }, []);

  const loadData = async () => {
    const { data: p } = await supabase.from("posts").select("*").eq("user_id", userId).order("pub_date");
    const { data: t } = await supabase.from("tasks").select("*").eq("user_id", userId).order("due_date");
    const { data: b } = await supabase.from("buffers").select("*").eq("id", 1).single();
    if (p) setPosts(p);
    if (t) setTasks(t);
    if (b?.settings) { setBuffers(b.settings); setEditBuffers(b.settings); }
  };

  const notify = (msg, err) => { setToast({msg,err}); setTimeout(()=>setToast(null),4000); };
  const getBuffer = (ct) => buffers[ct] ?? DEFAULT_BUFFERS[ct] ?? 1;

  const saveBuffers = async () => {
    const cleaned = {};
    Object.entries(editBuffers).forEach(([k,v]) => { cleaned[k] = Math.max(1, Math.min(30, parseInt(v)||1)); });
    await supabase.from("buffers").upsert({ id:1, settings:cleaned });
    setBuffers(cleaned); setEditBuffers(cleaned);
    setShowSettings(false); notify("Saved ✓");
  };

  // ── GENERATE TASKS VIA AI ─────────────────────────────────────────────────
  const generateTasks = async (post, postId, buf) => {
    const prepDate = addDays(post.pubDate || post.pub_date, -buf);
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:600,
          messages:[{ role:"user", content:`Content task planner for Taskona.ai.
Post: "${post.title}" | Type: ${post.contentType||post.content_type} | Platform: ${post.platform} | Pub: ${post.pubDate||post.pub_date} | Client: ${post.client||"N/A"}
Buffer: ${buf} days. Prep by: ${prepDate}. Today: ${TODAY()}.
Generate 4 tasks between today and pub date. Roles: Designer/Editor/PM/Client.
ONLY JSON array: [{"title":"...","role":"PM","dueDate":"YYYY-MM-DD"}]` }]
        })
      });
      const data = await res.json();
      const parsed = JSON.parse(data.content[0].text.trim());
      return parsed.map((t,i) => ({
        id:`${postId}_${i}`, post_id:postId, post_title:post.title,
        platform:post.platform, content_type:post.contentType||post.content_type,
        title:t.title, role:t.role, due_date:t.dueDate,
        pub_date:post.pubDate||post.pub_date, status:"scheduled", user_id:userId
      }));
    } catch {
      return [
        { id:`${postId}_0`, post_id:postId, post_title:post.title, platform:post.platform, content_type:post.contentType||post.content_type, title:"Creative brief", role:"PM", due_date:addDays(post.pubDate||post.pub_date,-buf-1), pub_date:post.pubDate||post.pub_date, status:"scheduled", user_id:userId },
        { id:`${postId}_1`, post_id:postId, post_title:post.title, platform:post.platform, content_type:post.contentType||post.content_type, title:`Prepare ${(post.contentType||post.content_type||"").toLowerCase()}`, role:"Designer", due_date:prepDate, pub_date:post.pubDate||post.pub_date, status:"scheduled", user_id:userId },
        { id:`${postId}_2`, post_id:postId, post_title:post.title, platform:post.platform, content_type:post.contentType||post.content_type, title:"Review & approve", role:"Client", due_date:addDays(post.pubDate||post.pub_date,-1), pub_date:post.pubDate||post.pub_date, status:"scheduled", user_id:userId },
        { id:`${postId}_3`, post_id:postId, post_title:post.title, platform:post.platform, content_type:post.contentType||post.content_type, title:"Publish post", role:"PM", due_date:post.pubDate||post.pub_date, pub_date:post.pubDate||post.pub_date, status:"scheduled", user_id:userId },
      ];
    }
  };

  // ── ADD SINGLE POST ───────────────────────────────────────────────────────
  const addPost = async () => {
    if (!form.title||!form.pubDate) return notify("Title and date required", true);
    setLoading(true);
    const buf = getBuffer(form.contentType);
    const postId = Date.now().toString();
    const newPost = { id:postId, title:form.title, content_type:form.contentType, platform:form.platform, pub_date:form.pubDate, client:form.client, description:form.description, created_at:TODAY(), analytics:null, user_id:userId };
    const newTasks = await generateTasks(form, postId, buf);
    await supabase.from("posts").insert(newPost);
    await supabase.from("tasks").insert(newTasks);
    setPosts(p => [...p, newPost]);
    setTasks(t => [...t, ...newTasks]);
    notify(`✓ ${newTasks.length} tasks generated`);
    setForm({ title:"", contentType:"Graphic", platform:"Instagram", pubDate:addDays(TODAY(),7), client:"", description:"" });
    setView("dash"); setLoading(false);
  };

  // ── IMPORT FROM FILE ──────────────────────────────────────────────────────
  const importFromFile = async (e) => {
    const file = e.target.files[0];
    if (!file) return;
    setImportLoading(true);
    setImportProgress("Reading file...");
    try {
      const text = await file.text();
      const rows = parseCSV(text);
      if (rows.length === 0) { notify("No valid rows found. Check format: Title, Type, Platform, Date, Client", true); setImportLoading(false); return; }
      notify(`Found ${rows.length} posts — generating tasks...`);
      const allPosts = [], allTasks = [];
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        setImportProgress(`Processing ${i+1} of ${rows.length}: ${row.title}`);
        const postId = `${Date.now()}_${i}`;
        const buf = getBuffer(row.type || "Graphic");
        const newPost = {
          id: postId, title: row.title,
          content_type: row.type || "Graphic",
          platform: row.platform || "Instagram",
          pub_date: row.date, client: row.client || "",
          description: row.description || "",
          created_at: TODAY(), analytics: null, user_id: userId
        };
        const newTasks = await generateTasks({ title:row.title, contentType:row.type||"Graphic", platform:row.platform||"Instagram", pubDate:row.date, client:row.client||"" }, postId, buf);
        allPosts.push(newPost);
        allTasks.push(...newTasks);
        await new Promise(r => setTimeout(r, 300));
      }
      await supabase.from("posts").insert(allPosts);
      await supabase.from("tasks").insert(allTasks);
      setPosts(p => [...p, ...allPosts]);
      setTasks(t => [...t, ...allTasks]);
      notify(`✓ ${allPosts.length} posts imported, ${allTasks.length} tasks generated!`);
      setView("dash");
    } catch (err) {
      notify("Import failed. Check file format.", true);
    }
    setImportLoading(false);
    setImportProgress("");
    e.target.value = "";
  };

  const updateStatus = async (taskId, status) => {
    await supabase.from("tasks").update({ status }).eq("id", taskId);
    setTasks(t => t.map(x => x.id===taskId ? {...x,status} : x));
  };

  const deletePost = async (postId) => {
    await supabase.from("posts").delete().eq("id", postId);
    setPosts(p => p.filter(x => x.id!==postId));
    setTasks(t => t.filter(x => x.post_id!==postId));
    setView("dash"); notify("Deleted");
  };

  const saveAnalytics = async () => {
    const a = analytics;
    const er = +a.views>0 ? ((((+a.likes||0)+(+a.comments||0)+(+a.reposts||0)+(+a.saves||0)) / +a.views)*100).toFixed(2) : null;
    const updated = {...a, er};
    await supabase.from("posts").update({ analytics:updated }).eq("id", sel.id);
    setPosts(p => p.map(x => x.id===sel.id ? {...x,analytics:updated} : x));
    notify("Saved ✓");
  };

  const todayTasks = tasks.filter(t=>t.due_date===TODAY()&&t.status!=="posted");
  const burning = tasks.filter(t=>urgency(t)==="burning");
  const weekTasks = tasks.filter(t=>{ const d=daysDiff(t.due_date); return d>=-1&&d<=7&&t.status!=="posted"; }).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));

  const C = { bg:"#080818", card:"#0f0f2e", border:"#1a1a4a", violet:"#6c63ff", violet2:"#9d97ff", green:"#00C853", red:"#ef5350", gold:"#c4956a", text:"#e0e0f0", muted:"#666688", white:"#ffffff" };

  const selPost = sel ? posts.find(p=>p.id===sel.id) : null;

  // ── SHARED: TASK CARD ─────────────────────────────────────────────────────
  const TaskCard = ({t, onClick}) => {
    const urg = urgency(t);
    return (
      <div onClick={onClick} style={{ background:urg==="burning"?"#1a0505":urg==="today"?"#0a0a20":"#0d0d25", border:`1px solid ${urg==="burning"?"#3a1010":urg==="today"?"#2a2a5a":"#181838"}`, borderRadius:12, padding:mobile?"12px 14px":"10px 14px", marginBottom:8, cursor:"pointer" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
          <div style={{ flex:1, marginRight:8 }}>
            <div style={{ fontWeight:700, fontSize:mobile?14:13, color:urg==="burning"?C.red:C.text }}>{t.title}</div>
            <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{t.post_title}</div>
          </div>
          <span style={{ fontSize:9, padding:"3px 7px", borderRadius:6, background:(ROLE_COLORS[t.role]||["#33334422"])[0], color:(ROLE_COLORS[t.role]||["","#aaa"])[1], fontWeight:700, flexShrink:0 }}>{t.role}</span>
        </div>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center" }}>
          <span style={{ fontSize:11, color:urg==="burning"?C.red:urg==="today"?C.violet:C.muted }}>
            {urg==="burning"?`🔥 ${Math.abs(daysDiff(t.due_date))}d overdue`:urg==="today"?"📅 Due today":`📅 ${fmtShort(t.due_date)}`}
          </span>
          <select value={t.status} onChange={e=>{e.stopPropagation();updateStatus(t.id,e.target.value);}}
            style={{ background:"#1a1a3a", border:`1px solid #2a2a5a`, color:C.violet2, borderRadius:8, padding:"4px 8px", fontSize:11, cursor:"pointer" }}>
            {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
    );
  };

  // ── INPUT STYLE ───────────────────────────────────────────────────────────
  const inp = { width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:10, padding:mobile?"12px 14px":"9px 12px", color:C.text, fontSize:mobile?15:13, outline:"none", boxSizing:"border-box" };
  const sel_style = { ...inp };
  const btn = (v) => ({ padding:mobile?"14px":"9px 18px", borderRadius:mobile?12:8, border:"none", cursor:"pointer", fontWeight:800, fontSize:mobile?15:13, background:v==="primary"?C.violet:v==="danger"?"#2a0808":v==="green"?"#0a2a1a":"#1a1a3a", color:v==="primary"?C.white:v==="danger"?C.red:v==="green"?C.green:"#aaaacc" });

  // ── IMPORT SECTION ────────────────────────────────────────────────────────
  const ImportSection = () => (
    <div style={{ background:"#0a0a1e", border:`1px solid ${C.violet}44`, borderRadius:12, padding:16, marginBottom:16 }}>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:8, textTransform:"uppercase" }}>📥 Import Monthly Plan</div>
      <div style={{ fontSize:12, color:C.muted, marginBottom:10 }}>
        Upload a CSV file with columns: <span style={{ color:C.violet2 }}>Title, Type, Platform, Date, Client</span>
      </div>
      {importLoading ? (
        <div style={{ color:C.violet2, fontSize:13, padding:"10px 0" }}>⚡ {importProgress}</div>
      ) : (
        <label style={{ display:"block", cursor:"pointer" }}>
          <div style={{ ...btn("primary"), textAlign:"center", borderRadius:10 }}>
            📂 Choose CSV File
          </div>
          <input type="file" accept=".csv,.txt" onChange={importFromFile} style={{ display:"none" }}/>
        </label>
      )}
      <div style={{ fontSize:11, color:"#444466", marginTop:8 }}>
        💡 <a href="https://docs.google.com/spreadsheets" target="_blank" rel="noreferrer" style={{ color:"#555577" }}>Create in Google Sheets</a> → File → Download → CSV
      </div>
    </div>
  );

  // ── SETTINGS MODAL ────────────────────────────────────────────────────────
  const SettingsModal = () => (
    <div style={{ position:"fixed", inset:0, background:"#00000099", zIndex:200, display:"flex", alignItems:mobile?"flex-end":"center", justifyContent:"center" }}>
      <div style={{ background:"#0d0d2b", borderRadius:mobile?"20px 20px 0 0":"14px", padding:24, width:mobile?"100%":"420px", maxHeight:"80vh", overflowY:"auto" }}>
        <div style={{ fontSize:18, fontWeight:800, color:C.white, fontFamily:"Georgia,serif", marginBottom:4 }}>⚙ Buffer Days</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:18 }}>Days before publication that prep tasks begin.</div>
        {CTYPES.map(type => (
          <div key={type} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"#111130", borderRadius:12, padding:"12px 16px", marginBottom:10 }}>
            <div>
              <div style={{ fontSize:14, fontWeight:600, color:C.text }}>{type}</div>
              <div style={{ fontSize:11, color:C.muted }}>prep {editBuffers[type]||1}d before pub</div>
            </div>
            <div style={{ display:"flex", alignItems:"center", gap:10 }}>
              <button onClick={()=>setEditBuffers(b=>({...b,[type]:Math.max(1,(b[type]||1)-1)}))} style={{ width:34, height:34, borderRadius:8, border:`1px solid #2a2a55`, background:"#1a1a3a", color:C.text, cursor:"pointer", fontWeight:700, fontSize:16 }}>−</button>
              <span style={{ fontSize:18, fontWeight:800, color:C.violet2, width:28, textAlign:"center" }}>{editBuffers[type]||1}</span>
              <button onClick={()=>setEditBuffers(b=>({...b,[type]:Math.min(30,(b[type]||1)+1)}))} style={{ width:34, height:34, borderRadius:8, border:`1px solid #2a2a55`, background:"#1a1a3a", color:C.text, cursor:"pointer", fontWeight:700, fontSize:16 }}>+</button>
            </div>
          </div>
        ))}
        <div style={{ display:"flex", gap:10, marginTop:16 }}>
          <button onClick={saveBuffers} style={{ ...btn("primary"), flex:1 }}>Save</button>
          <button onClick={()=>{ setEditBuffers({...buffers}); setShowSettings(false); }} style={{ ...btn(), flex:1 }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  // ── DASHBOARD ─────────────────────────────────────────────────────────────
  const Dashboard = () => (
    <div style={{ padding:mobile?"16px 16px 80px":"24px" }}>
      {!mobile && (
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:24 }}>
          <div>
            <div style={{ fontSize:24, fontWeight:800, color:C.white, fontFamily:"Georgia,serif" }}>TASKONA<span style={{ color:C.violet }}>.AI</span></div>
            <div style={{ fontSize:12, color:C.muted }}>{fmtDate(TODAY())}</div>
          </div>
          <div style={{ display:"flex", gap:10 }}>
            <button onClick={()=>setView("add")} style={{ ...btn("primary"), padding:"9px 18px" }}>+ Add Post</button>
            <button onClick={()=>{ setEditBuffers({...buffers}); setShowSettings(true); }} style={{ ...btn(), padding:"9px 14px" }}>⚙ Buffers</button>
          </div>
        </div>
      )}
      {mobile && (
        <div style={{ marginBottom:20 }}>
          <div style={{ display:"flex", alignItems:"center", gap:10 }}><img src="/logo.png" style={{ height:36, width:36, borderRadius:10 }} alt="Taskona"/><span style={{ fontSize:22, fontWeight:800, color:C.white, fontFamily:"Georgia,serif" }}>TASKONA<span style={{ color:C.violet }}>.AI</span></span></div>
          <div style={{ fontSize:12, color:C.muted }}>{fmtDate(TODAY())}</div>
        </div>
      )}

      {/* Stats */}
      <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr 1fr":"repeat(4,1fr)", gap:10, marginBottom:16 }}>
        {[{n:posts.length,l:"Total Posts",c:C.violet2,icon:"📋"},{n:todayTasks.length,l:"Due Today",c:todayTasks.length?C.violet:C.green,icon:"📅"},{n:burning.length,l:"Burning",c:burning.length?C.red:C.green,icon:"🔥"},{n:weekTasks.length,l:"This Week",c:C.gold,icon:"📆"}].map((s,i)=>(
          <div key={i} style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:14, padding:"14px 16px" }}>
            <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>{s.icon} {s.l}</div>
            <div style={{ fontSize:mobile?28:30, fontWeight:800, color:s.c, fontFamily:"Georgia,serif" }}>{s.n}</div>
          </div>
        ))}
      </div>

      <div style={{ display:mobile?"block":"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
        {/* Left col */}
        <div>
          <ImportSection/>
          {burning.length>0&&<>
            <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.red, marginBottom:10, textTransform:"uppercase" }}>🔥 Burning</div>
            {burning.map(t=><TaskCard key={t.id} t={t} onClick={()=>{setSel(posts.find(p=>p.id===t.post_id));setAnalytics(posts.find(p=>p.id===t.post_id)?.analytics||{});setView("detail");}}/>)}
          </>}
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:10, marginTop:burning.length?16:0, textTransform:"uppercase" }}>Today</div>
          {todayTasks.length===0
            ? <div style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:12, padding:16, color:C.green, fontSize:13, marginBottom:16 }}>✓ Nothing due today</div>
            : todayTasks.map(t=><TaskCard key={t.id} t={t} onClick={()=>{setSel(posts.find(p=>p.id===t.post_id));setAnalytics(posts.find(p=>p.id===t.post_id)?.analytics||{});setView("detail");}}/>)}
        </div>

        {/* Right col / Posts */}
        <div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:10, textTransform:"uppercase" }}>All Posts ({posts.length})</div>
          {posts.length===0
            ? <div style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:12, padding:20, color:C.muted, fontSize:13, textAlign:"center" }}>
                No posts yet.<br/>Import a plan or tap + to add a post.
              </div>
            : posts.sort((a,b)=>new Date(a.pub_date)-new Date(b.pub_date)).map(p=>{
                const pt=tasks.filter(t=>t.post_id===p.id), done=pt.filter(t=>t.status==="posted").length, diff=daysDiff(p.pub_date), hasBurning=pt.some(t=>urgency(t)==="burning");
                return <div key={p.id} onClick={()=>{setSel(p);setAnalytics(p.analytics||{});setView("detail");}} style={{ background:"#0f0f2e", border:`1px solid ${hasBurning?"#3a1010":"#1a1a4a"}`, borderRadius:14, padding:"14px 16px", marginBottom:10, cursor:"pointer" }}>
                  <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                    <div style={{ flex:1 }}>
                      <div style={{ fontWeight:700, fontSize:14, color:C.text, marginBottom:4 }}>{hasBurning&&<span style={{ color:C.red, marginRight:4 }}>🔥</span>}{p.title}</div>
                      <div style={{ fontSize:12, color:C.muted }}>{p.platform} · {p.content_type}{p.client&&` · ${p.client}`}</div>
                    </div>
                    <div style={{ textAlign:"right", marginLeft:12 }}>
                      <div style={{ fontSize:13, fontWeight:700, color:diff<=0?C.red:diff<=3?"#cc9933":C.green }}>{diff===0?"TODAY":diff<0?`${Math.abs(diff)}d ago`:`${diff}d`}</div>
                      <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{done}/{pt.length} done</div>
                    </div>
                  </div>
                </div>
              })}
        </div>
      </div>
    </div>
  );

  // ── WEEKLY ────────────────────────────────────────────────────────────────
  const Weekly = () => (
    <div style={{ padding:mobile?"16px 16px 80px":"24px" }}>
      {!mobile&&<div style={{ fontSize:22, fontWeight:800, color:C.text, fontFamily:"Georgia,serif", marginBottom:20 }}>This Week</div>}
      {mobile&&<div style={{ fontSize:18, fontWeight:800, color:C.text, fontFamily:"Georgia,serif", marginBottom:16 }}>This Week</div>}
      {burning.length>0&&<div style={{ background:"#150505", border:`1px solid #3a1010`, borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
        <div style={{ color:C.red, fontWeight:700, fontSize:13 }}>🔥 {burning.length} burning — mark as posted or missed</div>
      </div>}
      <div style={{ display:mobile?"block":"grid", gridTemplateColumns:"repeat(7,1fr)", gap:8 }}>
        {Array.from({length:7},(_,i)=>addDays(TODAY(),i)).map(day=>{
          const dt=weekTasks.filter(t=>t.due_date===day), isToday=day===TODAY(), isFriday=new Date(day+"T12:00:00").getDay()===5;
          if (mobile) return (
            <div key={day} style={{ marginBottom:16 }}>
              <div style={{ fontSize:12, fontWeight:700, color:isToday?C.violet:isFriday?"#9d3eff":C.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>
                {isToday?"TODAY · ":""}{new Date(day+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}{isFriday?" ⚠️":""}
              </div>
              {dt.length===0?<div style={{ color:"#333355", fontSize:12, paddingLeft:4, marginBottom:4 }}>—</div>
                :dt.map(t=><TaskCard key={t.id} t={t} onClick={()=>{setSel(posts.find(p=>p.id===t.post_id));setAnalytics(posts.find(p=>p.id===t.post_id)?.analytics||{});setView("detail");}}/>)}
            </div>
          );
          return (
            <div key={day} style={{ background:isToday?"#0d0d2e":"#0a0a1a", border:`1px solid ${isToday?C.violet:isFriday?"#2a1535":"#141428"}`, borderRadius:10, padding:10, minHeight:160 }}>
              <div style={{ fontSize:9, fontWeight:700, color:isToday?C.violet:isFriday?"#9d3eff":C.muted, letterSpacing:1, marginBottom:3 }}>
                {isToday?"TODAY":new Date(day+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"}).toUpperCase()}{isFriday?" ⚠️":""}
              </div>
              <div style={{ fontSize:16, fontWeight:800, color:isToday?C.white:"#8888aa", marginBottom:8 }}>{new Date(day+"T12:00:00").getDate()}</div>
              {dt.length===0?<div style={{ fontSize:9, color:"#222233" }}>—</div>
                :dt.map(t=>{ const urg=urgency(t); return (
                  <div key={t.id} style={{ background:urg==="burning"?"#1e0505":"#0f0f22", border:`1px solid ${urg==="burning"?"#3a1010":"#1a1a3a"}`, borderRadius:6, padding:"5px 7px", marginBottom:5 }}>
                    <div style={{ fontSize:10, fontWeight:600, color:urg==="burning"?C.red:"#c0c0e0" }}>{t.title}</div>
                    <div style={{ fontSize:9, color:"#444466", marginTop:2 }}>{t.post_title}</div>
                    <select value={t.status} onChange={e=>updateStatus(t.id,e.target.value)} style={{ width:"100%", marginTop:4, background:"#0a0a1a", border:`1px solid #1a1a3a`, color:C.muted, borderRadius:5, padding:"2px 4px", fontSize:9, cursor:"pointer" }}>
                      {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                );})}
            </div>
          );
        })}
      </div>
    </div>
  );

  // ── ADD POST ──────────────────────────────────────────────────────────────
  const AddPost = () => (
    <div style={{ padding:mobile?"16px 16px 80px":"24px", maxWidth:mobile?"100%":560 }}>
      {!mobile&&<button onClick={()=>setView("dash")} style={{ background:"none", border:"none", color:C.violet, fontSize:13, fontWeight:700, cursor:"pointer", padding:"0 0 16px", display:"flex", alignItems:"center", gap:6 }}>← Back</button>}
      <div style={{ fontSize:mobile?18:20, fontWeight:800, color:C.text, fontFamily:"Georgia,serif", marginBottom:20 }}>New Post</div>
      <ImportSection/>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.muted, marginBottom:14, textTransform:"uppercase" }}>Or add manually</div>
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Post Title *</div><input style={inp} placeholder="e.g. Spring Campaign Launch" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Content Type</div><select style={sel_style} value={form.contentType} onChange={e=>setForm({...form,contentType:e.target.value})}>{CTYPES.map(t=><option key={t}>{t}</option>)}</select></div>
          <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Platform</div><select style={sel_style} value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{PLATFORMS.map(p=><option key={p}>{p}</option>)}</select></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Publication Date *</div><input type="date" style={inp} value={form.pubDate} onChange={e=>setForm({...form,pubDate:e.target.value})}/></div>
          <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Client</div><input style={inp} placeholder="e.g. Uzcard" value={form.client} onChange={e=>setForm({...form,client:e.target.value})}/></div>
        </div>
        <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Brief</div><textarea style={{ ...inp, resize:"vertical", minHeight:70 }} placeholder="Key message, tone, references..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div style={{ background:"#0a0a1e", border:`1px solid #2a2a55`, borderRadius:10, padding:14 }}>
          <div style={{ fontSize:10, color:C.violet, fontWeight:700, marginBottom:6, letterSpacing:2 }}>AI TASK LOGIC</div>
          <div style={{ fontSize:12, color:"#8888aa" }}>{form.contentType} → <span style={{ color:C.gold }}>{getBuffer(form.contentType)} days</span> buffer</div>
          <div style={{ fontSize:12, color:"#8888aa", marginTop:3 }}>Prep: <span style={{ color:C.green }}>{form.pubDate?fmtDate(addDays(form.pubDate,-getBuffer(form.contentType))):"—"}</span></div>
          <div style={{ fontSize:12, color:"#8888aa", marginTop:3 }}>Pub: <span style={{ color:C.gold }}>{form.pubDate?fmtDate(form.pubDate):"—"}</span></div>
        </div>
        <button onClick={addPost} disabled={loading} style={{ ...btn("primary"), width:"100%" }}>
          {loading?"⚡ Generating...":"✦ Add Post & Generate Tasks"}
        </button>
      </div>
    </div>
  );

  // ── DETAIL ────────────────────────────────────────────────────────────────
  const Detail = () => {
    if (!selPost) return null;
    const postTasks = tasks.filter(t=>t.post_id===selPost.id).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
    return (
      <div style={{ padding:mobile?"16px 16px 80px":"24px" }}>
        <button onClick={()=>setView("dash")} style={{ background:"none", border:"none", color:C.violet, fontSize:13, fontWeight:700, cursor:"pointer", padding:"0 0 16px", display:"flex", alignItems:"center", gap:6 }}>← Back</button>
        <div style={{ background:"#0f0f2e", border:`1px solid #2a2a5a`, borderRadius:14, padding:16, marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:mobile?18:20, fontWeight:800, color:C.white, fontFamily:"Georgia,serif" }}>{selPost.title}</div>
              <div style={{ color:C.muted, fontSize:12, marginTop:4 }}>{selPost.platform} · {selPost.content_type} · <span style={{ color:C.gold }}>{fmtDate(selPost.pub_date)}</span></div>
              {selPost.client&&<div style={{ color:C.violet2, fontSize:12, marginTop:2 }}>{selPost.client}</div>}
            </div>
            <button onClick={()=>deletePost(selPost.id)} style={{ ...btn("danger"), padding:"6px 12px", fontSize:12 }}>Delete</button>
          </div>
        </div>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:10, textTransform:"uppercase" }}>Tasks ({postTasks.length})</div>
        {postTasks.map(t=><TaskCard key={t.id} t={t} onClick={()=>{}}/>)}
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:12, marginTop:20, textTransform:"uppercase" }}>Analytics</div>
        {analytics.er&&<div style={{ display:"flex", gap:24, marginBottom:14 }}>{[{v:`${analytics.er}%`,l:"ER",c:C.violet},{v:(+analytics.views||0).toLocaleString(),l:"Views",c:C.green},{v:(+analytics.likes||0).toLocaleString(),l:"Likes",c:C.gold}].map((s,i)=><div key={i}><div style={{ fontSize:22, fontWeight:800, color:s.c, fontFamily:"Georgia,serif" }}>{s.v}</div><div style={{ fontSize:11, color:C.muted }}>{s.l}</div></div>)}</div>}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:12 }}>
          {[{k:"views",l:"Views"},{k:"likes",l:"Likes"},{k:"comments",l:"Comments"},{k:"reposts",l:"Reposts"},{k:"saves",l:"Saves"},{k:"clicks",l:"Clicks"}].map(f=>(
            <div key={f.k}><div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>{f.l}</div><input style={inp} placeholder="0" value={analytics[f.k]||""} onChange={e=>setAnalytics({...analytics,[f.k]:e.target.value})}/></div>
          ))}
        </div>
        <div style={{ marginBottom:12 }}><div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>Post URL</div><input style={inp} placeholder="https://..." value={analytics.link||""} onChange={e=>setAnalytics({...analytics,link:e.target.value})}/></div>
        <button onClick={saveAnalytics} style={{ ...btn("green"), width:"100%" }}>Save Analytics</button>
      </div>
    );
  };

  // ── DESKTOP NAV ───────────────────────────────────────────────────────────
  const DesktopNav = () => (
    <div style={{ background:"#0d0d2b", borderBottom:`1px solid #1a1a4a`, padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", height:52, position:"sticky", top:0, zIndex:100 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}><img src="/logo.png" style={{ height:32, width:32, borderRadius:8 }} alt="Taskona"/><span style={{ fontSize:18, fontWeight:800, letterSpacing:2, fontFamily:"Georgia,serif", color:C.white }}>TASKONA<span style={{ color:C.violet }}>.AI</span></span></div>
      <nav style={{ display:"flex", gap:3 }}>
        {[["dash","Dashboard"],["week","This Week"],["add","+ Add Post"]].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{ padding:"6px 14px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, fontWeight:700, background:view===k?C.violet:"transparent", color:view===k?C.white:C.muted }}>
            {l}
          </button>
        ))}
      </nav>
      <button onClick={()=>{ setEditBuffers({...buffers}); setShowSettings(true); }} style={{ ...btn(), padding:"5px 12px", fontSize:11 }}>⚙ Buffers</button>
    </div>
  );

  // ── MOBILE BOTTOM NAV ─────────────────────────────────────────────────────
  const MobileNav = () => (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"#0d0d2b", borderTop:`1px solid #1a1a4a`, display:"flex", zIndex:100 }}>
      {[{key:"dash",icon:"⊞",label:"Home"},{key:"week",icon:"📆",label:"Week"},{key:"add",icon:"+",label:"Add"},{key:"settings",icon:"⚙",label:"Settings"}].map(n=>(
        <button key={n.key} onClick={()=>n.key==="settings"?setShowSettings(true):setView(n.key)}
          style={{ flex:1, padding:"10px 0 8px", background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
          <span style={{ fontSize:n.key==="add"?22:18, width:n.key==="add"?36:undefined, height:n.key==="add"?36:undefined, borderRadius:n.key==="add"?"50%":undefined, background:n.key==="add"?C.violet:"none", display:"flex", alignItems:"center", justifyContent:"center", color:view===n.key?C.violet:"#555577", fontWeight:700 }}>{n.icon}</span>
          <span style={{ fontSize:10, color:view===n.key?C.violet:"#555577", fontWeight:view===n.key?700:400 }}>{n.label}</span>
        </button>
      ))}
    </div>
  );

  // ── RENDER ────────────────────────────────────────────────────────────────
  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Segoe UI',system-ui,sans-serif", fontSize:14, maxWidth:mobile?480:"100%", margin:"0 auto" }}>
      {showSettings && <SettingsModal/>}
      {toast && <div style={{ position:"fixed", top:14, left:"50%", transform:"translateX(-50%)", zIndex:999, background:toast.err?"#2a0808":"#0a2a1a", border:`1px solid ${toast.err?C.red:C.green}`, color:toast.err?C.red:C.green, padding:"10px 20px", borderRadius:20, fontWeight:600, fontSize:13, whiteSpace:"nowrap" }}>{toast.msg}</div>}
      {(loading||importLoading) && <div style={{ position:"fixed", top:0, left:0, right:0, background:C.violet, padding:"8px 16px", zIndex:98, fontSize:13, color:C.white, fontWeight:600, textAlign:"center" }}>⚡ {importProgress||"AI generating tasks..."}</div>}

      {!mobile && <DesktopNav/>}

      {view==="dash" && <Dashboard/>}
      {view==="week" && <Weekly/>}
      {view==="add" && <AddPost/>}
      {view==="detail" && <Detail/>}

      {mobile && <MobileNav/>}
    </div>
  );
}
