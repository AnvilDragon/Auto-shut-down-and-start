  var FIELDS=[["len","Stretched length","in",0.05],["flac","Flaccid length","in",0.05],["half","Half-erect length","in",0.05],["erect","Full erect length","in",0.05],["tL","Left testicle","mL",0.5],["tR","Right testicle","mL",0.5],["bust","Bust","in",0.125],["under","Underbust","in",0.125],["weight","Weight","lb",0.1]];
  var METRICS=[["len","Stretched length","in"],["flac","Flaccid length","in"],["half","Half-erect length","in"],["erect","Full erect length","in"],["tes","Testicle avg","mL"],["bust","Bust","in"],["diff","Bust minus underbust","in"],["weight","Weight","lb"]];
  var state;
  var readOnly=false,loading=false,view="boot",rev=0,msg="",authErr="",authUser="";
  var tab="today",day=today(),metric="len",helper={L:"",W:"",D:""};
  try{tab=localStorage.getItem("hrt-tab")||tab}catch(e){}
  var root=document.getElementById("app");

  function pad(n){return(n<10?"0":"")+n}
  function today(){var d=new Date();return d.getFullYear()+"-"+pad(d.getMonth()+1)+"-"+pad(d.getDate())}
  function dn(s){return Date.UTC(+s.slice(0,4),+s.slice(5,7)-1,+s.slice(8,10))/864e5}
  function ds(n){var d=new Date(n*864e5);return d.getUTCFullYear()+"-"+pad(d.getUTCMonth()+1)+"-"+pad(d.getUTCDate())}
  function fmt(s){return new Date(dn(s)*864e5).toLocaleDateString(undefined,{weekday:"short",month:"short",day:"numeric",timeZone:"UTC"})}
  function esc(s){return String(s==null?"":s).replace(/[&<>"]/g,function(c){return{"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;"}[c]})}
  function num(v){var n=parseFloat(v);return isFinite(n)?n:null}
  function r(n,d){if(n==null||!isFinite(n))return "";var s=(+n).toFixed(d==null?2:d);return s.indexOf(".")<0?s:s.replace(/0+$/,"").replace(/\.$/,"")}
  var DRE=/^\d{4}-\d{2}-\d{2}$/,TRE=/^\d{2}:\d{2}$/,SITES=["Thigh L","Thigh R","Thigh","Belly","Glute","Arm"];
  function okDate(s){return typeof s==="string"&&DRE.test(s)&&isFinite(dn(s))}
  function pos(v){var n=num(v);return n!=null&&n>=0&&n<100000?n:null}
  function clean(s){
    s=s&&typeof s==="object"?s:{};var o={start:okDate(s.start)?s.start:"",conc:pos(s.conc)||40,shotEvery:pos(s.shotEvery)||7,
      targetPeak:Array.isArray(s.targetPeak)&&pos(s.targetPeak[0])!=null&&pos(s.targetPeak[1])!=null?[pos(s.targetPeak[0]),pos(s.targetPeak[1])]:[380,440],entries:[],shots:[],labs:[]};
    (Array.isArray(s.entries)?s.entries:[]).forEach(function(e){if(!e||!okDate(e.date))return;var x={date:e.date};
      FIELDS.forEach(function(f){var n=pos(e[f[0]]);if(n!=null)x[f[0]]=n});
      if(typeof e.time==="string"&&TRE.test(e.time))x.time=e.time;if(typeof e.note==="string"&&e.note)x.note=e.note.slice(0,2000);
      if(!o.entries.some(function(y){return y.date===x.date}))o.entries.push(x)});
    (Array.isArray(s.shots)?s.shots:[]).forEach(function(e){if(e&&okDate(e.date)&&pos(e.ml)!=null)o.shots.push({date:e.date,ml:pos(e.ml),site:SITES.indexOf(e.site)>=0?e.site:"Thigh"})});
    (Array.isArray(s.labs)?s.labs:[]).forEach(function(e){if(!e||!okDate(e.date))return;var x={date:e.date};if(pos(e.e2)!=null)x.e2=pos(e.e2);if(pos(e.t)!=null)x.t=pos(e.t);x.done=x.e2!=null||x.t!=null;o.labs.push(x)});
    ["entries","shots","labs"].forEach(function(k){o[k].sort(function(a,b){return a.date<b.date?-1:1})});return o;
  }
  state=clean({});var saved=JSON.stringify(state),initial=saved;
  function nowTime(){var d=new Date();return pad(d.getHours())+":"+pad(d.getMinutes())}
  function dirty(){return JSON.stringify(state)!==saved}
  function entry(d){for(var i=0;i<state.entries.length;i++)if(state.entries[i].date===d)return state.entries[i];return null}
  function sortAll(){["entries","shots","labs"].forEach(function(k){state[k].sort(function(a,b){return a.date<b.date?-1:1})})}
  function lastShot(before){var s=null;state.shots.forEach(function(x){if(!before||x.date<=before)s=x});return s}
  function val(e,k){if(!e)return null;if(k==="tes"){var a=num(e.tL),b=num(e.tR);return a!=null&&b!=null?(a+b)/2:(a!=null?a:b)}if(k==="diff"){var u=num(e.bust),w=num(e.under);return u!=null&&w!=null?u-w:null}return num(e[k])}


  // ---- classification (reference ranges; descriptive, not goals) ----
  var CUPS=["AA","A","B","C","D","DD","DDD","G","H","I","J"];
  // Veale et al. 2015, BJU Int: pooled adult male lengths in cm [mean, SD]
  var PEN={flac:[9.16,1.57],len:[13.24,1.89],erect:[13.12,1.66]};
  function cdf(z){var t=1/(1+0.2316419*Math.abs(z)),d=0.3989423*Math.exp(-z*z/2),p=d*t*(0.3193815+t*(-0.3565638+t*(1.781478+t*(-1.821256+t*1.330274))));return z>0?1-p:p}
  function ord(n){var v=n%100;return n+(v>10&&v<14?"th":["th","st","nd","rd"][n%10]||"th")}
  function penCat(p){return p<5?"Below typical range":p<25?"Smaller than average":p<=75?"Average":p<=95?"Larger than average":"Above typical range"}
  function testCat(v){return v>=15?"Adult size range":v>=12?"Slightly below adult range":v>=4?"Pubertal size range":"Prepubertal size range"}
  function classify(e){
    var rows=[];e=e||{};
    var b=num(e.bust),u=num(e.under);
    if(b!=null&&u!=null){var band=Math.max(28,Math.round(u/2)*2),d=Math.max(0,Math.round(b-u));
      rows.push(["Breast",band+(d>=CUPS.length?"J+":CUPS[d]),"Estimated US bra size (band from underbust, cup from "+r(b-u,2)+" in difference). Brands vary."])}
    [["flac","Flaccid length"],["len","Stretched length"],["erect","Erect length"]].forEach(function(k){
      var v=num(e[k[0]]);if(v==null)return;var cm=v*2.54,z=(cm-PEN[k[0]][0])/PEN[k[0]][1],p=Math.min(99,Math.max(1,Math.round(cdf(z)*100)));
      rows.push([k[1],r(v,2)+" in ("+r(cm,1)+" cm)",ord(p)+" percentile, "+penCat(p).toLowerCase()])});
    var t=val(e,"tes");
    if(t!=null)rows.push(["Testicles","avg "+r(t,1)+" mL",testCat(t)+(num(e.tL)!=null&&num(e.tR)!=null?" (L "+r(num(e.tL),1)+", R "+r(num(e.tR),1)+" mL)":"")]);
    return rows;
  }
  function classHtml(e){
    var rows=classify(e);
    return '<h2>Classification</h2>'+(rows.length?'<table><tbody>'+rows.map(function(x){return '<tr><th scope="row">'+esc(x[0])+'</th><td><b>'+esc(x[1])+'</b><br><span class="unit">'+esc(x[2])+'</span></td></tr>'}).join("")+'</tbody></table>':'<p class="empty">Enter bust and underbust, penis lengths or testicle volumes to see where they fall.</p>')+
      '<p class="note">Penis lengths are compared with measured adult male averages (Veale et al. 2015, BJU International; flaccid 9.2 cm, stretched 13.2 cm, erect 13.1 cm). Testicle volume uses the Prader orchidometer bands (adult 15 to 25 mL). These are reference ranges for context, not targets or diagnoses. Hormone therapy is expected to change them.</p>';
  }

  function alerts(){
    var out=[],t=dn(today()),ls=lastShot();
    if(ls){var due=dn(ls.date)+(state.shotEvery||7),left=due-t;
      if(left<0)out.push(["warn","Your shot was due "+fmt(ds(due))+", "+(-left)+" day"+(left===-1?"":"s")+" ago. Log it once it's done."]);
      else if(left===0)out.push(["warn","Shot day. "+r(ls.ml)+" mL ("+r(ls.ml*state.conc,1)+" mg). Log it under Shots when it's done."]);
      else if(left===1)out.push(["warn","Shot tomorrow, "+fmt(ds(due))+"."]);}
    if(!entry(today()))out.push(["warn","No measurements logged for today yet."]);
    var labDue=null;state.labs.forEach(function(l){if(!l.done&&l.date>=today()&&(!labDue||l.date<labDue.date))labDue=l});
    if(labDue){var ld=dn(labDue.date)-t;if(ld<=3)out.push(["warn","Blood draw "+(ld===0?"today":"in "+ld+" day"+(ld===1?"":"s"))+". Aim for 3 to 4 days after your shot."]);}
    if(!out.length)out.push(["ok","All caught up for today."]);
    return out;
  }

  function header(){
    var ls=lastShot(),t=dn(today()),days=state.start?t-dn(state.start):null;
    var next=ls?ds(dn(ls.date)+(state.shotEvery||7)):null;
    var since=ls?t-dn(ls.date):null;
    return '<h1>HRT Log</h1><p class="sub">Daily measurements, shots and labs, with reminders built in.</p>'+
      '<div class="strip">'+
      st(days!=null?"Day "+days:"-","On HRT since "+(state.start?fmt(state.start):"?"))+
      st(ls?r(ls.ml)+" mL":"-",ls?r(ls.ml*state.conc,1)+" mg at "+state.conc+" mg/mL":"Current dose")+
      st(next?fmt(next):"-","Next shot")+
      st(since!=null?since+" d":"-","Since last shot")+
      '</div><div class="alerts" role="status">'+alerts().map(function(a){return '<div class="alert'+(a[0]==="ok"?" ok":"")+'"><p>'+esc(a[1])+'</p></div>'}).join("")+'</div>';
  }
  function st(b,s){return '<div class="stat"><b>'+esc(b)+'</b><span>'+esc(s)+'</span></div>'}

  function tabs(){
    return '<div class="tabs" role="tablist">'+[["today","Today"],["trends","Trends"],["shots","Shots"],["labs","Labs"],["history","History"],["data","Data"]].map(function(t){
      return '<button class="tab" role="tab" id="tab-'+t[0]+'" data-tab="'+t[0]+'" aria-selected="'+(tab===t[0])+'">'+t[1]+'</button>'}).join("")+'</div>';
  }

  function todayPanel(){
    var e=entry(day)||{},dis=readOnly||loading?" disabled":"";
    var L=num(helper.L),W=num(helper.W),D=num(helper.D),vol=L&&W?0.52*L*W*(D||W):null;
    return '<section class="panel"><div class="grid"><label class="f">Date<input type="date" id="day" value="'+esc(day)+'" max="'+today()+'"></label><label class="f">Time measured<input type="time" id="e-time" data-e="time" value="'+esc(e.time||"")+'"'+dis+'></label></div>'+
      '<div class="grid">'+FIELDS.map(function(f){return '<label class="f">'+f[1]+' <span class="unit">'+f[2]+'</span><input type="number" inputmode="decimal" step="'+f[3]+'" min="0" id="e-'+f[0]+'" data-e="'+f[0]+'" value="'+esc(e[f[0]]==null?"":e[f[0]])+'"'+dis+'></label>'}).join("")+'</div>'+
      '<label class="f">Notes<textarea id="e-note" data-e="note" placeholder="Tenderness, mood, sleep, anything unusual"'+dis+'>'+esc(e.note||"")+'</textarea></label>'+
      '<div class="helper" id="cls">'+classHtml(e)+'</div>'+
      '<div class="helper"><h2>Testicle volume helper</h2><p>Measure through the skin with a soft tape or calipers, in centimeters: length (top to bottom), width (side to side) and depth (front to back). Volume = 0.52 × L × W × D. Leave depth blank to use width twice.</p>'+
      '<div class="row3"><label class="f">Length <span class="unit">cm</span><input type="number" step="0.1" min="0" id="h-L" data-hp="L" value="'+esc(helper.L)+'"></label><label class="f">Width <span class="unit">cm</span><input type="number" step="0.1" min="0" id="h-W" data-hp="W" value="'+esc(helper.W)+'"></label><label class="f">Depth <span class="unit">cm</span><input type="number" step="0.1" min="0" id="h-D" data-hp="D" value="'+esc(helper.D)+'"></label></div>'+
      '<div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap"><span class="vol" id="vol">'+(vol?r(vol,1)+" mL":"- mL")+'</span><button class="btn sm" data-act="useL"'+(vol&&!readOnly&&!loading?"":" disabled")+'>Use for left</button><button class="btn sm" data-act="useR"'+(vol&&!readOnly&&!loading?"":" disabled")+'>Use for right</button></div></div>'+
      '<p class="note">Measure at the same time each day, before a shower, warm and relaxed. Daily numbers bounce around; the Trends tab smooths them with a 7-day average.</p></section>';
  }

  function chart(){
    var pts=[];state.entries.forEach(function(e){var v=val(e,metric);if(v!=null)pts.push([dn(e.date),v])});
    var m=METRICS.filter(function(x){return x[0]===metric})[0];
    var chips='<div class="chips">'+METRICS.map(function(x){return '<button class="chip" data-metric="'+x[0]+'" aria-pressed="'+(x[0]===metric)+'">'+x[1]+'</button>'}).join("")+'</div>';
    if(pts.length<2)return '<section class="panel">'+chips+'<p class="empty">Log '+m[1].toLowerCase()+' on at least two days to see a trend line here. The 7-day average starts working after your first week.</p></section>';
    var W=640,H=260,pl=46,pr=14,pt=14,pb=34;
    var x0=pts[0][0],x1=pts[pts.length-1][0];if(x1===x0)x1=x0+1;
    var lo=Infinity,hi=-Infinity;pts.forEach(function(p){lo=Math.min(lo,p[1]);hi=Math.max(hi,p[1])});
    var span=hi-lo||Math.abs(hi)*0.1||1;lo-=span*0.15;hi+=span*0.15;
    function X(d){return pl+(d-x0)/(x1-x0)*(W-pl-pr)}function Y(v){return pt+(hi-v)/(hi-lo)*(H-pt-pb)}
    var avg=pts.map(function(p){var s=0,c=0;pts.forEach(function(q){if(q[0]<=p[0]&&q[0]>p[0]-7){s+=q[1];c++}});return[p[0],s/c]});
    var g="";for(var i=0;i<=4;i++){var v=lo+(hi-lo)*i/4,y=Y(v);g+='<line x1="'+pl+'" x2="'+(W-pr)+'" y1="'+y+'" y2="'+y+'" stroke="var(--line)" stroke-width="1"/><text x="'+(pl-6)+'" y="'+(y+4)+'" text-anchor="end" font-size="11" fill="var(--muted)" font-family="var(--mono)">'+r(v,metric==="weight"?0:2)+'</text>'}
    var ticks="",n=Math.min(5,pts.length);for(i=0;i<n;i++){var d=Math.round(x0+(x1-x0)*i/(n-1||1));ticks+='<text x="'+X(d)+'" y="'+(H-10)+'" text-anchor="'+(i===0?"start":i===n-1?"end":"middle")+'" font-size="11" fill="var(--muted)">'+esc(new Date(d*864e5).toLocaleDateString(undefined,{month:"short",day:"numeric",timeZone:"UTC"}))+'</text>'}
    var shots="";state.shots.forEach(function(s){var d=dn(s.date);if(d>=x0&&d<=x1)shots+='<line x1="'+X(d)+'" x2="'+X(d)+'" y1="'+pt+'" y2="'+(H-pb)+'" stroke="var(--blue)" stroke-width="1" stroke-dasharray="3 4" opacity=".6"/>'});
    var dots=pts.map(function(p){return '<circle cx="'+X(p[0])+'" cy="'+Y(p[1])+'" r="2.6" fill="var(--muted)" opacity=".7"/>'}).join("");
    var path=avg.map(function(p,i){return(i?"L":"M")+X(p[0]).toFixed(1)+" "+Y(p[1]).toFixed(1)}).join(" ");
    var lastA=avg[avg.length-1],first=avg[0];
    var svg='<svg viewBox="0 0 '+W+' '+H+'" role="img" aria-label="'+esc(m[1])+' over time">'+g+shots+dots+'<path d="'+path+'" fill="none" stroke="var(--accent)" stroke-width="2.5" stroke-linejoin="round"/><circle cx="'+X(lastA[0])+'" cy="'+Y(lastA[1])+'" r="4.5" fill="var(--accent)"/>'+ticks+'</svg>';
    var ch=lastA[1]-first[1];
    return '<section class="panel">'+chips+'<div class="tbl">'+svg+'</div><div class="legend"><span><i style="background:var(--accent)"></i>7-day average</span><span><i style="background:var(--muted)"></i>Daily value</span><span><i style="background:var(--blue)"></i>Shot day</span></div>'+
      '<p class="note">7-day average now '+r(lastA[1])+' '+m[2]+', '+(ch>=0?"up ":"down ")+r(Math.abs(ch))+' '+m[2]+' since '+fmt(ds(first[0]))+'.</p></section>';
  }

  function shotsPanel(){
    var dis=readOnly||loading?" disabled":"";
    var rows=state.shots.slice().reverse().map(function(s){var i=state.shots.indexOf(s);
      return '<tr><td><input type="date" id="s-d-'+i+'" max="'+today()+'" data-s="'+i+'" data-k="date" value="'+esc(s.date)+'"'+dis+'></td><td><input type="number" step="0.01" min="0" id="s-m-'+i+'" data-s="'+i+'" data-k="ml" value="'+esc(s.ml)+'"'+dis+'></td><td class="unit" id="s-mg-'+i+'">'+r(s.ml*state.conc,1)+' mg</td><td><select id="s-site-'+i+'" data-s="'+i+'" data-k="site"'+dis+'>'+["Thigh L","Thigh R","Thigh","Belly","Glute","Arm"].map(function(o){return '<option'+(o===s.site?" selected":"")+'>'+esc(o)+'</option>'}).join("")+'</select></td><td><button class="btn sm" data-del="shots" data-i="'+i+'"'+dis+'>'+(confirmDel==="shots"+i?"Confirm":"Delete")+'</button></td></tr>'}).join("");
    return '<section class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Shots</h2><button class="btn primary" data-act="addShot"'+dis+'>Log today\'s shot</button></div>'+
      '<label class="f" style="max-width:220px">Vial strength <span class="unit">mg/mL</span><input type="number" id="conc" step="1" min="1" value="'+esc(state.conc)+'"'+dis+'></label>'+
      (rows?'<div class="tbl"><table><thead><tr><th>Date</th><th>mL</th><th>Dose</th><th>Site</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="empty">No shots logged yet.</p>')+'</section>';
  }

  function labsPanel(){
    var dis=readOnly||loading?" disabled":"";
    var rows=state.labs.slice().reverse().map(function(l){var i=state.labs.indexOf(l),ls=lastShot(l.date),dp=ls?dn(l.date)-dn(ls.date):null;
      return '<tr><td><input type="date" id="l-d-'+i+'" data-l="'+i+'" data-k="date" value="'+esc(l.date)+'"'+dis+'></td><td><input type="number" step="1" min="0" id="l-e-'+i+'" data-l="'+i+'" data-k="e2" value="'+esc(l.e2==null?"":l.e2)+'" placeholder="pg/mL"'+dis+'></td><td><input type="number" step="1" min="0" id="l-t-'+i+'" data-l="'+i+'" data-k="t" value="'+esc(l.t==null?"":l.t)+'" placeholder="ng/dL"'+dis+'></td><td class="unit">'+(dp!=null?dp+" d after":"-")+'</td><td><button class="btn sm" data-del="labs" data-i="'+i+'"'+dis+'>'+(confirmDel==="labs"+i?"Confirm":"Delete")+'</button></td></tr>'}).join("");
    return '<section class="panel"><div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap"><h2>Labs</h2><button class="btn primary" data-act="addLab"'+dis+'>Add blood draw</button></div>'+
      '<p class="note">Target estradiol at peak: '+esc(state.targetPeak[0])+' to '+esc(state.targetPeak[1])+' pg/mL. Add a future date to get a reminder on the Today screen; fill in results when they come back.</p>'+
      (rows?'<div class="tbl"><table><thead><tr><th>Date</th><th>Estradiol</th><th>Testosterone</th><th>Timing</th><th></th></tr></thead><tbody>'+rows+'</tbody></table></div>':'<p class="empty">No labs yet. Your next draw is expected around early January.</p>')+'</section>';
  }

  function historyPanel(){
    if(!state.entries.length)return '<section class="panel"><p class="empty">Your daily entries will be listed here once you log one on the Today tab.</p></section>';
    var rows=state.entries.slice().reverse().map(function(e){return '<tr class="click" data-day="'+esc(e.date)+'"><td>'+fmt(e.date)+(e.time?' <span class="unit">'+esc(e.time)+'</span>':'')+'</td>'+FIELDS.map(function(f){return '<td>'+esc(e[f[0]]==null?"":e[f[0]])+'</td>'}).join("")+'</tr>'}).join("");
    return '<section class="panel"><h2>History</h2><p class="note">Tap a day to edit it.</p><div class="tbl"><table><thead><tr><th>Date</th>'+FIELDS.map(function(f){return '<th>'+f[1].replace(" length","")+'</th>'}).join("")+'</tr></thead><tbody>'+rows+'</tbody></table></div></section>';
  }

  var confirmDel=null;
  function render(){
    if(view!=="app")return authView();
    var body=tab==="trends"?chart():tab==="shots"?shotsPanel():tab==="labs"?labsPanel():tab==="history"?historyPanel():tab==="data"?dataPanel():todayPanel();
    root.innerHTML='<div class="wrap">'+header()+tabs()+'<div role="tabpanel">'+body+'</div></div>'+
      '<div class="bar"><div class="in"><span class="status" id="status">'+esc(msg||(dirty()?"Unsaved changes.":"Everything is saved."))+'</span><button class="btn" data-act="discard"'+(dirty()&&!readOnly&&!loading?"":" disabled")+'>Discard</button><button class="btn primary" data-act="save"'+(dirty()&&!readOnly&&!loading?"":" disabled")+'>Save</button></div></div>';
  }
  function refreshBar(){var d=dirty()&&!readOnly&&!loading;root.querySelector('[data-act="save"]').disabled=!d;root.querySelector('[data-act="discard"]').disabled=!d;if(!msg)document.getElementById("status").textContent=dirty()?"Unsaved changes.":"Everything is saved."}
  function setMsg(m){msg=m;var s=document.getElementById("status");if(s)s.textContent=m||(dirty()?"Unsaved changes.":"Everything is saved.")}

  root.addEventListener("input",function(ev){
    var t=ev.target,v=t.value;msg="";
    if(t.id==="day"){if(okDate(v)&&v<=today()){day=v;render()}else if(v.length>=10){t.value=day;setMsg("You can't log a day in the future.")}return}
    if(t.dataset.hp){helper[t.dataset.hp]=v;var L=num(helper.L),W=num(helper.W),D=num(helper.D),vol=L&&W?0.52*L*W*(D||W):null;document.getElementById("vol").textContent=vol?r(vol,1)+" mL":"- mL";root.querySelectorAll('[data-act="useL"],[data-act="useR"]').forEach(function(b){b.disabled=!vol||readOnly});return}
    if(t.dataset.e){var e=entry(day);if(!e){e={date:day};if(day===today())e.time=nowTime();state.entries.push(e);sortAll();var te=document.getElementById("e-time");if(te&&!te.value&&e.time)te.value=e.time}
      if(t.dataset.e==="note"||t.dataset.e==="time"){if(v)e[t.dataset.e]=v;else delete e[t.dataset.e]}else{var n=pos(v);if(n==null)delete e[t.dataset.e];else e[t.dataset.e]=n}
      if(Object.keys(e).filter(function(k){return k!=="date"&&k!=="time"}).length===0)state.entries.splice(state.entries.indexOf(e),1);
      var cl=document.getElementById("cls");if(cl)cl.innerHTML=classHtml(e);
      refreshBar();return}
    if(t.id==="conc"){var c=pos(v);if(c){state.conc=c;state.shots.forEach(function(s,i){var m=document.getElementById("s-mg-"+i);if(m)m.textContent=r(s.ml*c,1)+" mg"})}refreshBar();return}
    if(t.dataset.s!=null){var s=state.shots[+t.dataset.s];if(t.dataset.k==="ml"){var x=pos(v);if(x!=null){s.ml=x;document.getElementById("s-mg-"+t.dataset.s).textContent=r(x*state.conc,1)+" mg"}}else if(t.dataset.k==="date"?okDate(v):SITES.indexOf(v)>=0)s[t.dataset.k]=v;refreshBar();return}
    if(t.dataset.l!=null){var l=state.labs[+t.dataset.l];if(t.dataset.k==="date"){if(okDate(v))l.date=v}else{var y=pos(v);if(y==null)delete l[t.dataset.k];else l[t.dataset.k]=y;l.done=l.e2!=null||l.t!=null}refreshBar();return}
  });
  root.addEventListener("change",function(ev){var t=ev.target;if((t.dataset.s!=null||t.dataset.l!=null)&&t.dataset.k==="date"){sortAll();render()}});
  root.addEventListener("click",function(ev){
    var b=ev.target.closest("button,tr.click");if(!b)return;
    if(b.dataset.tab){tab=b.dataset.tab;confirmDel=null;try{localStorage.setItem("hrt-tab",tab)}catch(e){}render();return}
    if(b.dataset.metric){metric=b.dataset.metric;render();return}
    if(b.dataset.day){day=b.dataset.day;tab="today";render();return}
    if(b.dataset.del){var k=b.dataset.del+b.dataset.i;if(confirmDel===k){state[b.dataset.del].splice(+b.dataset.i,1);confirmDel=null}else confirmDel=k;render();return}
    var a=b.dataset.act;
    if(a==="useL"||a==="useR"){var L=num(helper.L),W=num(helper.W),D=num(helper.D);var e=entry(day);if(!e){e={date:day};if(day===today())e.time=nowTime();state.entries.push(e);sortAll();var te=document.getElementById("e-time");if(te&&!te.value&&e.time)te.value=e.time}e[a==="useL"?"tL":"tR"]=Math.round(0.52*L*W*(D||W)*10)/10;render();return}
    if(a==="addShot"){var ls=lastShot();state.shots.push({date:today(),ml:ls?ls.ml:0.2,site:ls?ls.site:"Thigh"});sortAll();render();return}
    if(a==="addLab"){state.labs.push({date:today()});sortAll();render();return}
    if(a==="discard"){state=JSON.parse(saved||initial);msg="";render();return}
    if(a==="logout"){call("POST","api/logout",{}).then(function(){state=clean({});saved=JSON.stringify(state);view="login";authErr="";render()});return}
    if(a==="save")save();
  });

  function call(method,url,body){
    var o={method:method,headers:{},credentials:"same-origin"};
    if(body!==undefined){o.headers["Content-Type"]="application/json";o.body=JSON.stringify(body)}
    return fetch(url,o).then(function(r){return r.json().catch(function(){return{}}).then(function(j){
      if(r.status===401&&url!=="api/login"&&url!=="api/password"){view="login";authErr="Your session ended. Sign in again.";render()}
      return{ok:r.ok,status:r.status,data:j}})});
  }
  function save(){
    var b=root.querySelector('[data-act="save"]');if(b)b.disabled=true;setMsg("Saving…");
    var snap=JSON.stringify(state);
    call("PUT","api/state",{rev:rev,state:state}).then(function(r){
      if(r.ok){rev=r.data.rev;saved=snap;setMsg("Saved.")}
      else if(r.status===409)setMsg("This log was changed on another device. Copy anything new, then reload the page before saving.");
      else if(r.status!==401)setMsg("Couldn't save ("+r.status+"). Try again.");
      refreshBar()}).catch(function(){setMsg("Couldn't reach the server. Check your connection and save again.");refreshBar()});
  }
  function load(){
    return call("GET","api/state").then(function(r){if(!r.ok)return;rev=r.data.rev;state=clean(r.data.state);saved=JSON.stringify(state);msg="";view="app";render()});
  }

  function authView(){
    if(view==="boot"){root.innerHTML='<div class="wrap"><p class="sub">Loading…</p></div>';return}
    var setup=view==="setup";
    root.innerHTML='<div class="wrap auth"><h1>HRT Log</h1><p class="sub">'+(setup?"Create the login for your private log.":"Sign in to continue.")+'</p>'+
      '<form class="panel" id="auth" autocomplete="on"><label class="f">Username<input id="a-u" name="username" autocomplete="username" value="'+esc(authUser)+'" required autofocus></label>'+
      '<label class="f">Password'+(setup?' <span class="unit">10+ characters</span>':'')+'<input id="a-p" name="password" type="password" autocomplete="'+(setup?"new-password":"current-password")+'" minlength="'+(setup?10:1)+'" required></label>'+
      (setup?'<label class="f">Confirm password<input id="a-p2" type="password" autocomplete="new-password" required></label>':'')+
      '<p class="note" id="a-err" role="alert" style="color:var(--warn)">'+esc(authErr)+'</p>'+
      '<button class="btn primary" type="submit">'+(setup?"Create account":"Sign in")+'</button></form></div>';
  }
  root.addEventListener("submit",function(ev){
    if(ev.target.id!=="auth")return;ev.preventDefault();
    var u=authUser=document.getElementById("a-u").value,p=document.getElementById("a-p").value,setup=view==="setup";
    if(setup&&p!==document.getElementById("a-p2").value){authErr="Passwords don't match.";return authView()}
    call("POST",setup?"api/setup":"api/login",{username:u,password:p}).then(function(r){
      if(r.ok){authErr="";return load()}
      authErr=r.data.error||"Couldn't sign in.";authView()}).catch(function(){authErr="Couldn't reach the server.";authView()});
  });

  var dataMsg="";
  function dataPanel(){
    return '<section class="panel"><h2>Export</h2><p class="note">Download your data any time. JSON can be re-imported here; CSV opens in a spreadsheet; the database file is a full SQLite backup.</p>'+
      '<div class="chips"><a class="btn" href="api/export?format=json" download>JSON</a><a class="btn" href="api/export?format=csv" download>CSV</a><a class="btn" href="api/export?format=sqlite" download>Database (.db)</a></div></section>'+
      '<section class="panel" style="margin-top:12px"><h2>Import</h2><p class="note">Restore from a JSON export. This replaces everything currently in the log.</p>'+
      '<input type="file" id="imp" accept="application/json,.json"'+(dirty()?" disabled":"")+'>'+(dirty()?'<p class="note">Save or discard your changes first.</p>':'')+'</section>'+
      '<section class="panel" style="margin-top:12px"><h2>Account</h2><form id="pw" style="display:grid;gap:12px" autocomplete="off"><div class="grid">'+
      '<label class="f">Current password<input type="password" id="pw-c" autocomplete="current-password" required></label>'+
      '<label class="f">New password <span class="unit">10+ characters</span><input type="password" id="pw-n" autocomplete="new-password" minlength="10" required></label></div>'+
      '<div style="display:flex;gap:8px;flex-wrap:wrap"><button class="btn" type="submit">Change password</button><button class="btn" type="button" data-act="logout">Sign out</button></div></form>'+
      '<p class="note" id="data-msg" role="status">'+esc(dataMsg)+'</p></section>';
  }
  function setData(m){dataMsg=m;var e=document.getElementById("data-msg");if(e)e.textContent=m}
  root.addEventListener("submit",function(ev){
    if(ev.target.id!=="pw")return;ev.preventDefault();
    call("POST","api/password",{current:document.getElementById("pw-c").value,next:document.getElementById("pw-n").value}).then(function(r){
      if(r.ok){ev.target.reset();setData("Password changed. Other devices were signed out.")}else setData(r.data.error||"Couldn't change password.")});
  });
  root.addEventListener("change",function(ev){
    if(ev.target.id!=="imp"||!ev.target.files[0])return;
    var f=ev.target.files[0];
    if(!confirm("Replace everything in the log with this file?")){ev.target.value="";return}
    f.text().then(function(t){var j=JSON.parse(t);return call("POST","api/import",j)}).then(function(r){
      if(r.ok)return load().then(function(){setMsg("Imported.")});setData(r.data.error||"Import failed.")}).catch(function(){setData("That file isn't valid JSON.")});
  });

  render();
  call("GET","api/status").then(function(r){
    if(!r.data.setup)view="setup";else if(!r.data.authed)view="login";else return load();
    render();
  }).catch(function(){view="login";authErr="Couldn't reach the server.";render()});
  setInterval(function(){if(view==="app"&&today()!==day&&!dirty()&&document.activeElement===document.body){day=today();render()}},60000);
