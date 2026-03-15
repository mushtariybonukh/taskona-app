import { useState, useEffect } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ukrfnapkypperwvmgiie.supabase.co";
const SUPABASE_KEY = "sb_publishable_PSjKF-xddCU--82YhO4gIQ_BaH3ilc-";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

const TODAY = () => new Date().toISOString().split("T")[0];
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x.toISOString().split("T")[0]; }
function daysDiff(d) { return Math.ceil((new Date(d) - new Date(TODAY())) / 86400000); }
function fmtDate(d) { return new Date(d + "T12:00:00").toLocaleDateString("en-US", { weekday:"short", month:"short", day:"numeric" }); }

const PLATFORMS = ["Instagram","TikTok","YouTube","LinkedIn","Telegram","Facebook"];
const CTYPES = ["Graphic","Video","Carousel","Reel","Story","Text post"];
const STATUSES = { scheduled:"Scheduled", in_progress:"In Progress ✏️", posted:"Posted ✓", missed:"Missed ✗" };
const ROLE_COLORS = { Designer:["#9d3eff22","#bb77ff"], Editor:["#3e9dff22","#77bbff"], PM:["#3eff9d22","#77ffbb"], Client:["#ff9d3e22","#ffbb77"] };
const DEFAULT_BUFFERS = { Graphic:2, Video:5, Carousel:2, Reel:5, Story:1, "Text post":1 };

