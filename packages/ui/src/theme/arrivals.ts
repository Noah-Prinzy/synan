// @ts-nocheck
/*
 * "Arrivals", the Attendee Portal's living background (D-37), by the background artist: an evening
 * festival ground drawn in monospace glyphs, people arriving and walking in lanes, lights across
 * the top. This file is the artist's drawing code (createArrivals, final version), lifted as is so a
 * new version can replace it whole; the one change is marked SYNAN (the frame timer). The app's
 * wiring (theme colours, --bg-motion, calm behind text, pausing while typing or scrolling) is in
 * ./living.tsx.
 */
/* =====================================================================================
   Synan "Arrivals" background: a crowd drawn from monospace glyphs, arriving at an
   evening festival ground. Self-contained, no dependencies. Lift this function as is.

   const bg = createArrivals(containerEl, {
     ink:'#FAFAFA', accent:'#8AB4FF', alpha:.7,   // glyph colours; alpha = max glyph opacity
     motion:1,          // speed multiplier (Calm .5, Gentle 1, Lively 1.7)
     fps:0,             // frame cap; 0 = auto: 15 fps (12 below 640 px wide), stepping down to 10/8 if paints are slow
     calm:[],           // [{left,top,right,bottom,strength 0..1}] in container CSS px
     reducedMotion:null,// null = follow prefers-reduced-motion; true/false to force
     pointer:true, seed:7
   });
   bg.setTheme({ink,accent,alpha}); bg.setMotion(m); bg.setCalm(rects);
   bg.resize(); bg.start(); bg.stop(); bg.destroy();
   The container must be positioned with a size (e.g. position:fixed; inset:0) and overflow:hidden.
   ===================================================================================== */
