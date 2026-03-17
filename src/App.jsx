import { useState, useEffect, useRef } from "react";
import { createClient } from "@supabase/supabase-js";

const SUPABASE_URL = "https://ukrfnapkypperwvmgiie.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InVrcmZuYXBreXBwZXJ3dm1naWllIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzM1OTkwMTgsImV4cCI6MjA4OTE3NTAxOH0.hw6jZLKbxOKpjTkyDFMwPiwBenE4iHc-FqKsR7OB-Bw";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

function getUserId() {
  try {
    const tg = window.Telegram?.WebApp?.initDataUnsafe?.user;
    if (tg?.id) return String(tg.id);
  } catch {}
  // Check if opened via invite link
  const params = new URLSearchParams(window.location.search);
  const inviteId = params.get("invite");
  if (inviteId) {
    localStorage.setItem("taskona_uid", inviteId);
    return inviteId;
  }
  let uid = localStorage.getItem("taskona_uid");
  if (!uid) { uid = "user_" + Math.random().toString(36).slice(2); localStorage.setItem("taskona_uid", uid); }
  return uid;
}

const isMobile = () => window.innerWidth < 768 || !!window.Telegram?.WebApp?.initData;

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
const CP_STATUSES = {
  draft:    { label:"Draft",            color:"#9d97ff", bg:"#9d97ff22" },
  sent:     { label:"Sent to Client",   color:"#c4956a", bg:"#c4956a22" },
  approved: { label:"Approved ✓",       color:"#00C853", bg:"#00C85322" },
  active:   { label:"In Tasks",         color:"#6c63ff", bg:"#6c63ff22" }
};

