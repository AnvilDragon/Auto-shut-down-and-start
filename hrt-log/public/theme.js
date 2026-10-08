// Theme: Auto (follow system) / Light / Dark. Runs in <head> so there is no flash.
(function(){
  var K="hrt-theme",root=document.documentElement,mq=matchMedia("(prefers-color-scheme: dark)");
  var modes=["auto","light","dark"],labels={auto:"Auto",light:"Light",dark:"Dark"},icons={auto:"◐",light:"☀",dark:"☾"};
  function get(){try{var v=localStorage.getItem(K);return modes.indexOf(v)>=0?v:"auto"}catch(e){return"auto"}}
  function apply(m){
    if(m==="auto")root.removeAttribute("data-theme");else root.setAttribute("data-theme",m);
    var dark=m==="dark"||(m==="auto"&&mq.matches),t=document.querySelector('meta[name="theme-color"]');
    if(t)t.setAttribute("content",dark?"#17131a":"#f6f3f5");
    var b=document.getElementById("theme-btn");
    if(b){b.textContent=icons[m]+" "+labels[m];b.setAttribute("aria-label","Theme: "+labels[m]+". Click to change.")}
  }
  var mode=get();apply(mode);
  mq.addEventListener("change",function(){if(mode==="auto")apply(mode)});
  document.addEventListener("DOMContentLoaded",function(){
    var b=document.createElement("button");b.id="theme-btn";b.type="button";b.className="btn sm";
    b.onclick=function(){mode=modes[(modes.indexOf(mode)+1)%3];try{localStorage.setItem(K,mode)}catch(e){}apply(mode)};
    document.body.appendChild(b);apply(mode);
  });
})();
