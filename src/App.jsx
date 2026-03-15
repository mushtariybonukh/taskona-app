import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ukrfnapkypperwvmgiie.supabase.co";
const SUPABASE_KEY = "sb_publishable_PSjKF-xddCU--82YhO4gIQ_BaH3ilc-";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

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

export default function Taskona() {
  const [posts, setPosts] = useState([]);
  const [tasks, setTasks] = useState([]);
  const [buffers, setBuffers] = useState(DEFAULT_BUFFERS);
  const [view, setView] = useState("dash");
  const [sel, setSel] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toast, setToast] = useState(null);
  const [form, setForm] = useState({ title:"", contentType:"Graphic", platform:"Instagram", pubDate:addDays(TODAY(),7), client:"", description:"" });
  const [analytics, setAnalytics] = useState({});
  const [showSettings, setShowSettings] = useState(false);
  const [editBuffers, setEditBuffers] = useState(DEFAULT_BUFFERS);

  useEffect(() => { loadData(); }, []);

  const loadData = async () => {
    const { data: p } = await supabase.from("posts").select("*").order("pub_date");
    const { data: t } = await supabase.from("tasks").select("*").order("due_date");
    const { data: b } = await supabase.from("buffers").select("*").eq("id", 1).single();
    if (p) setPosts(p);
    if (t) setTasks(t);
    if (b?.settings) { setBuffers(b.settings); setEditBuffers(b.settings); }
  };

  const notify = (msg, err) => { setToast({msg,err}); setTimeout(()=>setToast(null),3000); };
  const getBuffer = (ct) => buffers[ct] ?? DEFAULT_BUFFERS[ct] ?? 1;

  const saveBuffers = async () => {
    const cleaned = {};
    Object.entries(editBuffers).forEach(([k,v]) => { cleaned[k] = Math.max(1, Math.min(30, parseInt(v)||1)); });
    await supabase.from("buffers").upsert({ id:1, settings:cleaned });
    setBuffers(cleaned); setEditBuffers(cleaned);
    setShowSettings(false); notify("Saved ✓");
  };

  const addPost = async () => {
    if (!form.title||!form.pubDate) return notify("Title and date required", true);
    setLoading(true);
    const buf = getBuffer(form.contentType);
    const prepDate = addDays(form.pubDate, -buf);
    const postId = Date.now().toString();
    let newTasks = [];
    try {
      const res = await fetch("https://api.anthropic.com/v1/messages", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-20250514", max_tokens:800,
          messages:[{ role:"user", content:`Content task planner for Taskona.ai.
Post: "${form.title}" | Type: ${form.contentType} | Platform: ${form.platform} | Pub: ${form.pubDate} | Client: ${form.client||"N/A"} | Brief: ${form.description||"N/A"}
Buffer: ${buf} days. Prep by: ${prepDate}. Today: ${TODAY()}.
Generate 4-5 tasks between today and pub date. Roles: Designer/Editor/PM/Client.
ONLY JSON array: [{"title":"...","role":"PM","dueDate":"YYYY-MM-DD"}]` }]
        })
      });
      const data = await res.json();
      const parsed = JSON.parse(data.content[0].text.trim());
      newTasks = parsed.map((t,i) => ({ id:`${postId}_${i}`, post_id:postId, post_title:form.title, platform:form.platform, content_type:form.contentType, title:t.title, role:t.role, due_date:t.dueDate, pub_date:form.pubDate, status:"scheduled" }));
    } catch {
      newTasks = [
        { id:`${postId}_0`, post_id:postId, post_title:form.title, platform:form.platform, content_type:form.contentType, title:"Creative brief", role:"PM", due_date:addDays(form.pubDate,-buf-1), pub_date:form.pubDate, status:"scheduled" },
        { id:`${postId}_1`, post_id:postId, post_title:form.title, platform:form.platform, content_type:form.contentType, title:`Prepare ${form.contentType.toLowerCase()}`, role:"Designer", due_date:prepDate, pub_date:form.pubDate, status:"scheduled" },
        { id:`${postId}_2`, post_id:postId, post_title:form.title, platform:form.platform, content_type:form.contentType, title:"Review & approve", role:"Client", due_date:addDays(form.pubDate,-1), pub_date:form.pubDate, status:"scheduled" },
        { id:`${postId}_3`, post_id:postId, post_title:form.title, platform:form.platform, content_type:form.contentType, title:"Publish post", role:"PM", due_date:form.pubDate, pub_date:form.pubDate, status:"scheduled" },
      ];
    }
    const newPost = { id:postId, title:form.title, content_type:form.contentType, platform:form.platform, pub_date:form.pubDate, client:form.client, description:form.description, created_at:TODAY(), analytics:null };
    await supabase.from("posts").insert(newPost);
    await supabase.from("tasks").insert(newTasks);
    setPosts(p => [...p, newPost]);
    setTasks(t => [...t, ...newTasks]);
    notify(`✓ ${newTasks.length} tasks generated`);
    setForm({ title:"", contentType:"Graphic", platform:"Instagram", pubDate:addDays(TODAY(),7), client:"", description:"" });
    setView("dash"); setLoading(false);
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

  const C = { bg:"#080818", card:"#0f0f2e", border:"#1a1a4a", violet:"#6c63ff", violet2:"#9d97ff", green:"#00C853", red:"#ef5350", gold:"#c4956a", text:"#e0e0f0", muted:"#666688" };

  const selPost = sel ? posts.find(p=>p.id===sel.id) : null;

  const TaskCard = ({t, onClick}) => {
    const urg = urgency(t);
    return (
      <div onClick={onClick} style={{ background:urg==="burning"?"#1a0505":urg==="today"?"#0a0a20":"#0d0d25", border:`1px solid ${urg==="burning"?"#3a1010":urg==="today"?"#2a2a5a":"#181838"}`, borderRadius:12, padding:"12px 14px", marginBottom:8 }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:6 }}>
          <div style={{ flex:1, marginRight:8 }}>
            <div style={{ fontWeight:700, fontSize:14, color:urg==="burning"?C.red:C.text }}>{t.title}</div>
            <div style={{ fontSize:12, color:C.muted, marginTop:2 }}>{t.post_title}</div>
          </div>
          <span style={{ fontSize:10, padding:"3px 8px", borderRadius:6, background:(ROLE_COLORS[t.role]||["#33334422"])[0], color:(ROLE_COLORS[t.role]||["","#aaa"])[1], fontWeight:700 }}>{t.role}</span>
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

  const Dashboard = () => (
    <div style={{ padding:"16px 16px 80px" }}>
      <div style={{ marginBottom:20 }}>
        <div style={{ fontSize:22, fontWeight:800, color:"#fff", fontFamily:"Georgia,serif" }}>TASKONA<span style={{ color:C.violet }}>.AI</span></div>
        <div style={{ fontSize:12, color:C.muted }}>{fmtDate(TODAY())}</div>
      </div>
      <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:16 }}>
        {[{n:posts.length,l:"Total Posts",c:C.violet2,icon:"📋"},{n:todayTasks.length,l:"Due Today",c:todayTasks.length?C.violet:C.green,icon:"📅"},{n:burning.length,l:"Burning",c:burning.length?C.red:C.green,icon:"🔥"},{n:weekTasks.length,l:"This Week",c:C.gold,icon:"📆"}].map((s,i)=>(
          <div key={i} style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:14, padding:"14px 16px" }}>
            <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>{s.icon} {s.l}</div>
            <div style={{ fontSize:28, fontWeight:800, color:s.c, fontFamily:"Georgia,serif" }}>{s.n}</div>
          </div>
        ))}
      </div>
      {burning.length>0&&<><div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.red, marginBottom:10, textTransform:"uppercase" }}>🔥 Burning</div>{burning.map(t=><TaskCard key={t.id} t={t} onClick={()=>{setSel(posts.find(p=>p.id===t.post_id));setAnalytics(posts.find(p=>p.id===t.post_id)?.analytics||{});setView("detail");}}/>)}</>}
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:10, marginTop:burning.length?16:0, textTransform:"uppercase" }}>Today</div>
      {todayTasks.length===0
        ? <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:16, color:C.green, fontSize:13 }}>✓ Nothing due today</div>
        : todayTasks.map(t=><TaskCard key={t.id} t={t} onClick={()=>{setSel(posts.find(p=>p.id===t.post_id));setAnalytics(posts.find(p=>p.id===t.post_id)?.analytics||{});setView("detail");}}/>)}
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:10, marginTop:16, textTransform:"uppercase" }}>All Posts ({posts.length})</div>
      {posts.length===0
        ? <div style={{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:20, color:C.muted, fontSize:13, textAlign:"center" }}>No posts yet.<br/>Tap <span style={{ color:C.violet }}>+</span> to create your first post</div>
        : posts.sort((a,b)=>new Date(a.pub_date)-new Date(b.pub_date)).map(p=>{
            const pt=tasks.filter(t=>t.post_id===p.id), done=pt.filter(t=>t.status==="posted").length, diff=daysDiff(p.pub_date), hasBurning=pt.some(t=>urgency(t)==="burning");
            return <div key={p.id} onClick={()=>{setSel(p);setAnalytics(p.analytics||{});setView("detail");}} style={{ background:C.card, border:`1px solid ${hasBurning?"#3a1010":C.border}`, borderRadius:14, padding:"14px 16px", marginBottom:10, cursor:"pointer" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:15, color:C.text, marginBottom:4 }}>{hasBurning&&<span style={{ color:C.red, marginRight:4 }}>🔥</span>}{p.title}</div>
                  <div style={{ fontSize:12, color:C.muted }}>{p.platform} · {p.content_type}</div>
                </div>
                <div style={{ textAlign:"right" }}>
                  <div style={{ fontSize:13, fontWeight:700, color:diff<=0?C.red:diff<=3?"#cc9933":C.green }}>{diff===0?"TODAY":diff<0?`${Math.abs(diff)}d ago`:`${diff}d`}</div>
                  <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{done}/{pt.length} done</div>
                </div>
              </div>
            </div>;
          })}
    </div>
  );

  const Weekly = () => (
    <div style={{ padding:"16px 16px 80px" }}>
      <div style={{ fontSize:18, fontWeight:800, color:C.text, fontFamily:"Georgia,serif", marginBottom:16 }}>This Week</div>
      {burning.length>0&&<div style={{ background:"#150505", border:`1px solid #3a1010`, borderRadius:12, padding:"12px 14px", marginBottom:16 }}>
        <div style={{ color:C.red, fontWeight:700, fontSize:13 }}>🔥 {burning.length} burning</div>
        <div style={{ color:"#cc7777", fontSize:12, marginTop:2 }}>Mark as posted or missed to clear</div>
      </div>}
      {Array.from({length:7},(_,i)=>addDays(TODAY(),i)).map(day=>{
        const dt=weekTasks.filter(t=>t.due_date===day), isToday=day===TODAY(), isFriday=new Date(day+"T12:00:00").getDay()===5;
        return <div key={day} style={{ marginBottom:16 }}>
          <div style={{ fontSize:12, fontWeight:700, color:isToday?C.violet:isFriday?"#9d3eff":C.muted, marginBottom:8, textTransform:"uppercase", letterSpacing:1 }}>
            {isToday?"TODAY · ":""}{new Date(day+"T12:00:00").toLocaleDateString("en-US",{weekday:"long",month:"short",day:"numeric"})}{isFriday?" ⚠️":""}
          </div>
          {dt.length===0 ? <div style={{ color:"#333355", fontSize:12, paddingLeft:4, marginBottom:4 }}>—</div>
            : dt.map(t=><TaskCard key={t.id} t={t} onClick={()=>{setSel(posts.find(p=>p.id===t.post_id));setAnalytics(posts.find(p=>p.id===t.post_id)?.analytics||{});setView("detail");}}/>)}
        </div>;
      })}
    </div>
  );

  const AddPost = () => (
    <div style={{ padding:"16px 16px 80px" }}>
      <div style={{ fontSize:18, fontWeight:800, color:C.text, fontFamily:"Georgia,serif", marginBottom:20 }}>New Post</div>
      <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
        <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Post Title *</div><input style={{ width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:10, padding:"12px 14px", color:C.text, fontSize:15, outline:"none", boxSizing:"border-box" }} placeholder="e.g. Spring Campaign" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Content Type</div><select style={{ width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:10, padding:"12px 14px", color:C.text, fontSize:14, outline:"none" }} value={form.contentType} onChange={e=>setForm({...form,contentType:e.target.value})}>{CTYPES.map(t=><option key={t}>{t}</option>)}</select></div>
          <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Platform</div><select style={{ width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:10, padding:"12px 14px", color:C.text, fontSize:14, outline:"none" }} value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{PLATFORMS.map(p=><option key={p}>{p}</option>)}</select></div>
        </div>
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
          <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Publication Date *</div><input type="date" style={{ width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:10, padding:"12px 14px", color:C.text, fontSize:14, outline:"none", boxSizing:"border-box" }} value={form.pubDate} onChange={e=>setForm({...form,pubDate:e.target.value})}/></div>
          <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Client</div><input style={{ width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:10, padding:"12px 14px", color:C.text, fontSize:14, outline:"none", boxSizing:"border-box" }} placeholder="e.g. Uzcard" value={form.client} onChange={e=>setForm({...form,client:e.target.value})}/></div>
        </div>
        <div><div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Brief</div><textarea style={{ width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:10, padding:"12px 14px", color:C.text, fontSize:14, outline:"none", resize:"vertical", minHeight:80, boxSizing:"border-box" }} placeholder="Key message, tone..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
        <div style={{ background:"#0a0a1e", border:`1px solid #2a2a55`, borderRadius:10, padding:14 }}>
          <div style={{ fontSize:10, color:C.violet, fontWeight:700, marginBottom:8, letterSpacing:2 }}>AI TASK LOGIC</div>
          <div style={{ fontSize:13, color:"#8888aa" }}>{form.contentType} → <span style={{ color:C.gold }}>{getBuffer(form.contentType)} days</span> buffer</div>
          <div style={{ fontSize:13, color:"#8888aa", marginTop:4 }}>Prep: <span style={{ color:C.green }}>{form.pubDate?fmtDate(addDays(form.pubDate,-getBuffer(form.contentType))):"—"}</span></div>
          <div style={{ fontSize:13, color:"#8888aa", marginTop:4 }}>Pub: <span style={{ color:C.gold }}>{form.pubDate?fmtDate(form.pubDate):"—"}</span></div>
        </div>
        <button onClick={addPost} disabled={loading} style={{ width:"100%", padding:"16px", borderRadius:12, border:"none", cursor:"pointer", fontWeight:800, fontSize:16, background:loading?"#333":C.violet, color:"#fff" }}>
          {loading?"⚡ Generating...":"✦ Add Post & Generate Tasks"}
        </button>
      </div>
    </div>
  );

  const Detail = () => {
    if (!selPost) return null;
    const postTasks = tasks.filter(t=>t.post_id===selPost.id).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));
    return (
      <div style={{ padding:"16px 16px 80px" }}>
        <button onClick={()=>setView("dash")} style={{ background:"none", border:"none", color:C.violet, fontSize:14, fontWeight:700, cursor:"pointer", padding:"0 0 16px", display:"flex", alignItems:"center", gap:6 }}>← Back</button>
        <div style={{ background:C.card, border:`1px solid #2a2a5a`, borderRadius:14, padding:16, marginBottom:14 }}>
          <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
            <div style={{ flex:1 }}>
              <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"Georgia,serif" }}>{selPost.title}</div>
              <div style={{ color:C.muted, fontSize:12, marginTop:4 }}>{selPost.platform} · {selPost.content_type} · <span style={{ color:C.gold }}>{fmtDate(selPost.pub_date)}</span></div>
              {selPost.client&&<div style={{ color:C.violet2, fontSize:12, marginTop:2 }}>{selPost.client}</div>}
            </div>
            <button onClick={()=>deletePost(selPost.id)} style={{ background:"#2a0808", border:`1px solid #4a1a1a`, color:C.red, borderRadius:8, padding:"6px 12px", fontSize:12, cursor:"pointer", fontWeight:700 }}>Delete</button>
          </div>
        </div>
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:10, textTransform:"uppercase" }}>Tasks</div>
        {postTasks.map(t=><TaskCard key={t.id} t={t} onClick={()=>{}}/>)}
        <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:12, marginTop:20, textTransform:"uppercase" }}>Analytics</div>
        {analytics.er&&<div style={{ display:"flex", gap:20, marginBottom:14 }}>{[{v:`${analytics.er}%`,l:"ER",c:C.violet},{v:(+analytics.views||0).toLocaleString(),l:"Views",c:C.green},{v:(+analytics.likes||0).toLocaleString(),l:"Likes",c:C.gold}].map((s,i)=><div key={i}><div style={{ fontSize:22, fontWeight:800, color:s.c, fontFamily:"Georgia,serif" }}>{s.v}</div><div style={{ fontSize:11, color:C.muted }}>{s.l}</div></div>)}</div>}
        <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:14 }}>
          {[{k:"views",l:"Views"},{k:"likes",l:"Likes"},{k:"comments",l:"Comments"},{k:"reposts",l:"Reposts"},{k:"saves",l:"Saves"},{k:"clicks",l:"Clicks"}].map(f=>(
            <div key={f.k}><div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>{f.l}</div><input style={{ width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:14, outline:"none", boxSizing:"border-box" }} placeholder="0" value={analytics[f.k]||""} onChange={e=>setAnalytics({...analytics,[f.k]:e.target.value})}/></div>
          ))}
        </div>
        <div style={{ marginBottom:10 }}><div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>Post URL</div><input style={{ width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:8, padding:"10px 12px", color:C.text, fontSize:14, outline:"none", boxSizing:"border-box" }} placeholder="https://..." value={analytics.link||""} onChange={e=>setAnalytics({...analytics,link:e.target.value})}/></div>
        <button onClick={saveAnalytics} style={{ width:"100%", padding:"14px", borderRadius:12, border:"none", cursor:"pointer", fontWeight:800, fontSize:15, background:"#0a2a1a", color:"#00C853" }}>Save Analytics</button>
      </div>
    );
  };

  const Settings = () => (
    <div style={{ position:"fixed", inset:0, background:"#00000099", zIndex:200, display:"flex", alignItems:"flex-end" }}>
      <div style={{ background:"#0d0d2b", borderRadius:"20px 20px 0 0", padding:24, width:"100%", maxHeight:"80vh", overflowY:"auto" }}>
        <div style={{ fontSize:18, fontWeight:800, color:"#fff", fontFamily:"Georgia,serif", marginBottom:4 }}>Buffer Days</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:18 }}>Days before publication that prep starts.</div>
        {CTYPES.map(type => (
          <div key={type} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"#111130", borderRadius:12, padding:"12px 16px", marginBottom:10 }}>
            <div><div style={{ fontSize:14, fontWeight:600, color:C.text }}>{type}</div><div style={{ fontSize:11, color:C.muted }}>prep {editBuffers[type]||1}d before</div></div>
            <div style={{ display:"flex", alignItems:"center", gap:12 }}>
              <button onClick={()=>setEditBuffers(b=>({...b,[type]:Math.max(1,(b[type]||1)-1)}))} style={{ width:36, height:36, borderRadius:10, border:`1px solid #2a2a55`, background:"#1a1a3a", color:C.text, cursor:"pointer", fontWeight:700, fontSize:18 }}>−</button>
              <span style={{ fontSize:20, fontWeight:800, color:C.violet2, width:32, textAlign:"center" }}>{editBuffers[type]||1}</span>
              <button onClick={()=>setEditBuffers(b=>({...b,[type]:Math.min(30,(b[type]||1)+1)}))} style={{ width:36, height:36, borderRadius:10, border:`1px solid #2a2a55`, background:"#1a1a3a", color:C.text, cursor:"pointer", fontWeight:700, fontSize:18 }}>+</button>
            </div>
          </div>
        ))}
        <div style={{ display:"flex", gap:10, marginTop:16 }}>
          <button onClick={saveBuffers} style={{ flex:1, padding:"14px", borderRadius:12, border:"none", cursor:"pointer", fontWeight:800, fontSize:15, background:C.violet, color:"#fff" }}>Save</button>
          <button onClick={()=>{ setEditBuffers({...buffers}); setShowSettings(false); }} style={{ flex:1, padding:"14px", borderRadius:12, border:`1px solid #2a2a55`, cursor:"pointer", fontWeight:700, fontSize:15, background:"transparent", color:C.muted }}>Cancel</button>
        </div>
      </div>
    </div>
  );

  return (
    <div style={{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Segoe UI',system-ui,sans-serif", fontSize:14, maxWidth:480, margin:"0 auto", position:"relative" }}>
      {showSettings && <Settings/>}
      {toast && <div style={{ position:"fixed", top:14, left:"50%", transform:"translateX(-50%)", zIndex:999, background:toast.err?"#2a0808":"#0a2a1a", border:`1px solid ${toast.err?C.red:C.green}`, color:toast.err?C.red:C.green, padding:"10px 20px", borderRadius:20, fontWeight:600, fontSize:13, whiteSpace:"nowrap" }}>{toast.msg}</div>}
      {loading && <div style={{ position:"fixed", top:0, left:0, right:0, background:C.violet, padding:"8px 16px", zIndex:98, fontSize:13, color:"#fff", fontWeight:600, textAlign:"center" }}>⚡ AI generating tasks...</div>}
      {view==="dash" && <Dashboard/>}
      {view==="week" && <Weekly/>}
      {view==="add" && <AddPost/>}
      {view==="detail" && <Detail/>}
      <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"#0d0d2b", borderTop:`1px solid #1a1a4a`, display:"flex", zIndex:100, maxWidth:480, margin:"0 auto" }}>
        {[{key:"dash",icon:"⊞",label:"Home"},{key:"week",icon:"📆",label:"Week"},{key:"add",icon:"+",label:"Add"},{key:"settings",icon:"⚙",label:"Settings"}].map(n=>(
          <button key={n.key} onClick={()=>n.key==="settings"?setShowSettings(true):setView(n.key)}
            style={{ flex:1, padding:"10px 0 8px", background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
            <span style={{ fontSize:n.key==="add"?22:18, lineHeight:1, width:n.key==="add"?36:undefined, height:n.key==="add"?36:undefined, borderRadius:n.key==="add"?"50%":undefined, background:n.key==="add"?C.violet:"none", display:"flex", alignItems:"center", justifyContent:"center", color:view===n.key?C.violet:"#555577", fontWeight:700 }}>{n.icon}</span>
            <span style={{ fontSize:10, color:view===n.key?C.violet:"#555577", fontWeight:view===n.key?700:400 }}>{n.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