function urgency(task) {
  const d = daysDiff(task.due_date);
  if (task.status==="missed"||(d<0&&task.status!=="posted")) return "burning";
  if (d===0) return "today";
  if (d<=2) return "urgent";
  return "normal";
}

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

  // ── CONTENT PLAN STATE ────────────────────────────────────────────────────
  const [contentPlans, setContentPlans] = useState([]);
  const [cpStep, setCpStep] = useState("list"); // list | brief | generating | ideas | detail
  const [cpBrief, setCpBrief] = useState({ niche:"", goals:"", platform:"Instagram", numPosts:10, periodDays:30, pageStatus:"existing", followers:"", existingRubrics:"", infoReasons:"" });
  const [cpFiles, setCpFiles] = useState([]); // uploaded PDFs
  const [cpFilesText, setCpFilesText] = useState(""); // extracted text from PDFs
  const [cpIdeas, setCpIdeas] = useState([]);
  const [cpLoading, setCpLoading] = useState(false);
  const [activePlan, setActivePlan] = useState(null);
  const [editingIdea, setEditingIdea] = useState(null);

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
    const { data: cp } = await supabase.from("content_plans").select("*").eq("user_id", userId).order("created_at", { ascending:false });
    if (p) setPosts(p);
    if (t) setTasks(t);
    if (b?.settings) { setBuffers(b.settings); setEditBuffers(b.settings); }
    if (cp) setContentPlans(cp);
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
      const res = await fetch("/api/generate", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-5", max_tokens:600,
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

  // ── GENERATE CONTENT PLAN (smart fallback) ───────────────────────────────
  const generateFallbackPlan = (niche, goals, platform, numPosts, periodDays, pageStatus, infoReasons) => {
    const isNew = pageStatus === "new";
    const templates = [
      { type:"Graphic",   goal:"awareness",  titles: isNew ? ["Знакомство с брендом","О нас — кто мы и чем занимаемся","Наша история","Наша команда","Наши ценности"] : ["Новинка недели","Подборка лучшего","Топ продуктов сезона","Факт о бренде","За кадром"] },
      { type:"Carousel",  goal:"engagement", titles:["5 причин выбрать нас","Топ продуктов этого сезона","Как мы работаем — пошагово","До и после","FAQ — частые вопросы"] },
      { type:"Video",     goal:"awareness",  titles:["Закулисье производства","Один день из жизни бренда","Как создаётся продукт","Обзор новинок","Отзыв клиента"] },
      { type:"Reel",      goal:"engagement", titles:["Быстрый лайфхак","Тренд недели","Трансформация за 15 секунд","Ответ на вопрос подписчика","Вдохновение дня"] },
      { type:"Text post", goal:"trust",      titles:["История клиента","Почему мы это делаем","Наша философия","Честно о сложностях","Благодарность подписчикам"] },
      { type:"Graphic",   goal:"sales",      titles:["Акция недели","Новинка в ассортименте","Специальное предложение","Хит продаж","Подборка для вас"] },
      { type:"Carousel",  goal:"trust",      titles:["Отзывы наших клиентов","Результаты за месяц","Наши сертификаты и достижения","Материалы и качество","Сравнение с аналогами"] },
      { type:"Story",     goal:"engagement", titles:["Опрос — что вам интереснее?","Викторина о продукте","За кулисами сегодня","Угадай новинку","Голосование"] },
    ];
    const captions = {
      awareness:  `Рассказываем о ${niche} — подписывайтесь, чтобы не пропустить новое!`,
      engagement: `Сохрани себе и поделись с теми, кому это будет полезно 👇`,
      sales:      `Успей воспользоваться предложением — пиши в Direct или жми ссылку в профиле`,
      trust:      `Нам важно ваше доверие. Спасибо, что вы с нами ❤️`,
    };
    const interval = Math.floor(periodDays / numPosts);
    const posts = [];
    for (let i = 0; i < numPosts; i++) {
      const tpl = templates[i % templates.length];
      const titleVariants = tpl.titles;
      const title = titleVariants[Math.floor(i / templates.length) % titleVariants.length];
      posts.push({
        id: `idea_${i}`,
        title: title,
        type: tpl.type,
        date: addDays(TODAY(), (i + 1) * interval),
        caption: captions[tpl.goal],
        goal: tpl.goal,
        platform: platform,
      });
    }
    return posts;
  };

  const generateContentPlan = async () => {
    if (!cpBrief.niche) return notify("Enter niche/business", true);
    setCpLoading(true);
    setCpStep("generating");
    try {
      const startDate = addDays(TODAY(), 1);
      const endDate = addDays(TODAY(), cpBrief.periodDays);
      const res = await fetch("/api/generate", {
        method:"POST", headers:{"Content-Type":"application/json"},
        body: JSON.stringify({
          model:"claude-sonnet-4-5", max_tokens:3000,
          messages:[{ role:"user", content:`You are an expert SMM content strategist. Create a content plan. Reply ONLY with a valid JSON array, no explanation, no markdown, no code blocks.
Niche/Business: ${cpBrief.niche}
Goals: ${cpBrief.goals || "increase engagement and followers"}
Platform: ${cpBrief.platform}
Number of posts: ${cpBrief.numPosts}
Period: ${startDate} to ${endDate}
Today: ${TODAY()}
Page status: ${cpBrief.pageStatus === "new" ? "NEW page — include introductory content like brand intro, meet the team, our story" : `EXISTING page with ${cpBrief.followers||"unknown"} followers — skip intro posts, focus on engagement, value, sales. Existing rubrics: ${cpBrief.existingRubrics||"unknown"}`}
${cpBrief.infoReasons ? `Key dates & info occasions: ${cpBrief.infoReasons}` : ""}
${cpFilesText ? `Brand guidelines from uploaded files:\n${cpFilesText.slice(0,2000)}` : ""}
Generate exactly ${cpBrief.numPosts} posts spread evenly across the period. Mix content types: Graphic, Video, Carousel, Reel, Story, Text post.
Output ONLY a JSON array:
[{"title":"Post title","type":"Graphic","date":"YYYY-MM-DD","caption":"Short caption 1-2 sentences","goal":"awareness"}]` }]
        })
      });
      const data = await res.json();
      if (data.error) throw new Error(data.error.message);
      const raw = data.content?.[0]?.text || "";
      const match = raw.match(/\[[\s\S]*\]/);
      if (!match) throw new Error("No JSON");
      const parsed = JSON.parse(match[0]);
      if (!Array.isArray(parsed) || parsed.length === 0) throw new Error("Empty");
      setCpIdeas(parsed.map((idea,i) => ({ ...idea, id:`idea_${i}`, platform:cpBrief.platform })));
    } catch {
      // Fallback — smart template plan
      const fallback = generateFallbackPlan(cpBrief.niche, cpBrief.goals, cpBrief.platform, cpBrief.numPosts, cpBrief.periodDays, cpBrief.pageStatus, cpBrief.infoReasons);
      setCpIdeas(fallback);
      notify("Plan generated from templates — edit as needed ✓");
    }
    setCpStep("ideas");
    setCpLoading(false);
  };

  // ── SAVE CONTENT PLAN ─────────────────────────────────────────────────────
  const saveContentPlan = async (status = "draft") => {
    const planId = Date.now().toString();
    const plan = { id:planId, user_id:userId, niche:cpBrief.niche, goals:cpBrief.goals, platform:cpBrief.platform, posts:cpIdeas, status, created_at:TODAY() };
    await supabase.from("content_plans").insert(plan);
    setContentPlans(cp => [plan, ...cp]);
    notify(status==="sent" ? "Downloaded & saved as Sent ✓" : "Draft saved ✓");
    setCpStep("list"); setCpIdeas([]);
    setCpBrief({ niche:"", goals:"", platform:"Instagram", numPosts:10, periodDays:30, pageStatus:"existing", followers:"", existingRubrics:"", infoReasons:"" });
    setCpFiles([]); setCpFilesText("");
    return plan;
  };

  // ── DOWNLOAD PLAN AS CSV ──────────────────────────────────────────────────
  const downloadPlan = (plan, ideas) => {
    const rows = ideas || plan.posts || [];
    let csv = "Title,Type,Platform,Date,Caption,Goal\n";
    rows.forEach(p => { csv += `"${p.title}","${p.type}","${p.platform||plan.platform}","${p.date}","${(p.caption||"").replace(/"/g,"'")}","${p.goal}"\n`; });
    const blob = new Blob([csv], { type:"text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url; a.download = `content-plan-${(plan.niche||"taskona").replace(/\s+/g,"-")}.csv`;
    a.click(); URL.revokeObjectURL(url);
  };

  const updatePlanStatus = async (planId, status) => {
    await supabase.from("content_plans").update({ status }).eq("id", planId);
    setContentPlans(cp => cp.map(p => p.id===planId ? {...p,status} : p));
    setActivePlan(ap => ap?.id===planId ? {...ap,status} : ap);
  };

  // ── APPROVE & CONVERT TO TASKS ────────────────────────────────────────────
  const approveAndConvert = async (plan) => {
    const planPosts = plan.posts || [];
    notify(`Converting ${planPosts.length} posts to tasks...`);
    const allPosts = [], allTasks = [];
    for (let i = 0; i < planPosts.length; i++) {
      const idea = planPosts[i];
      const postId = `${plan.id}_${i}`;
      const buf = getBuffer(idea.type || "Graphic");
      const newPost = { id:postId, title:idea.title, content_type:idea.type||"Graphic", platform:idea.platform||plan.platform||"Instagram", pub_date:idea.date, client:"", description:idea.caption||"", created_at:TODAY(), analytics:null, user_id:userId };
      const newTasks = await generateTasks({ title:idea.title, contentType:idea.type||"Graphic", platform:idea.platform||plan.platform||"Instagram", pubDate:idea.date, client:"" }, postId, buf);
      allPosts.push(newPost); allTasks.push(...newTasks);
    }
    await supabase.from("posts").insert(allPosts);
    await supabase.from("tasks").insert(allTasks);
    setPosts(p => [...p, ...allPosts]);
    setTasks(t => [...t, ...allTasks]);
    await updatePlanStatus(plan.id, "active");
    notify(`✓ ${allPosts.length} posts added to tasks!`);
    setView("dash");
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
    setImportLoading(true); setImportProgress("Reading file...");
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
        const newPost = { id:postId, title:row.title, content_type:row.type||"Graphic", platform:row.platform||"Instagram", pub_date:row.date, client:row.client||"", description:row.description||"", created_at:TODAY(), analytics:null, user_id:userId };
        const newTasks = await generateTasks({ title:row.title, contentType:row.type||"Graphic", platform:row.platform||"Instagram", pubDate:row.date, client:row.client||"" }, postId, buf);
        allPosts.push(newPost); allTasks.push(...newTasks);
        await new Promise(r => setTimeout(r, 300));
      }
      await supabase.from("posts").insert(allPosts);
      await supabase.from("tasks").insert(allTasks);
      setPosts(p => [...p, ...allPosts]); setTasks(t => [...t, ...allTasks]);
      notify(`✓ ${allPosts.length} posts imported, ${allTasks.length} tasks generated!`);
      setView("dash");
    } catch { notify("Import failed. Check file format.", true); }
    setImportLoading(false); setImportProgress(""); e.target.value = "";
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

  const updatePostDate = async (postId, newDate) => {
    await supabase.from("posts").update({ pub_date:newDate }).eq("id", postId);
    setPosts(p => p.map(x => x.id===postId ? {...x, pub_date:newDate} : x));
    setSel(s => s?.id===postId ? {...s, pub_date:newDate} : s);
    notify("Date updated ✓");
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
          <select value={t.status} onChange={e=>{e.stopPropagation();updateStatus(t.id,e.target.value);}} style={{ background:"#1a1a3a", border:`1px solid #2a2a5a`, color:C.violet2, borderRadius:8, padding:"4px 8px", fontSize:11, cursor:"pointer" }}>
            {Object.entries(STATUSES).map(([k,v])=><option key={k} value={k}>{v}</option>)}
          </select>
        </div>
      </div>
    );
  };

  const inp = { width:"100%", background:"#0d0d2b", border:`1px solid #2a2a55`, borderRadius:10, padding:mobile?"12px 14px":"9px 12px", color:C.text, fontSize:mobile?15:13, outline:"none", boxSizing:"border-box" };
  const sel_style = { ...inp };
  const btn = (v) => ({ padding:mobile?"14px":"9px 18px", borderRadius:mobile?12:8, border:"none", cursor:"pointer", fontWeight:800, fontSize:mobile?15:13, background:v==="primary"?C.violet:v==="danger"?"#2a0808":v==="green"?"#0a2a1a":v==="gold"?"#2a1a08":"#1a1a3a", color:v==="primary"?C.white:v==="danger"?C.red:v==="green"?C.green:v==="gold"?C.gold:"#aaaacc" });

  const ImportSection = () => (
    <div style={{ background:"#0a0a1e", border:`1px solid ${C.violet}44`, borderRadius:12, padding:16, marginBottom:16 }}>
      <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:8, textTransform:"uppercase" }}>📥 Import Monthly Plan</div>
      <div style={{ fontSize:12, color:C.muted, marginBottom:10 }}>Upload a CSV: <span style={{ color:C.violet2 }}>Title, Type, Platform, Date, Client</span></div>
      {importLoading ? (
        <div style={{ color:C.violet2, fontSize:13, padding:"10px 0" }}>⚡ {importProgress}</div>
      ) : (
        <label style={{ display:"block", cursor:"pointer" }}>
          <div style={{ ...btn("primary"), textAlign:"center", borderRadius:10 }}>📂 Choose CSV File</div>
          <input type="file" accept=".csv,.txt" onChange={importFromFile} style={{ display:"none" }}/>
        </label>
      )}
      <div style={{ fontSize:11, color:"#444466", marginTop:8 }}>
        💡 <a href="https://docs.google.com/spreadsheets" target="_blank" rel="noreferrer" style={{ color:"#555577" }}>Google Sheets</a> → File → Download → CSV
      </div>
    </div>
  );

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
          <div style={{ display:"flex", alignItems:"center", gap:10 }}>
            <img src="/logo.png" style={{ height:36, width:36, borderRadius:10 }} alt="Taskona"/>
            <span style={{ fontSize:22, fontWeight:800, color:C.white, fontFamily:"Georgia,serif" }}>TASKONA<span style={{ color:C.violet }}>.AI</span></span>
          </div>
          <div style={{ fontSize:12, color:C.muted }}>{fmtDate(TODAY())}</div>
        </div>
      )}
      <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr 1fr":"repeat(4,1fr)", gap:10, marginBottom:16 }}>
        {[{n:posts.length,l:"Total Posts",c:C.violet2,icon:"📋"},{n:todayTasks.length,l:"Due Today",c:todayTasks.length?C.violet:C.green,icon:"📅"},{n:burning.length,l:"Burning",c:burning.length?C.red:C.green,icon:"🔥"},{n:weekTasks.length,l:"This Week",c:C.gold,icon:"📆"}].map((s,i)=>(
          <div key={i} style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:14, padding:"14px 16px" }}>
            <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>{s.icon} {s.l}</div>
            <div style={{ fontSize:mobile?28:30, fontWeight:800, color:s.c, fontFamily:"Georgia,serif" }}>{s.n}</div>
          </div>
        ))}
      </div>
      <div style={{ display:mobile?"block":"grid", gridTemplateColumns:"1fr 1fr", gap:16 }}>
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
        <div>
          <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:10, textTransform:"uppercase" }}>All Posts ({posts.length})</div>
          {posts.length===0
            ? <div style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:12, padding:20, color:C.muted, fontSize:13, textAlign:"center" }}>No posts yet.<br/>Import a plan or tap + to add a post.</div>
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
                </div>;
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
              <div style={{ color:C.muted, fontSize:12, marginTop:4, display:"flex", alignItems:"center", gap:6, flexWrap:"wrap" }}>
                <span>{selPost.platform} · {selPost.content_type}</span>
                <span style={{ color:"#444466" }}>·</span>
                <input type="date" value={selPost.pub_date} onChange={e=>updatePostDate(selPost.id, e.target.value)}
                  style={{ background:"#1a1a3a", border:`1px solid #3a3a6a`, borderRadius:6, padding:"2px 8px", color:C.gold, fontSize:12, cursor:"pointer", outline:"none" }}/>
              </div>
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

  // ── CONTENT PLAN VIEW ─────────────────────────────────────────────────────
  // ── EXTRACT TEXT FROM PDF ────────────────────────────────────────────────
  const extractPdfText = async (file) => {
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          // Simple text extraction — read as text, strip non-printable
          const text = e.target.result;
          const clean = text.replace(/[^\x20-\x7E\n\r\u0400-\u04FF]/g," ").replace(/\s+/g," ").trim().slice(0,3000);
          resolve(clean);
        } catch { resolve(""); }
      };
      reader.readAsText(file, "utf-8");
    });
  };

  const handleCpFiles = async (e) => {
    const files = Array.from(e.target.files);
    setCpFiles(files);
    notify("Reading files...");
    let combined = "";
    for (const file of files) {
      const text = await extractPdfText(file);
      combined += `\n--- ${file.name} ---\n${text}`;
    }
    setCpFilesText(combined);
    notify(`✓ ${files.length} file(s) loaded`);
  };

  const nicheRef = useRef(null);
  useEffect(() => {
    if (cpStep === "brief") setTimeout(() => nicheRef.current?.focus(), 50);
  }, [cpStep]);

  const ContentPlanView = () => {

    if (cpStep === "list") return (
      <div style={{ padding:mobile?"16px 16px 80px":"24px" }}>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:20 }}>
          <div style={{ fontSize:mobile?18:22, fontWeight:800, color:C.white, fontFamily:"Georgia,serif" }}>Content Plans</div>
          <button onClick={()=>setCpStep("brief")} style={{ ...btn("primary"), padding:"8px 16px", fontSize:13 }}>+ New Plan</button>
        </div>
        {contentPlans.length === 0 ? (
          <div style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:14, padding:32, textAlign:"center" }}>
            <div style={{ fontSize:36, marginBottom:12 }}>📋</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>No content plans yet</div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>AI will brainstorm post ideas, you edit → send to client → approve → convert to tasks</div>
            <button onClick={()=>setCpStep("brief")} style={{ ...btn("primary") }}>Create First Plan</button>
          </div>
        ) : contentPlans.map(plan => {
          const st = CP_STATUSES[plan.status] || CP_STATUSES.draft;
          return (
            <div key={plan.id} onClick={()=>{ setActivePlan(plan); setCpStep("detail"); }} style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:14, padding:"14px 16px", marginBottom:10, cursor:"pointer" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
                <div style={{ flex:1 }}>
                  <div style={{ fontWeight:700, fontSize:14, color:C.text }}>{plan.niche}</div>
                  <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>{plan.platform} · {plan.posts?.length||0} posts · {fmtDate(plan.created_at)}</div>
                </div>
                <span style={{ fontSize:11, padding:"4px 10px", borderRadius:20, background:st.bg, color:st.color, fontWeight:700, flexShrink:0 }}>{st.label}</span>
              </div>
            </div>
          );
        })}
      </div>
    );

    if (cpStep === "brief") return (
      <div style={{ padding:mobile?"16px 16px 80px":"24px", maxWidth:mobile?"100%":560 }}>
        <button onClick={()=>setCpStep("list")} style={{ background:"none", border:"none", color:C.violet, fontSize:13, fontWeight:700, cursor:"pointer", padding:"0 0 16px" }}>← Back</button>
        <div style={{ fontSize:mobile?18:20, fontWeight:800, color:C.white, fontFamily:"Georgia,serif", marginBottom:4 }}>New Content Plan</div>
        <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>AI brainstorms → you edit → send to client → approve → convert to tasks</div>
        <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
          <div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Niche / Business *</div>
            <input ref={nicheRef} style={inp} placeholder="e.g. Fitness studio in Tashkent" value={cpBrief.niche} onChange={e=>setCpBrief({...cpBrief,niche:e.target.value})}/>
          </div>
          <div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Goals</div>
            <input style={inp} placeholder="e.g. increase followers, drive bookings" value={cpBrief.goals} onChange={e=>setCpBrief({...cpBrief,goals:e.target.value})}/>
          </div>
          <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
            <div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Platform</div>
              <select style={sel_style} value={cpBrief.platform} onChange={e=>setCpBrief({...cpBrief,platform:e.target.value})}>
                {PLATFORMS.map(p=><option key={p}>{p}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Number of Posts</div>
              <select style={sel_style} value={cpBrief.numPosts} onChange={e=>setCpBrief({...cpBrief,numPosts:+e.target.value})}>
                {[5,8,10,12,15,20].map(n=><option key={n} value={n}>{n} posts</option>)}
              </select>
            </div>
          </div>
          <div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Period</div>
            <select style={sel_style} value={cpBrief.periodDays} onChange={e=>setCpBrief({...cpBrief,periodDays:+e.target.value})}>
              {[14,21,30,60].map(n=><option key={n} value={n}>{n} days</option>)}
            </select>
          </div>
          <div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Page Status</div>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:8 }}>
              {[{v:"new",l:"🆕 New page"},{v:"existing",l:"📈 Already active"}].map(o=>(
                <div key={o.v} onClick={()=>setCpBrief({...cpBrief,pageStatus:o.v})} style={{ padding:"10px 14px", borderRadius:10, border:`2px solid ${cpBrief.pageStatus===o.v?C.violet:"#2a2a55"}`, background:cpBrief.pageStatus===o.v?"#1a1a4a":"#0d0d2b", cursor:"pointer", fontSize:13, fontWeight:cpBrief.pageStatus===o.v?700:400, color:cpBrief.pageStatus===o.v?C.white:C.muted, textAlign:"center" }}>
                  {o.l}
                </div>
              ))}
            </div>
          </div>
          {cpBrief.pageStatus==="existing" && <>
            <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:12 }}>
              <div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Followers</div>
                <input style={inp} placeholder="e.g. 12000" value={cpBrief.followers} onChange={e=>setCpBrief({...cpBrief,followers:e.target.value})}/>
              </div>
              <div>
                <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>Existing Rubrics</div>
                <input style={inp} placeholder="e.g. tips, reviews, promo" value={cpBrief.existingRubrics} onChange={e=>setCpBrief({...cpBrief,existingRubrics:e.target.value})}/>
              </div>
            </div>
          </>}
          <div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>📅 Инфоповоды / Events</div>
            <textarea style={{ ...inp, resize:"vertical", minHeight:70 }} placeholder="e.g. 8 марта, Новруз 21 марта, скидка 20% с 1-15 апреля, открытие нового филиала 10 апреля..." value={cpBrief.infoReasons} onChange={e=>setCpBrief({...cpBrief,infoReasons:e.target.value})}/>
          </div>
          <div>
            <div style={{ fontSize:12, color:C.muted, marginBottom:6 }}>📎 Brand files (PDF) — брендбук, TOV, гайды</div>
            <label style={{ display:"block", cursor:"pointer" }}>
              <div style={{ background:"#0a0a1e", border:`2px dashed ${cpFiles.length?C.violet:"#2a2a55"}`, borderRadius:10, padding:"14px", textAlign:"center", color:cpFiles.length?C.violet2:C.muted, fontSize:13 }}>
                {cpFiles.length ? `✓ ${cpFiles.map(f=>f.name).join(", ")}` : "Click to upload PDF files"}
              </div>
              <input type="file" accept=".pdf,.txt,.doc" multiple onChange={handleCpFiles} style={{ display:"none" }}/>
            </label>
          </div>
          <button onClick={generateContentPlan} disabled={cpLoading} style={{ ...btn("primary"), width:"100%" }}>
            ✦ Generate with AI
          </button>
        </div>
      </div>
    );

    if (cpStep === "generating") return (
      <div style={{ padding:"60px 24px", textAlign:"center" }}>
        <div style={{ fontSize:48, marginBottom:16 }}>🤖</div>
        <div style={{ fontSize:18, fontWeight:800, color:C.white, marginBottom:8 }}>AI is brainstorming...</div>
        <div style={{ fontSize:13, color:C.muted }}>Generating {cpBrief.numPosts} post ideas for<br/><span style={{ color:C.violet2 }}>{cpBrief.niche}</span></div>
        <div style={{ marginTop:28, display:"flex", justifyContent:"center", gap:8 }}>
          {[0,1,2].map(i=><div key={i} style={{ width:10, height:10, borderRadius:"50%", background:C.violet, opacity:0.3+(i*0.35) }}/>)}
        </div>
      </div>
    );

    if (cpStep === "ideas") return (
      <div style={{ padding:mobile?"16px 16px 80px":"24px" }}>
        <button onClick={()=>setCpStep("brief")} style={{ background:"none", border:"none", color:C.violet, fontSize:13, fontWeight:700, cursor:"pointer", padding:"0 0 8px" }}>← Back</button>
        <div style={{ display:"flex", justifyContent:"space-between", alignItems:"center", marginBottom:8 }}>
          <div>
            <div style={{ fontSize:mobile?16:18, fontWeight:800, color:C.white, fontFamily:"Georgia,serif" }}>{cpBrief.niche}</div>
            <div style={{ fontSize:12, color:C.muted }}>{cpIdeas.length} posts · {cpBrief.platform}</div>
          </div>
        </div>
        <div style={{ background:"#0a0a1e", border:`1px solid #2a2a45`, borderRadius:12, padding:"10px 14px", marginBottom:14, fontSize:12, color:C.muted }}>
          💡 Tap any post to edit or delete · When ready — download & send to client
        </div>
        <div style={{ display:"flex", gap:10, marginBottom:16, flexWrap:"wrap" }}>
          <button onClick={()=>{ const tmp={id:"tmp",niche:cpBrief.niche,platform:cpBrief.platform,posts:cpIdeas}; downloadPlan(tmp); saveContentPlan("sent"); }} style={{ ...btn("gold"), flex:1, minWidth:140 }}>📥 Download & Send to Client</button>
          <button onClick={()=>saveContentPlan("draft")} style={{ ...btn(), flex:1, minWidth:100 }}>💾 Save Draft</button>
        </div>
        {cpIdeas.map((idea, i) => (
          editingIdea === i ? (
            <div key={i} style={{ background:"#0d0d2b", border:`2px solid ${C.violet}`, borderRadius:14, padding:16, marginBottom:10 }}>
              <div style={{ fontSize:11, color:C.violet, fontWeight:700, marginBottom:8 }}>EDITING POST {i+1}</div>
              <input style={{ ...inp, marginBottom:10 }} placeholder="Title" value={idea.title} onChange={e=>{ const n=[...cpIdeas]; n[i]={...n[i],title:e.target.value}; setCpIdeas(n); }}/>
              <div style={{ display:"grid", gridTemplateColumns:"1fr 1fr", gap:10, marginBottom:10 }}>
                <select style={sel_style} value={idea.type} onChange={e=>{ const n=[...cpIdeas]; n[i]={...n[i],type:e.target.value}; setCpIdeas(n); }}>{CTYPES.map(t=><option key={t}>{t}</option>)}</select>
                <input type="date" style={{ ...inp, colorScheme:"dark", cursor:"pointer" }} value={idea.date} onChange={e=>{ const n=[...cpIdeas]; n[i]={...n[i],date:e.target.value}; setCpIdeas(n); }}/>
              </div>
              <textarea style={{ ...inp, resize:"vertical", minHeight:60, marginBottom:10 }} placeholder="Caption idea" value={idea.caption} onChange={e=>{ const n=[...cpIdeas]; n[i]={...n[i],caption:e.target.value}; setCpIdeas(n); }}/>
              <input style={{ ...inp, marginBottom:10 }} placeholder="🔗 Reference URL (inspo, example post...)" value={idea.ref||""} onChange={e=>{ const n=[...cpIdeas]; n[i]={...n[i],ref:e.target.value}; setCpIdeas(n); }}/>
              <div style={{ display:"flex", gap:8 }}>
                <button onClick={()=>setEditingIdea(null)} style={{ ...btn("primary"), flex:1, padding:"10px" }}>✓ Done</button>
                <button onClick={()=>{ setCpIdeas(cpIdeas.filter((_,j)=>j!==i)); setEditingIdea(null); }} style={{ ...btn("danger"), padding:"10px 16px" }}>🗑</button>
              </div>
            </div>
          ) : (
            <div key={i} onClick={()=>setEditingIdea(i)} style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:12, padding:"12px 14px", marginBottom:8, cursor:"pointer" }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                <div style={{ fontWeight:700, fontSize:13, color:C.text, flex:1, marginRight:8 }}>{i+1}. {idea.title}</div>
                <div style={{ display:"flex", gap:5, flexShrink:0 }}>
                  <span style={{ fontSize:10, padding:"2px 7px", borderRadius:6, background:"#1a1a3a", color:C.violet2 }}>{idea.type}</span>
                  <span style={{ fontSize:10, padding:"2px 7px", borderRadius:6, background:idea.goal==="sales"?"#2a0a0a":idea.goal==="engagement"?"#0a1020":"#0a1a0a", color:idea.goal==="sales"?C.red:idea.goal==="engagement"?C.violet2:C.green }}>{idea.goal}</span>
                </div>
              </div>
              <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>📅 {fmtDate(idea.date)}</div>
              <div style={{ fontSize:11, color:"#888899" }}>{idea.caption}</div>
              {idea.ref&&<a href={idea.ref} target="_blank" rel="noreferrer" style={{ fontSize:11, color:C.violet, marginTop:4, display:"block" }}>🔗 {idea.ref}</a>}
            </div>
          )
        ))}
      </div>
    );

    if (cpStep === "detail" && activePlan) {
      const st = CP_STATUSES[activePlan.status] || CP_STATUSES.draft;
      return (
        <div style={{ padding:mobile?"16px 16px 80px":"24px" }}>
          <button onClick={()=>{ setActivePlan(null); setCpStep("list"); }} style={{ background:"none", border:"none", color:C.violet, fontSize:13, fontWeight:700, cursor:"pointer", padding:"0 0 12px" }}>← Back</button>
          <div style={{ background:"#0f0f2e", border:`1px solid #2a2a5a`, borderRadius:14, padding:16, marginBottom:16 }}>
            <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start" }}>
              <div>
                <div style={{ fontSize:mobile?16:18, fontWeight:800, color:C.white, fontFamily:"Georgia,serif" }}>{activePlan.niche}</div>
                <div style={{ fontSize:12, color:C.muted, marginTop:3 }}>{activePlan.platform} · {activePlan.posts?.length||0} posts · {fmtDate(activePlan.created_at)}</div>
              </div>
              <span style={{ fontSize:11, padding:"4px 10px", borderRadius:20, background:st.bg, color:st.color, fontWeight:700 }}>{st.label}</span>
            </div>
          </div>

          {/* Status flow */}
          <div style={{ display:"flex", gap:8, marginBottom:16, flexWrap:"wrap" }}>
            {(activePlan.status==="draft"||activePlan.status==="sent") && (
              <button onClick={()=>downloadPlan(activePlan)} style={{ ...btn("gold"), flex:1 }}>📥 Download CSV</button>
            )}
            {activePlan.status==="draft" && (
              <button onClick={()=>updatePlanStatus(activePlan.id,"sent")} style={{ ...btn(), flex:1 }}>📤 Mark as Sent</button>
            )}
            {activePlan.status==="sent" && (
              <button onClick={()=>updatePlanStatus(activePlan.id,"approved")} style={{ ...btn("green"), flex:1 }}>✓ Client Approved</button>
            )}
            {activePlan.status==="sent" && (
              <button onClick={()=>{ setCpIdeas(activePlan.posts||[]); setCpStep("ideas"); }} style={{ ...btn(), flex:1 }}>✏️ Edit & Resend</button>
            )}
            {activePlan.status==="approved" && (
              <button onClick={()=>approveAndConvert(activePlan)} style={{ ...btn("primary"), flex:1 }}>🚀 Send to Tasks</button>
            )}
            {activePlan.status==="approved" && (
              <button onClick={()=>{ setCpIdeas(activePlan.posts||[]); setCpStep("ideas"); }} style={{ ...btn(), flex:1 }}>✏️ Edit First</button>
            )}
          </div>

          {/* Flow indicator */}
          <div style={{ background:"#0a0a1a", borderRadius:10, padding:"10px 14px", marginBottom:16, display:"flex", alignItems:"center", gap:8, overflowX:"auto" }}>
            {["draft","sent","approved","active"].map((s,i)=>{
              const isCurrent = activePlan.status===s;
              const isPast = ["draft","sent","approved","active"].indexOf(activePlan.status) > i;
              const ss = CP_STATUSES[s];
              return (
                <div key={s} style={{ display:"flex", alignItems:"center", gap:8, flexShrink:0 }}>
                  <span style={{ fontSize:11, fontWeight:isCurrent?800:400, color:isCurrent?ss.color:isPast?"#444455":"#2a2a4a" }}>{ss.label}</span>
                  {i<3&&<span style={{ color:"#2a2a4a", fontSize:12 }}>→</span>}
                </div>
              );
            })}
          </div>

          <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:10, textTransform:"uppercase" }}>Posts ({activePlan.posts?.length||0})</div>
          {(activePlan.posts||[]).map((idea,i) => (
            <div key={i} style={{ background:"#0a0a1e", border:`1px solid #181838`, borderRadius:12, padding:"12px 14px", marginBottom:8 }}>
              <div style={{ display:"flex", justifyContent:"space-between", alignItems:"flex-start", marginBottom:4 }}>
                <div style={{ fontWeight:700, fontSize:13, color:C.text, flex:1, marginRight:8 }}>{i+1}. {idea.title}</div>
                <span style={{ fontSize:10, padding:"2px 7px", borderRadius:6, background:"#1a1a3a", color:C.violet2, flexShrink:0 }}>{idea.type}</span>
              </div>
              <div style={{ fontSize:11, color:C.muted, marginBottom:3 }}>📅 {fmtDate(idea.date)}</div>
              <div style={{ fontSize:11, color:"#888899" }}>{idea.caption}</div>
            </div>
          ))}
        </div>
      );
    }

    return null;
  };

  // ── ER ANALYTICS VIEW ─────────────────────────────────────────────────────
  const ERAnalytics = () => {
    const postsWithER = posts.filter(p=>p.analytics?.er).sort((a,b)=>+b.analytics.er-(+a.analytics.er));
    const postsWithoutER = posts.filter(p=>!p.analytics?.er);
    const avgER = postsWithER.length ? (postsWithER.reduce((s,p)=>s+(+p.analytics.er),0)/postsWithER.length).toFixed(2) : null;
    const bestPost = postsWithER[0];
    const maxER = +(postsWithER[0]?.analytics?.er||1);

    return (
      <div style={{ padding:mobile?"16px 16px 80px":"24px" }}>
        <div style={{ fontSize:mobile?18:22, fontWeight:800, color:C.white, fontFamily:"Georgia,serif", marginBottom:20 }}>ER Analytics</div>

        {postsWithER.length === 0 ? (
          <div style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:14, padding:32, textAlign:"center" }}>
            <div style={{ fontSize:36, marginBottom:12 }}>📊</div>
            <div style={{ fontSize:16, fontWeight:700, color:C.text, marginBottom:8 }}>No ER data yet</div>
            <div style={{ fontSize:13, color:C.muted, marginBottom:20 }}>Open any post → save analytics (views, likes, comments) → ER appears here automatically</div>
            <button onClick={()=>setView("dash")} style={{ ...btn("primary") }}>Go to Posts</button>
          </div>
        ) : (
          <>
            <div style={{ display:"grid", gridTemplateColumns:mobile?"1fr 1fr":"repeat(3,1fr)", gap:10, marginBottom:20 }}>
              <div style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:14, padding:"14px 16px" }}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>📊 Avg ER</div>
                <div style={{ fontSize:28, fontWeight:800, color:C.violet, fontFamily:"Georgia,serif" }}>{avgER}%</div>
                <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>Good: 3–6%</div>
              </div>
              <div style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:14, padding:"14px 16px" }}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>🏆 Best Post</div>
                <div style={{ fontSize:24, fontWeight:800, color:C.green, fontFamily:"Georgia,serif" }}>{bestPost?.analytics?.er}%</div>
                <div style={{ fontSize:10, color:C.muted, marginTop:2, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{bestPost?.title}</div>
              </div>
              <div style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:14, padding:"14px 16px" }}>
                <div style={{ fontSize:11, color:C.muted, marginBottom:4 }}>📋 Tracked</div>
                <div style={{ fontSize:28, fontWeight:800, color:C.gold, fontFamily:"Georgia,serif" }}>{postsWithER.length}<span style={{ fontSize:16, color:C.muted }}>/{posts.length}</span></div>
                <div style={{ fontSize:11, color:C.muted, marginTop:2 }}>posts with data</div>
              </div>
            </div>

            <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.violet, marginBottom:12, textTransform:"uppercase" }}>ER by Post</div>
            <div style={{ background:"#0f0f2e", border:`1px solid #1a1a4a`, borderRadius:14, padding:16, marginBottom:20 }}>
              {postsWithER.map((p,i) => {
                const er = +p.analytics.er;
                const pct = Math.min(100,(er/maxER)*100);
                const col = er>=5?C.green:er>=2?C.gold:C.red;
                return (
                  <div key={p.id} onClick={()=>{setSel(p);setAnalytics(p.analytics||{});setView("detail");}} style={{ marginBottom:i<postsWithER.length-1?14:0, cursor:"pointer" }}>
                    <div style={{ display:"flex", justifyContent:"space-between", marginBottom:5 }}>
                      <div style={{ fontSize:12, color:C.text, flex:1, marginRight:8, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>{p.title}</div>
                      <div style={{ fontSize:14, fontWeight:800, color:col, flexShrink:0 }}>{er}%</div>
                    </div>
                    <div style={{ background:"#1a1a3a", borderRadius:6, height:8, overflow:"hidden" }}>
                      <div style={{ width:`${pct}%`, height:"100%", background:`linear-gradient(90deg, ${col}99, ${col})`, borderRadius:6 }}/>
                    </div>
                    <div style={{ fontSize:10, color:C.muted, marginTop:4 }}>
                      {p.platform} · {fmtDate(p.pub_date)} · 👁 {(+p.analytics.views||0).toLocaleString()} · ❤️ {(+p.analytics.likes||0).toLocaleString()} · 💬 {(+p.analytics.comments||0).toLocaleString()}
                    </div>
                  </div>
                );
              })}
            </div>

            {postsWithoutER.length > 0 && (
              <>
                <div style={{ fontSize:11, fontWeight:700, letterSpacing:2, color:C.muted, marginBottom:10, textTransform:"uppercase" }}>Not Tracked ({postsWithoutER.length})</div>
                {postsWithoutER.slice(0,6).map(p => (
                  <div key={p.id} onClick={()=>{setSel(p);setAnalytics(p.analytics||{});setView("detail");}} style={{ background:"#0a0a1a", border:`1px solid #141428`, borderRadius:12, padding:"10px 14px", marginBottom:8, cursor:"pointer", display:"flex", justifyContent:"space-between", alignItems:"center" }}>
                    <div>
                      <div style={{ fontSize:13, color:"#888899" }}>{p.title}</div>
                      <div style={{ fontSize:11, color:"#444455", marginTop:2 }}>{p.platform} · {fmtDate(p.pub_date)}</div>
                    </div>
                    <span style={{ fontSize:11, color:C.violet, fontWeight:700 }}>+ Add →</span>
                  </div>
                ))}
              </>
            )}
          </>
        )}
      </div>
    );
  };

  // ── DESKTOP NAV ───────────────────────────────────────────────────────────
  const DesktopNav = () => (
    <div style={{ background:"#0d0d2b", borderBottom:`1px solid #1a1a4a`, padding:"0 24px", display:"flex", alignItems:"center", justifyContent:"space-between", height:52, position:"sticky", top:0, zIndex:100 }}>
      <div style={{ display:"flex", alignItems:"center", gap:10 }}>
        <img src="/logo.png" style={{ height:32, width:32, borderRadius:8 }} alt="Taskona"/>
        <span style={{ fontSize:18, fontWeight:800, letterSpacing:2, fontFamily:"Georgia,serif", color:C.white }}>TASKONA<span style={{ color:C.violet }}>.AI</span></span>
      </div>
      <nav style={{ display:"flex", gap:3 }}>
        {[["dash","Dashboard"],["week","This Week"],["plan","Content Plan"],["er","ER Analytics"],["add","+ Add Post"]].map(([k,l])=>(
          <button key={k} onClick={()=>setView(k)} style={{ padding:"6px 14px", borderRadius:7, border:"none", cursor:"pointer", fontSize:12, fontWeight:700, background:view===k?C.violet:"transparent", color:view===k?C.white:C.muted }}>
            {l}
          </button>
        ))}
      </nav>
      <div style={{ display:"flex", gap:8 }}>
        <button onClick={()=>{
          const link = `${window.location.origin}${window.location.pathname}?invite=${userId}`;
          navigator.clipboard.writeText(link);
          notify("Invite link copied! ✓");
        }} style={{ ...btn(), padding:"5px 12px", fontSize:11 }}>🔗 Invite</button>
        <button onClick={()=>{ setEditBuffers({...buffers}); setShowSettings(true); }} style={{ ...btn(), padding:"5px 12px", fontSize:11 }}>⚙ Buffers</button>
      </div>
    </div>
  );

  // ── MOBILE BOTTOM NAV ─────────────────────────────────────────────────────
  const MobileNav = () => (
    <div style={{ position:"fixed", bottom:0, left:0, right:0, background:"#0d0d2b", borderTop:`1px solid #1a1a4a`, display:"flex", zIndex:100 }}>
      {[
        {key:"dash", icon:"⊞", label:"Home"},
        {key:"week", icon:"📆", label:"Week"},
        {key:"plan", icon:"📋", label:"Plan"},
        {key:"er",   icon:"📊", label:"ER"},
        {key:"add",  icon:"+",  label:"Add"},
        {key:"invite", icon:"🔗", label:"Invite"}
      ].map(n=>(
        <button key={n.key} onClick={()=>{
          if (n.key==="invite") {
            const link = `${window.location.origin}${window.location.pathname}?invite=${userId}`;
            navigator.clipboard.writeText(link).then(()=>notify("Invite link copied! ✓")).catch(()=>notify(link));
          } else { setView(n.key); }
        }}
          style={{ flex:1, padding:"10px 0 8px", background:"none", border:"none", cursor:"pointer", display:"flex", flexDirection:"column", alignItems:"center", gap:3 }}>
          <span style={{ fontSize:n.key==="add"?22:18, width:n.key==="add"?36:undefined, height:n.key==="add"?36:undefined, borderRadius:n.key==="add"?"50%":undefined, background:n.key==="add"?C.violet:"none", display:"flex", alignItems:"center", justifyContent:"center", color:(view===n.key&&n.key!=="add")?C.violet:n.key==="add"?C.white:"#555577", fontWeight:700 }}>{n.icon}</span>
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

      {view==="dash"   && Dashboard()}
      {view==="week"   && Weekly()}
      {view==="add"    && AddPost()}
      {view==="detail" && Detail()}
      {view==="plan"   && ContentPlanView()}
      {view==="er"     && ERAnalytics()}

      {mobile && <MobileNav/>}
    </div>
  );
}