function urgency(task) {
  const d = daysDiff(task.due_date);
  if (task.status==="missed"||(d<0&&task.status!=="posted")) return "burning";
  if (d===0) return "today";
  if (d<=2) return "urgent";
  if (d<=4) return "warning";
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
    setShowSettings(false); notify("Buffer days saved ✓");
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
          messages:[{ role:"user", content:`You are a content task planner for SMM agency platform Taskona.ai.
Post: "${form.title}" | Type: ${form.contentType} | Platform: ${form.platform} | Pub date: ${form.pubDate} | Client: ${form.client||"N/A"} | Brief: ${form.description||"N/A"}
Buffer: ${buf} days. Prep deadline: ${prepDate}. Today: ${TODAY()}.
Generate 4-5 tasks spaced between today and pub date. Roles: Designer/Editor/PM/Client.
ONLY return valid JSON array, no markdown: [{"title":"...","role":"PM","dueDate":"YYYY-MM-DD"}]` }]
        })
      });
      const data = await res.json();
      const parsed = JSON.parse(data.content[0].text.trim());
      newTasks = parsed.map((t,i) => ({
        id:`${postId}_${i}`, post_id:postId, post_title:form.title,
        platform:form.platform, content_type:form.contentType,
        title:t.title, role:t.role, due_date:t.dueDate,
        pub_date:form.pubDate, status:"scheduled"
      }));
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
    notify("Analytics saved ✓");
  };

  const todayTasks = tasks.filter(t=>t.due_date===TODAY()&&t.status!=="posted");
  const burning = tasks.filter(t=>urgency(t)==="burning");
  const weekTasks = tasks.filter(t=>{ const d=daysDiff(t.due_date); return d>=-1&&d<=7&&t.status!=="posted"; }).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date));

  const C = { bg:"#080818", card:"#0f0f2e", border:"#1a1a4a", violet:"#6c63ff", violet2:"#9d97ff", green:"#00C853", red:"#ef5350", gold:"#c4956a", text:"#e0e0f0", muted:"#666688" };
  const css = {
    app:{ minHeight:"100vh", background:C.bg, color:C.text, fontFamily:"'Segoe UI',system-ui,sans-serif", fontSize:14 },
    hdr:{ background:"#0d0d2b", borderBottom:`1px solid ${C.border}`, padding:"0 20px", display:"flex", alignItems:"center", justifyContent:"space-between", height:52, position:"sticky", top:0, zIndex:100 },
    main:{ padding:20, maxWidth:1100, margin:"0 auto" },
    card:{ background:C.card, border:`1px solid ${C.border}`, borderRadius:12, padding:18, marginBottom:14 },
    tag:{ fontSize:9, fontWeight:700, letterSpacing:3, color:C.violet, marginBottom:10, textTransform:"uppercase" },
    input:{ width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:8, padding:"9px 12px", color:C.text, fontSize:13, outline:"none", boxSizing:"border-box" },
    btn:(v)=>({ padding:"9px 18px", borderRadius:8, border:"none", cursor:"pointer", fontWeight:700, fontSize:13, background:v==="primary"?C.violet:v==="danger"?"#2a0808":v==="green"?"#0a2a1a":"#1a1a3a", color:v==="primary"?"#fff":v==="danger"?C.red:v==="green"?C.green:"#aaaacc" }),
    navBtn:(a)=>({ padding:"6px 14px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, fontWeight:700, background:a?C.violet:"transparent", color:a?"#fff":C.muted }),
    taskRow:(urg)=>({ display:"flex", alignItems:"center", gap:10, padding:"9px 12px", borderRadius:8, marginBottom:5, cursor:"pointer", background:urg==="burning"?"#150505":urg==="today"?"#0a0a1e":"#0d0d22", border:`1px solid ${urg==="burning"?"#3a1010":urg==="today"?"#2a2a5a":"#181838"}` }),
    dot:(urg)=>({ width:7, height:7, borderRadius:"50%", flexShrink:0, background:urg==="burning"?C.red:urg==="today"?C.violet:urg==="urgent"?C.gold:urg==="warning"?"#cc9933":"#334" }),
    chip:(r)=>({ fontSize:9, padding:"2px 7px", borderRadius:5, background:(ROLE_COLORS[r]||["#33334422","#888"])[0], color:(ROLE_COLORS[r]||["#33334422","#aaa"])[1], fontWeight:700 }),
  };

  const selPost = sel ? posts.find(p=>p.id===sel.id) : null;

  return (
    <div style={css.app}>
      {showSettings && (
        <div style={{ position:"fixed", inset:0, background:"#00000099", zIndex:200, display:"flex", alignItems:"center", justifyContent:"center" }}>
          <div style={{ background:"#0d0d2b", border:`1px solid ${C.violet}`, borderRadius:14, padding:24, width:400, maxWidth:"90vw" }}>
            <div style={{ fontSize:16, fontWeight:800, color:"#fff", fontFamily:"Georgia,serif", marginBottom:4 }}>⚙ Buffer Days</div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:18 }}>Days before publication that prep tasks begin.</div>
            {CTYPES.map(type => (
              <div key={type} style={{ display:"flex", alignItems:"center", justifyContent:"space-between", background:"#111130", borderRadius:8, padding:"10px 14px", marginBottom:8 }}>
                <div>
                  <div style={{ fontSize:13, fontWeight:600, color:C.text }}>{type}</div>
                  <div style={{ fontSize:10, color:C.muted }}>prep {editBuffers[type]||1}d before pub</div>
                </div>
                <div style={{ display:"flex", alignItems:"center", gap:8 }}>
                  <button onClick={()=>setEditBuffers(b=>({...b,[type]:Math.max(1,(b[type]||1)-1)}))} style={{ width:28, height:28, borderRadius:6, border:`1px solid #2a2a55`, background:"#1a1a3a", color:C.text, cursor:"pointer", fontWeight:700, fontSize:15 }}>−</button>
                  <span style={{ fontSize:18, fontWeight:800, color:C.violet2, width:28, textAlign:"center" }}>{editBuffers[type]||1}</span>
                  <button onClick={()=>setEditBuffers(b=>({...b,[type]:Math.min(30,(b[type]||1)+1)}))} style={{ width:28, height:28, borderRadius:6, border:`1px solid #2a2a55`, background:"#1a1a3a", color:C.text, cursor:"pointer", fontWeight:700, fontSize:15 }}>+</button>
                  <span style={{ fontSize:11, color:C.muted }}>days</span>
                </div>
              </div>
            ))}
            <div style={{ display:"flex", gap:10, marginTop:16 }}>
              <button style={css.btn("primary")} onClick={saveBuffers}>Save</button>
              <button style={css.btn()} onClick={()=>{ setEditBuffers({...buffers}); setShowSettings(false); }}>Cancel</button>
              <button style={{ ...css.btn(), marginLeft:"auto", fontSize:11, color:C.muted }} onClick={()=>setEditBuffers({...DEFAULT_BUFFERS})}>Reset</button>
            </div>
          </div>
        </div>
      )}

      {toast && <div style={{ position:"fixed", top:14, right:14, zIndex:999, background:toast.err?"#2a0808":"#0a2a1a", border:`1px solid ${toast.err?C.red:C.green}`, color:toast.err?C.red:C.green, padding:"10px 18px", borderRadius:9, fontWeight:600, fontSize:13 }}>{toast.msg}</div>}

      <header style={css.hdr}>
        <div style={{ fontSize:18, fontWeight:800, letterSpacing:2, fontFamily:"Georgia,serif", color:"#fff" }}>TASKONA<span style={{ color:C.violet }}>.AI</span></div>
        <nav style={{ display:"flex", gap:3 }}>
          {[["dash","Dashboard"],["week","This Week"],["add","+ Add Post"]].map(([k,l])=>(
            <button key={k} style={css.navBtn(view===k)} onClick={()=>setView(k)}>{l}</button>
          ))}
        </nav>
        <button onClick={()=>{ setEditBuffers({...buffers}); setShowSettings(true); }} style={{ ...css.btn(), padding:"5px 12px", fontSize:11 }}>⚙ Buffer Days</button>
      </header>

      <main style={css.main}>
        {loading && <div style={{ ...css.card, borderColor:"#6c63ff44", color:C.violet2, fontSize:13, display:"flex", alignItems:"center", gap:10, marginBottom:14 }}><span>⚡</span> AI is generating tasks...</div>}

        {view==="dash" && <>
          <div style={{ display:"grid", gridTemplateColumns:"repeat(4,1fr)", gap:12, marginBottom:14 }}>
            {[{n:posts.length,l:"Total Posts",c:C.violet2},{n:todayTasks.length,l:"Due Today",c:todayTasks.length?C.violet:C.green},{n:burning.length,l:"Burning 🔥",c:burning.length?C.red:C.green},{n:weekTasks.length,l:"This Week",c:C.gold}].map((s,i)=>(
              <div key={i} style={css.card}>
                <div style={{ fontSize:30, fontWeight:800, color:s.c, fontFamily:"Georgia,serif" }}>{s.n}</div>
                <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>{s.l}</div>
              </div>
            ))}
          </div>

          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:14 }}>
            <div style={css.card}>
              <div style={css.tag}>Today · {fmtDate(TODAY())}</div>
              {todayTasks.length===0 ? <div style={{ color:C.green, fontSize:13 }}>✓ Nothing due today</div>
                : todayTasks.map(t=>(
                  <div key={t.id} style={css.taskRow("today")} onClick={()=>{setSel(posts.find(p=>p.id===t.post_id));setAnalytics(posts.find(p=>p.id===t.post_id)?.analytics||{});setView("detail");}}>
                    <div style={css.dot("today")}/><div style={{ flex:1 }}><div style={{ fontWeight:600, fontSize:13 }}>{t.title}</div><div style={{ fontSize:11, color:C.muted }}>{t.post_title}</div></div>
                    <span style={css.chip(t.role)}>{t.role}</span>
                    <select value={t.status} onChange={e=>{e.stopPropagation();updateStatus(t.id,e.target.value);}} style={{ background:"#1a1a3a", border:`1px solid #2a2a5a`, color:C.violet2, borderRadius:6, padding:"3px 6px", fontSize:11, cursor:"pointer" }}>
                      {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                ))}
            </div>
            <div style={{ ...css.card, borderColor:burning.length?"#3a101044":C.border }}>
              <div style={{ ...css.tag, color:burning.length?C.red:C.muted }}>🔥 Burning</div>
              {burning.length===0 ? <div style={{ color:C.green, fontSize:13 }}>✓ Nothing burning</div>
                : burning.map(t=>(
                  <div key={t.id} style={css.taskRow("burning")} onClick={()=>{setSel(posts.find(p=>p.id===t.post_id));setAnalytics(posts.find(p=>p.id===t.post_id)?.analytics||{});setView("detail");}}>
                    <div style={css.dot("burning")}/><div style={{ flex:1 }}><div style={{ fontWeight:600, fontSize:13, color:C.red }}>{t.title}</div><div style={{ fontSize:11, color:"#884444" }}>{t.post_title} · {Math.abs(daysDiff(t.due_date))}d overdue</div></div>
                    <span style={css.chip(t.role)}>{t.role}</span>
                    <select value={t.status} onChange={e=>{e.stopPropagation();updateStatus(t.id,e.target.value);}} style={{ background:"#2a0808", border:`1px solid #4a1a1a`, color:C.red, borderRadius:6, padding:"3px 6px", fontSize:11, cursor:"pointer" }}>
                      {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>
                ))}
            </div>
          </div>

          <div style={css.card}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:12 }}>
              <div style={css.tag}>All Posts ({posts.length})</div>
              <button style={css.btn("primary")} onClick={()=>setView("add")}>+ Add Post</button>
            </div>
            {posts.length===0
              ? <div style={{ color:C.muted, fontSize:13, padding:"20px 0", textAlign:"center" }}>No posts yet. Click "+ Add Post" — AI will generate tasks automatically.</div>
              : <table style={{ width:"100%", borderCollapse:"collapse" }}>
                  <thead><tr style={{ borderBottom:`1px solid ${C.border}` }}>{["Post","Type","Platform","Pub Date","Days","Tasks",""].map((h,i)=><th key={i} style={{ textAlign:"left", padding:"7px 10px", fontSize:10, color:C.violet, fontWeight:700, letterSpacing:1 }}>{h}</th>)}</tr></thead>
                  <tbody>
                    {posts.map(p=>{
                      const pt=tasks.filter(t=>t.post_id===p.id), done=pt.filter(t=>t.status==="posted").length, diff=daysDiff(p.pub_date), hasBurning=pt.some(t=>urgency(t)==="burning");
                      return <tr key={p.id} style={{ borderBottom:`1px solid #111130`, cursor:"pointer" }} onClick={()=>{setSel(p);setAnalytics(p.analytics||{});setView("detail");}}>
                        <td style={{ padding:"9px 10px", fontWeight:600 }}>{hasBurning&&<span style={{ color:C.red, marginRight:5 }}>🔥</span>}{p.title}</td>
                        <td style={{ padding:"9px 10px" }}><span style={{ ...css.chip("Designer"), fontSize:10 }}>{p.content_type}</span></td>
                        <td style={{ padding:"9px 10px", color:C.violet2 }}>{p.platform}</td>
                        <td style={{ padding:"9px 10px", color:C.gold }}>{fmtDate(p.pub_date)}</td>
                        <td style={{ padding:"9px 10px" }}><span style={{ color:diff<=0?C.red:diff<=3?"#cc9933":C.green, fontWeight:700 }}>{diff===0?"TODAY":diff<0?`${Math.abs(diff)}d ago`:`${diff}d`}</span></td>
                        <td style={{ padding:"9px 10px", color:C.muted }}>{done}/{pt.length}</td>
                        <td style={{ padding:"9px 10px" }}><button onClick={e=>{e.stopPropagation();deletePost(p.id);}} style={{ ...css.btn("danger"), padding:"3px 9px", fontSize:11 }}>✕</button></td>
                      </tr>;
                    })}
                  </tbody>
                </table>}
          </div>
        </>}

        {view==="week" && <>
          {burning.length>0&&<div style={{ ...css.card, borderColor:"#ef535055", background:"#0d0505", marginBottom:14 }}>
            <div style={{ color:C.red, fontWeight:700, fontSize:13, marginBottom:3 }}>🔥 {burning.length} BURNING — needs immediate attention</div>
            <div style={{ color:"#cc7777", fontSize:12 }}>Mark tasks as posted or missed to clear them.</div>
          </div>}
          <div style={{ display:"grid", gridTemplateColumns:"repeat(7,1fr)", gap:8 }}>
            {Array.from({length:7},(_,i)=>addDays(TODAY(),i)).map(day=>{
              const dt=weekTasks.filter(t=>t.due_date===day), isToday=day===TODAY(), diff=daysDiff(day), isFriday=new Date(day+"T12:00:00").getDay()===5;
              return <div key={day} style={{ background:isToday?"#0d0d2e":"#0a0a1a", border:`1px solid ${isToday?C.violet:isFriday?"#2a1535":"#141428"}`, borderRadius:10, padding:10, minHeight:180 }}>
                <div style={{ fontSize:9, fontWeight:700, color:isToday?C.violet:isFriday?"#9d3eff":C.muted, letterSpacing:1, marginBottom:3 }}>{isToday?"TODAY":new Date(day+"T12:00:00").toLocaleDateString("en-US",{weekday:"short"}).toUpperCase()}{isFriday?" ⚠️":""}</div>
                <div style={{ fontSize:18, fontWeight:800, color:isToday?"#fff":"#8888aa", marginBottom:8 }}>{new Date(day+"T12:00:00").getDate()}</div>
                {dt.length===0 ? <div style={{ fontSize:10, color:"#222233" }}>—</div>
                  : dt.map(t=>{ const urg=urgency(t), endWarn=diff>=5&&urg!=="burning"; return <div key={t.id} style={{ background:urg==="burning"?"#1e0505":endWarn?"#150a05":"#0f0f22", border:`1px solid ${urg==="burning"?"#3a1010":endWarn?"#2a1505":"#1a1a3a"}`, borderRadius:6, padding:"5px 7px", marginBottom:5 }}>
                    <div style={{ fontSize:10, fontWeight:600, color:urg==="burning"?C.red:endWarn?C.gold:"#c0c0e0" }}>{t.title}</div>
                    <div style={{ fontSize:9, color:"#444466", marginTop:2 }}>{t.post_title}</div>
                    <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginTop:4 }}>
                      <span style={{ ...css.chip(t.role), fontSize:8 }}>{t.role}</span>
                      <span style={{ fontSize:9 }}>{urg==="burning"?"🔥":endWarn?"⚠️":""}</span>
                    </div>
                    <select value={t.status} onChange={e=>updateStatus(t.id,e.target.value)} style={{ width:"100%", marginTop:5, background:"#0a0a1a", border:`1px solid #1a1a3a`, color:C.muted, borderRadius:5, padding:"2px 4px", fontSize:9, cursor:"pointer" }}>
                      {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                    </select>
                  </div>; })}
              </div>;
            })}
          </div>
        </>}

        {view==="add" && <div style={{ maxWidth:560 }}>
          <div style={css.card}>
            <div style={css.tag}>New Post</div>
            <div style={{ display:"flex", flexDirection:"column", gap:13 }}>
              <div><div style={{ fontSize:11, color:C.muted, marginBottom:5 }}>Post Title *</div><input style={css.input} placeholder="e.g. Spring Campaign Launch" value={form.title} onChange={e=>setForm({...form,title:e.target.value})}/></div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div><div style={{ fontSize:11, color:C.muted, marginBottom:5 }}>Content Type</div><select style={css.input} value={form.contentType} onChange={e=>setForm({...form,contentType:e.target.value})}>{CTYPES.map(t=><option key={t}>{t}</option>)}</select></div>
                <div><div style={{ fontSize:11, color:C.muted, marginBottom:5 }}>Platform</div><select style={css.input} value={form.platform} onChange={e=>setForm({...form,platform:e.target.value})}>{PLATFORMS.map(p=><option key={p}>{p}</option>)}</select></div>
              </div>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
                <div><div style={{ fontSize:11, color:C.muted, marginBottom:5 }}>Publication Date *</div><input type="date" style={css.input} value={form.pubDate} onChange={e=>setForm({...form,pubDate:e.target.value})}/></div>
                <div><div style={{ fontSize:11, color:C.muted, marginBottom:5 }}>Client</div><input style={css.input} placeholder="e.g. Uzcard" value={form.client} onChange={e=>setForm({...form,client:e.target.value})}/></div>
              </div>
              <div><div style={{ fontSize:11, color:C.muted, marginBottom:5 }}>Brief</div><textarea style={{ ...css.input, resize:"vertical", minHeight:70 }} placeholder="Key message, tone, references..." value={form.description} onChange={e=>setForm({...form,description:e.target.value})}/></div>
              <div style={{ background:"#0a0a1e", border:`1px solid #2a2a55`, borderRadius:8, padding:12 }}>
                <div style={{ fontSize:10, color:C.violet, fontWeight:700, marginBottom:6, letterSpacing:2 }}>TASK LOGIC PREVIEW</div>
                <div style={{ fontSize:12, color:"#8888aa" }}>{form.contentType} → <span style={{ color:C.gold }}>{getBuffer(form.contentType)} days</span> buffer</div>
                <div style={{ fontSize:12, color:"#8888aa", marginTop:3 }}>Prep starts: <span style={{ color:C.green }}>{form.pubDate?fmtDate(addDays(form.pubDate,-getBuffer(form.contentType))):"—"}</span></div>
                <div style={{ fontSize:12, color:"#8888aa", marginTop:3 }}>Publishes: <span style={{ color:C.gold }}>{form.pubDate?fmtDate(form.pubDate):"—"}</span></div>
              </div>
              <div style={{ display:"flex", gap:10 }}>
                <button style={css.btn("primary")} onClick={addPost} disabled={loading}>{loading?"⚡ Generating...":"✦ Add Post & Generate Tasks"}</button>
                <button style={css.btn()} onClick={()=>setView("dash")}>Cancel</button>
              </div>
            </div>
          </div>
        </div>}

        {view==="detail" && selPost && <>
          <button style={{ ...css.btn(), marginBottom:14, fontSize:12 }} onClick={()=>setView("dash")}>← Back</button>
          <div style={{ ...css.card, borderColor:"#2a2a5a" }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:14 }}>
              <div>
                <div style={{ fontSize:20, fontWeight:800, color:"#fff", fontFamily:"Georgia,serif" }}>{selPost.title}</div>
                <div style={{ color:C.muted, fontSize:12, marginTop:4 }}>{selPost.platform} · {selPost.content_type} · <span style={{ color:C.gold }}>{fmtDate(selPost.pub_date)}</span>{selPost.client&&<span style={{ color:C.violet2 }}> · {selPost.client}</span>}</div>
              </div>
              <button style={{ ...css.btn("danger"), fontSize:12 }} onClick={()=>deletePost(selPost.id)}>Delete</button>
            </div>
            <div style={css.tag}>Tasks</div>
            {tasks.filter(t=>t.post_id===selPost.id).sort((a,b)=>new Date(a.due_date)-new Date(b.due_date)).map(t=>{
              const urg=urgency(t);
              return <div key={t.id} style={css.taskRow(urg)}>
                <div style={css.dot(urg)}/><div style={{ flex:1 }}><div style={{ fontWeight:600, color:urg==="burning"?C.red:"#e0e0f0" }}>{t.title}</div><div style={{ fontSize:11, color:C.muted }}>Due: {fmtDate(t.due_date)}{urg==="burning"&&<span style={{ color:C.red }}> · OVERDUE {Math.abs(daysDiff(t.due_date))}d 🔥</span>}{urg==="today"&&<span style={{ color:C.violet }}> · DUE TODAY</span>}</div></div>
                <span style={css.chip(t.role)}>{t.role}</span>
                <select value={t.status} onChange={e=>updateStatus(t.id,e.target.value)} style={{ background:"#1a1a3a", border:`1px solid #2a2a5a`, color:C.violet2, borderRadius:6, padding:"5px 8px", fontSize:12, cursor:"pointer" }}>
                  {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
                </select>
              </div>;
            })}
          </div>
          <div style={css.card}>
            <div style={css.tag}>Post Analytics</div>
            {analytics.er&&<div style={{ display:"flex", gap:24, marginBottom:14 }}>{[{v:`${analytics.er}%`,l:"ER",c:C.violet},{v:(+analytics.views||0).toLocaleString(),l:"Views",c:C.green},{v:(+analytics.likes||0).toLocaleString(),l:"Likes",c:C.gold}].map((s,i)=><div key={i}><div style={{ fontSize:26, fontWeight:800, color:s.c, fontFamily:"Georgia,serif" }}>{s.v}</div><div style={{ fontSize:11, color:C.muted }}>{s.l}</div></div>)}</div>}
            <div style={{ display:"grid", gridTemplateColumns:"repeat(3,1fr)", gap:10, marginBottom:12 }}>
              {[{k:"link",l:"Post URL",p:"https://"},{k:"views",l:"Views",p:"0"},{k:"likes",l:"Likes",p:"0"},{k:"comments",l:"Comments",p:"0"},{k:"reposts",l:"Reposts",p:"0"},{k:"saves",l:"Saves",p:"0"},{k:"clicks",l:"Clicks",p:"0"}].map(f=>(
                <div key={f.k}><div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>{f.l}</div><input style={css.input} placeholder={f.p} value={analytics[f.k]||""} onChange={e=>setAnalytics({...analytics,[f.k]:e.target.value})}/></div>
              ))}
            </div>
            <button style={css.btn("green")} onClick={saveAnalytics}>Save Analytics</button>
          </div>
        </>}
      </main>
    </div>
  );
}