export function createArrivals(container,opts){
  "use strict";
  opts=Object.assign({ink:'#FAFAFA',accent:'#8AB4FF',alpha:.7,motion:1,fps:0,calm:[],reducedMotion:null,pointer:true,seed:7,
    glyphFont:'ui-monospace,"Cascadia Mono",Consolas,"SF Mono",Menlo,"Roboto Mono",monospace'},opts||{});
  const cv=document.createElement('canvas');cv.setAttribute('aria-hidden','true');
  cv.style.cssText='position:absolute;left:0;top:0;display:block;pointer-events:none';
  container.appendChild(cv);
  const cx=cv.getContext('2d');
  // glyph ramp, light to dense; each density band picks one of its glyphs by a fixed per-cell hash
  const NL=16,GL=".'`,:-~;+=cotxs%ea#8SX@&",BK=[[0,4],[4,8],[8,13],[13,18],[18,24]];
  let W=0,H=0,dpr,gx,gy,cols,rows,ax,ay,mk,mx,st,atlas,hash,calm,hz,lanes=[],tents=[],houses=[],festoon=[];
  let ptr={x:-999,y:-999},dt=0,T=40,last=0,raf=0,running=false,visible=true,box={left:0,top:0};
  let calmRects=opts.calm||[],drawn=0,changed=0,prev=null;const PF=[0,0,0,0];
  const RM=matchMedia('(prefers-reduced-motion: reduce)');
  const reduced=()=>opts.reducedMotion==null?RM.matches:!!opts.reducedMotion;
  function mulberry(a){return()=>{a|=0;a=a+0x6D2B79F5|0;let t=Math.imul(a^a>>>15,1|a);t=t+Math.imul(t^t>>>7,61|t)^t;return((t^t>>>14)>>>0)/4294967296;};}
  let rng=mulberry(opts.seed);
  const rnd=(a,b)=>a+rng()*(b-a);

  function buildAtlas(){
    // rows: colour (ink, accent) x NL opacity levels, so drawing never changes globalAlpha
    atlas=document.createElement('canvas');atlas.width=GL.length*ax;atlas.height=2*NL*ay;
    const a=atlas.getContext('2d');
    a.font=`600 ${Math.round(ay*.86)}px ${opts.glyphFont}`;a.textAlign='center';a.textBaseline='middle';
    [opts.ink,opts.accent].forEach((c,r)=>{a.fillStyle=c;for(let l=1;l<NL;l++){a.globalAlpha=l/NL;
      for(let g=0;g<GL.length;g++)a.fillText(GL[g],g*ax+ax/2,(r*NL+l)*ay+ay*.55);}});
    prev=null;
  }
  // per-cell attenuation behind text: soft rounded falloff around each rectangle
  function computeCalm(){
    if(!cols)return;
    calm=new Float32Array(cols*rows);prev=null;
    const pad=Math.min(70,W*.06);
    for(const R of calmRects){
      const s=R.strength==null?.85:R.strength;
      const k0=Math.max(0,((R.left-pad)/gx)|0),k1=Math.min(cols-1,Math.ceil((R.right+pad)/gx));
      const j0=Math.max(0,((R.top-pad)/gy)|0),j1=Math.min(rows-1,Math.ceil((R.bottom+pad)/gy));
      for(let j=j0;j<=j1;j++)for(let k=k0;k<=k1;k++){
        const px=(k+.5)*gx,py=(j+.5)*gy;
        const d=Math.hypot(Math.max(R.left-px,0,px-R.right),Math.max(R.top-py,0,py-R.bottom));
        if(d<pad){const u=1-d/pad,f=s*u*u*(3-2*u),i=j*cols+k;if(f>calm[i])calm[i]=f;}
      }
    }
  }
  function resize(){
    const r=container.getBoundingClientRect();box=r;
    const nW=Math.max(1,Math.round(r.width)),nH=Math.max(1,Math.round(r.height));
    const oW=W,oH=H;W=nW;H=nH;dpr=Math.min(devicePixelRatio||1,1.5);
    gx=W<640?6:7;gy=Math.round(gx*1.6);
    cols=Math.ceil(W/gx);rows=Math.ceil(H/gy);ax=Math.max(gx,Math.round(gx*dpr));ay=Math.max(gy,Math.round(gy*dpr));
    cv.width=cols*ax;cv.height=rows*ay;
    cv.style.width=cols*gx+'px';cv.style.height=rows*gy+'px';
    mk=document.createElement('canvas');mk.width=cols;mk.height=rows;
    mx=mk.getContext('2d',{willReadFrequently:true});
    const hr=mulberry(opts.seed*31+cols);hash=new Uint8Array(cols*rows);for(let i=0;i<hash.length;i++)hash[i]=hr()*256|0;
    buildAtlas();build(oW,oH);buildStatic();computeCalm();
    if(reduced()||!running)paint();
  }

  /* ---------- scene (units: CSS px) ---------- */
  function newWalker(L,x){
    const o={x,h:L.h*rnd(.88,1.08),dir:L.dir,ph:rnd(0,6.3),w:1,pause:0,next:rnd(4,26),wave:0,waveMe:false,
      band:rng()<.45,bp:rnd(0,6.3),I:L.I,
      dress:rng()<.4,wrap:rng()<.3,hat:rng()<.12,bag:rng()<.25,umb:rng()<.06,kid:rng()<.14,ball:rng()<.5};
    if(o.umb)o.kid=false;
    o.k=o.h/L.h;o.sp=o.h*.085*rnd(.85,1.15);o.spk=o.sp/o.h;
    return o;
  }
  function laneGeom(n,N,small){
    const z=(n+1)/N,h=H*(.075+(small?.24:.28)*Math.pow(z,1.5));
    return {z,h,y:hz+H*.03+(H*.965-hz-H*.03)*Math.pow(z,1.15),I:.55+.45*z};
  }
  function build(oW,oH){
    const small=W<640,N=small?4:5;
    hz=H*(small?.25:.3);
    if(lanes.length===N&&oW){ // keep the same crowd on resize (e.g. a phone's URL bar), just rescale it
      lanes.forEach((L,n)=>{const g=laneGeom(n,N,small);Object.assign(L,g);
        for(const o of L.ws){o.x*=W/oW;o.h=L.h*o.k;o.sp=o.h*o.spk;}
        // top up lanes that became wider
        let mxX=Math.max(...L.ws.map(o=>o.x));while(mxX<W){mxX+=L.h*rnd(.55,2.1);L.ws.push(newWalker(L,mxX));}});
    }else{
      rng=mulberry(opts.seed);lanes=[];
      for(let n=0;n<N;n++){
        const L=Object.assign(laneGeom(n,N,small),{dir:n%2?1:-1,ws:[]});
        let x=rnd(-L.h,L.h*.3);
        while(x<W+L.h){L.ws.push(newWalker(L,x));x+=L.h*rnd(.55,2.1);}
        lanes.push(L);
      }
    }
    const sr=mulberry(opts.seed+101),sn=(a,b)=>a+sr()*(b-a);
    houses=[];
    for(let x=sn(0,20);x<W;x+=sn(14,34)){if(sr()<.55){
      const hy=hz-18-24*(.5+.5*Math.sin(x*.0065+1.3))-11*Math.sin(x*.017+.4)-9*Math.sin(x*.0033);
      houses.push({x,y:hy+sn(4,14),w:sn(8,16),h:sn(6,12),I:sn(.22,.36),lit:sr()<.3});}}
    const fy=small?H*.11:H*.06;
    festoon=[{y:fy,sag:small?H*.05:H*.07,span:small?W*.55:W/3.2,gap:small?22:28,I:.85,ph:0,o:0},
             {y:fy+(small?H*.07:H*.1),sag:small?H*.03:H*.045,span:small?W*.4:W/4.6,gap:small?18:22,I:.55,ph:2,o:3}];
    const nt=Math.max(2,Math.round(W/260));tents=[];
    for(let i=0;i<nt;i++)tents.push({x:(i+.5)/nt*W+sn(-20,20),w:sn(90,140)*(small?.75:1),h:sn(32,46)*(small?.8:1),fl:sn(0,6)});
  }
  const RED=[],BLU=[];for(let i=0;i<256;i++){RED.push('rgb('+i+',0,0)');BLU.push('rgb(0,0,'+i+')');}
  const col=v=>RED[v>=1?255:v<=0?0:v*255|0];
  let LW=1;
  function seg(m,x1,y1,x2,y2,lw,I){m.strokeStyle=col(I);m.lineWidth=Math.max(lw,LW);m.beginPath();m.moveTo(x1,y1);m.lineTo(x2,y2);m.stroke();}
  function limb(m,x1,y1,a,len,b,lw,I){ // two-segment limb: angle a from vertical, bend b at the joint
    const jx=x1+Math.sin(a)*len/2,jy=y1+Math.cos(a)*len/2,ex=jx+Math.sin(a+b)*len/2,ey=jy+Math.cos(a+b)*len/2;
    m.strokeStyle=col(I);m.lineWidth=Math.max(lw,LW);m.beginPath();m.moveTo(x1,y1);m.lineTo(jx,jy);m.lineTo(ex,ey);m.stroke();
    return [ex,ey];
  }
  function disc(m,x,y,r,I,acc){m.fillStyle=acc?BLU[I>=1?255:I*255|0]:col(I);m.beginPath();m.arc(x,y,Math.max(r,LW*.6),0,6.283);m.fill();}

  function person(m,x,y,h,o,t,kid){
    const w=o.w,ph=o.ph*(kid?1.3:1)+(kid?1.2:0),s=Math.sin(ph),c=Math.cos(ph),f=o.dir,I=o.I*(kid?.92:1);
    const bob=Math.abs(c)*.016*h*w,yH=y-.48*h-bob,yS=y-.8*h-bob,yN=y-.905*h-bob;
    m.lineCap='round';m.lineJoin='round';
    m.fillStyle=col(.14*o.I);m.beginPath();m.ellipse(x,y+.005*h,.24*h,.03*h+2,0,0,6.283);m.fill();
    const L=.5*h,la=.36*w*s,lw=.085*h;
    limb(m,x,yH,-la*f,L,Math.max(0,c)*.5*w*f,lw,I*.6);
    limb(m,x,yH,la*f,L,Math.max(0,-c)*.5*w*f,lw,I*.8);
    m.fillStyle=col(I*.85);m.beginPath();
    m.moveTo(x-.12*h,yS+.01*h);m.quadraticCurveTo(x,yS-.03*h,x+.12*h,yS+.01*h);
    m.lineTo(x+.085*h,yH+.03*h);m.lineTo(x-.085*h,yH+.03*h);m.closePath();m.fill();
    if(o.dress&&!kid){const sw=.04*h*s*w;m.fillStyle=col(I*.72);m.beginPath();
      m.moveTo(x-.09*h,yH-.07*h);m.lineTo(x+.09*h,yH-.07*h);m.lineTo(x+.2*h+sw,y-.19*h);
      m.quadraticCurveTo(x+sw,y-.16*h,x-.2*h+sw,y-.19*h);m.closePath();m.fill();}
    seg(m,x,yS,x,yN,.05*h,I*.8);
    disc(m,x+f*.008*h,yN-.01*h,.082*h,I);
    if(o.wrap&&!kid){m.fillStyle=col(I*.8);m.beginPath();m.ellipse(x-f*.02*h,yN-.06*h,.088*h,.062*h,-f*.3,0,6.283);m.fill();}
    if(o.hat&&!kid){seg(m,x-.12*h,yN-.055*h,x+.12*h,yN-.055*h,.03*h,I*.85);m.fillStyle=col(I*.85);m.fillRect(x-.065*h,yN-.13*h,.13*h,.075*h);}
    const A=.37*h,aw=.06*h,sy=yS+.025*h;
    limb(m,x-f*.03*h,sy,-.4*w*s*f,A,-.25*f,aw,I*.5);
    let hand;
    if(o.umb&&!kid){const nx=x+f*.15*h,ny=yS-.1*h;seg(m,x+f*.04*h,sy,nx,ny,aw,I*.75);
      seg(m,nx,ny,nx,y-1.2*h,.025*h,I*.75);
      m.fillStyle=col(I*.9);m.beginPath();m.ellipse(nx,y-1.17*h,.42*h,.2*h,0,Math.PI,0);m.fill();
      m.globalCompositeOperation='source-over';m.fillStyle='#000';
      for(let q=0;q<4;q++){m.beginPath();m.ellipse(nx-.315*h+q*.21*h,y-1.17*h,.105*h,.035*h,0,0,Math.PI);m.fill();}
      m.globalCompositeOperation='lighter';
      disc(m,nx,y-1.38*h,.022*h,I);hand=[nx,ny];}
    else if(o.wave>.02){
      const up=Math.PI*.82+.28*Math.sin(t*3.2)*o.wave,base=.4*w*s,a=base+(up-base)*o.wave;
      hand=limb(m,x+f*.03*h,sy,a*f,A,-.3*o.wave*f,aw,I*.92);}
    else hand=limb(m,x+f*.03*h,sy,.4*w*s*f,A,.25*f,aw,I*.92);
    if(o.band&&!kid)disc(m,hand[0]-Math.sin(.4*w*s*f)*.04*h,hand[1]-.04*h,.035*h,.6+.4*Math.sin(t*1.1+o.bp),true);
    if(o.bag&&!kid){m.fillStyle=col(I*.6);m.fillRect(x-f*.15*h-.06*h,yH-.13*h,.12*h,.16*h);seg(m,x-f*.15*h,yH-.13*h,x+f*.05*h,yS+.02*h,.015*h,I*.5);}
  }
  // static scenery (hills, houses, tents) is drawn once per resize into its own mask layer
  function buildStatic(){
    const m=mx;m.setTransform(1,0,0,1,0,0);m.globalCompositeOperation='source-over';m.fillStyle='#000';m.fillRect(0,0,cols,rows);
    m.setTransform(1/gx,0,0,1/gy,0,0);m.globalCompositeOperation='lighter';LW=gx*.7;
    m.fillStyle=col(.17);m.beginPath();m.moveTo(0,hz);
    for(let x=0;x<=W+8;x+=8)m.lineTo(x,hz-18-24*(.5+.5*Math.sin(x*.0065+1.3))-11*Math.sin(x*.017+.4)-9*Math.sin(x*.0033));
    m.lineTo(W+8,hz);m.closePath();m.fill();
    for(const q of houses){m.fillStyle=col(q.I);m.fillRect(q.x,q.y-q.h,q.w,q.h);}
    m.fillStyle=col(.07);m.fillRect(0,hz,W,H*.03);
    for(const Tn of tents){
      const b=hz+4,top=b-Tn.h,px=Tn.x,py=top-Tn.w*.36;
      m.fillStyle=col(.34);m.fillRect(px-Tn.w/2,top,Tn.w,Tn.h);
      m.fillStyle=col(.56);m.beginPath();m.moveTo(px-Tn.w/2-8,top+3);m.lineTo(px,py);m.lineTo(px+Tn.w/2+8,top+3);m.closePath();m.fill();
      m.globalCompositeOperation='source-over';
      m.fillStyle=col(.08);m.beginPath();m.moveTo(px-Tn.w*.14,b);m.lineTo(px,top+5);m.lineTo(px+Tn.w*.14,b);m.closePath();m.fill();
      m.globalCompositeOperation='lighter';
      seg(m,px,py,px,py-30,LW,.6);
    }
    m.setTransform(1,0,0,1,0,0);m.globalCompositeOperation='source-over';
    st=m.getImageData(0,0,cols,rows);
  }
  // twinkling lights are queued by brightness level and filled in a few batched paths
  const BQ=[];for(let i=0;i<=8;i++)BQ.push([]);
  function bulb(x,y,r,I,acc){BQ[acc?8:Math.max(0,Math.min(7,Math.round(I*7)))].push(x,y,r);}
  function flushBulbs(m){
    for(let l=0;l<=8;l++){const q=BQ[l];if(!q.length)continue;
      m.fillStyle=l===8?BLU[230]:col(l/7);m.beginPath();
      for(let i=0;i<q.length;i+=3){const r=Math.max(q[i+2],LW*.6);m.moveTo(q[i]+r,q[i+1]);m.arc(q[i],q[i+1],r,0,6.283);}
      m.fill();q.length=0;}
  }
  function scene(m,t){
    LW=gx*.7;
    for(const q of houses)if(q.lit)bulb(q.x+q.w/2,q.y-q.h/2,gx*.5,.35+.35*Math.sin(t*.4+q.x),false);
    // festoon lights across the top
    for(const S of festoon){
      const n=Math.round(W/S.gap),sway=Math.sin(t*.35+S.ph)*2;
      const yAt=x=>{const u=(x%S.span)/S.span,b=Math.sin(u*Math.PI);return S.y+b*(S.sag+sway);};
      m.strokeStyle=col(S.I*.38);m.lineWidth=gy*.28;m.beginPath();
      for(let q=0;q<=n;q++){const x=q/n*W;q?m.lineTo(x,yAt(x)):m.moveTo(x,yAt(x));}
      m.stroke();
      m.strokeStyle=col(S.I*.5);m.lineWidth=Math.max(gx*.5,LW);m.beginPath();
      for(let q=0;q<=n;q++){const x=q/n*W+S.gap*.5,y=yAt(x),tw=.5+.5*Math.sin(t*(.5+(q%7)*.09)+q*1.7+S.ph);
        m.moveTo(x,y);m.lineTo(x,y+gy*.6);
        bulb(x,y+gy*1.2,gx*1.5,S.I*(.5+.5*tw),(q+S.o)%7===0);}
      m.stroke();
    }
    // tents, flags, lights between the peaks
    const peaks=[];
    for(const Tn of tents){
      const b=hz+4,top=b-Tn.h,px=Tn.x,py=top-Tn.w*.36;
      const fw=Math.sin(t*1.3+Tn.fl);
      m.fillStyle=col(.62);m.beginPath();m.moveTo(px,py-30);m.quadraticCurveTo(px+12,py-30+fw*4,px+24,py-26+fw*3);m.lineTo(px,py-19);m.closePath();m.fill();
      peaks.push([px,py]);
    }
    peaks.unshift([-40,peaks[0][1]+16]);peaks.push([W+40,peaks[peaks.length-1][1]+16]);
    let k=0;
    for(let i=0;i<peaks.length-1;i++){
      const [x1,y1]=peaks[i],[x2,y2]=peaks[i+1],n=Math.max(4,Math.round((x2-x1)/15));
      for(let q=1;q<n;q++,k++){
        const u=q/n,x=x1+(x2-x1)*u,y=y1+(y2-y1)*u+Math.sin(u*Math.PI)*(26+(x2-x1)*.06);
        bulb(x,y,gx*.75,.3+.6*(.5+.5*Math.sin(t*(.6+(k%5)*.13)+k*2.1)),k%5===0);
      }
    }
    flushBulbs(m);
    // the crowd, far lanes first
    for(const L of lanes){
      for(const o of L.ws){
        o.next-=dt;
        if(o.next<0){o.pause=rnd(3,8);o.next=rnd(14,40)+o.pause;o.waveMe=rng()<.5;}
        if(o.pause>0)o.pause-=dt;
        const near=Math.abs(ptr.x-o.x)<o.h*.3&&ptr.y<L.y&&ptr.y>L.y-o.h;
        const tw=o.pause>0||near?0:1;o.w+=(tw-o.w)*Math.min(1,dt*1.5);
        const wv=(o.pause>0&&o.waveMe)||near?1:0;o.wave+=(wv-o.wave)*Math.min(1,dt*2);
        o.x+=o.dir*o.sp*o.w*dt;o.ph+=o.w*dt*6.283*o.sp/(.7*o.h);
        if(o.dir>0&&o.x>W+o.h*.7){o.x=-o.h*rnd(.7,2);o.next=rnd(4,26);}
        if(o.dir<0&&o.x<-o.h*.7){o.x=W+o.h*rnd(.7,2);o.next=rnd(4,26);}
        if(o.x<-o.h*.75||o.x>W+o.h*.75)continue; // waiting off screen
        person(m,o.x,L.y,o.h,o,t,false);
        if(o.kid){const kx=o.x-o.dir*.3*o.h;person(m,kx,L.y,o.h*.56,o,t,true);
          if(o.ball){const bx=kx-o.dir*.08*o.h+Math.sin(t*.8+o.bp)*.04*o.h,by=L.y-o.h*1.02;
            seg(m,kx-o.dir*.02*o.h,L.y-o.h*.36,bx,by,gx*.45,.3*o.I);
            m.fillStyle=col(.85*o.I);m.beginPath();m.ellipse(bx,by-.08*o.h,.07*o.h,.085*o.h,0,0,6.283);m.fill();}}
      }
    }
  }

  /* ---------- glyph renderer: scene -> 1px-per-cell coverage mask -> one glyph per cell ---------- */
  function paint(){
    if(!cols)return;
    mx.setTransform(1,0,0,1,0,0);
    mx.putImageData(st,0,0);
    mx.setTransform(1/gx,0,0,1/gy,0,0);mx.globalCompositeOperation='lighter';
    const t0=performance.now();scene(mx,T);const t1=performance.now();
    mx.globalCompositeOperation='source-over';
    const d=mx.getImageData(0,0,cols,rows).data,t2=performance.now(),hzr=hz/gy,amax=opts.alpha,speck=amax*.14;
    cx.setTransform(1,0,0,1,0,0);
    // each cell gets a code (glyph, colour, opacity level); only cells whose code changed are redrawn
    if(!prev){prev=new Uint16Array(cols*rows).fill(65535);cx.clearRect(0,0,cv.width,cv.height);}
    drawn=0;changed=0;
    for(let j=0,i=0;j<rows;j++)for(let k=0;k<cols;k++,i++){
      const r=d[i*4],b=d[i*4+2],c=1-calm[i],acc=b>70&&b>r,v=(acc?b:r)/255;
      let code=0,g,al;
      if(v<.06){ // sparse ground texture
        if(hash[i]<4){g=hash[i]&3;al=speck*c*(j>hzr?1:.6);}
      }else{
        const bi=v<.2?0:v<.38?1:v<.58?2:v<.8?3:4,a0=BK[bi][0];g=a0+hash[i]%(BK[bi][1]-a0);
        al=amax*(.25+.75*Math.min(1,v))*c;if(acc)al=Math.min(1,al*1.5);
      }
      if(al){const lv=Math.min(NL-1,Math.round(al*NL));if(lv>0)code=1+g+GL.length*((acc?NL:0)+lv);}
      if(code)drawn++;
      if(code===prev[i])continue;
      prev[i]=code;changed++;
      cx.clearRect(k*ax,j*ay,ax,ay);
      if(code){const q=code-1,gg=q%GL.length,row=(q/GL.length)|0;cx.drawImage(atlas,gg*ax,row*ay,ax,ay,k*ax,j*ay,ax,ay);}
    }
    const t3=performance.now();PF[0]+=t1-t0;PF[1]+=t2-t1;PF[2]+=t3-t2;PF[3]++;
  }

  /* ---------- lifecycle ---------- */
  let cost=0; // smoothed paint time; in auto mode a slow device steps down to 10 then 8 fps
  /* SYNAN: a timer asks for each frame, so nothing runs between frames (an idle requestAnimationFrame
     loop made the browser prepare a frame on every screen refresh). The rest is the artist's code. */
  let tmr=0;
  function frame(now){
    raf=0;
    const fps=opts.fps||Math.min(W<640?12:15,cost>28?8:cost>16?10:15);
    const real=last?Math.min(.15,(now-last)/1000):1/fps;last=now;last=now;
    dt=real*opts.motion;T+=dt;
    const p0=performance.now();paint();cost=cost*.9+(performance.now()-p0)*.1;
    tmr=setTimeout(()=>{tmr=0;raf=requestAnimationFrame(frame);},1000/(opts.fps||Math.min(W<640?12:15,cost>28?8:cost>16?10:15)));
  }
  function loop(on){
    cancelAnimationFrame(raf);clearTimeout(tmr);raf=0;tmr=0;last=0;
    if(on&&!reduced()&&!document.hidden&&visible)raf=requestAnimationFrame(frame);
    else{dt=0;paint();}
  }
  function start(){running=true;loop(true);}
  function stop(){running=false;cancelAnimationFrame(raf);clearTimeout(tmr);raf=0;tmr=0;}
  const onVis=()=>{if(running)loop(true);};
  const onPtr=e=>{ptr.x=e.clientX-box.left;ptr.y=e.clientY-box.top;};
  const onLeave=()=>{ptr.x=ptr.y=-999;};
  let rzT=0;const ro=new ResizeObserver(()=>{clearTimeout(rzT);rzT=setTimeout(resize,100);});
  const io=new IntersectionObserver(es=>{visible=es[es.length-1].isIntersecting;if(running)loop(true);});
  ro.observe(container);io.observe(container);
  document.addEventListener('visibilitychange',onVis);
  if(RM.addEventListener)RM.addEventListener('change',onVis);
  if(opts.pointer){addEventListener('pointermove',onPtr,{passive:true});document.documentElement.addEventListener('pointerleave',onLeave);}
  resize();
  return {
    start,stop,resize,
    setTheme(t){Object.assign(opts,t);buildAtlas();if(!raf&&!tmr)paint();},
    setMotion(m){opts.motion=m;},
    setCalm(rects){calmRects=rects||[];computeCalm();if(!raf&&!tmr)paint();},
    destroy(){stop();ro.disconnect();io.disconnect();document.removeEventListener('visibilitychange',onVis);
      if(RM.removeEventListener)RM.removeEventListener('change',onVis);
      removeEventListener('pointermove',onPtr);document.documentElement.removeEventListener('pointerleave',onLeave);cv.remove();},
    get canvas(){return cv;},
    get stats(){return {cols,rows,cells:cols*rows,glyphsLastFrame:drawn,cellsRedrawnLastFrame:changed,canvasPx:[cv.width,cv.height],maskPx:[cols,rows],msScene:PF[0]/PF[3],msRead:PF[1]/PF[3],msDraw:PF[2]/PF[3],frames:PF[3],msPaintSmoothed:cost,fps:opts.fps||Math.min(W<640?12:15,cost>28?8:cost>16?10:15)};}
  };
}
