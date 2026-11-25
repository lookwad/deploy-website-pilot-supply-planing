/* Supabase Auth and private planning snapshots. Never place service keys here. */
(() => {
  'use strict';
  const host = document.getElementById('loginCard');
  const config = window.SUPPLY_CONFIG;
  if (!config || !window.supabase) {
    host.textContent = 'โหลดระบบเข้าสู่ระบบไม่สำเร็จ กรุณารีเฟรชหน้า';
    return;
  }
  const client = window.supabase.createClient(config.url, config.key);
  let activeUser = null, revision = 0, busy = false, ready = false, dirty = false;
  let sessionUserId = null;
  const status = document.createElement('div');
  status.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:9999;background:#fff;padding:10px 14px;border:1px solid #ccd2df;border-radius:12px;box-shadow:0 3px 12px #0002;display:none;font:14px Anuphan,sans-serif';
  const statusText = document.createElement('span');
  const saveButton = document.createElement('button');
  saveButton.className = 'btn primary';
  saveButton.style.marginLeft = '10px';
  saveButton.textContent = 'บันทึกแผนของฉัน';
  saveButton.onclick = () => savePlan();
  status.append(statusText, saveButton);
  document.body.append(status);

  function message(text) {
    const el = document.getElementById('cloudMessage');
    if (el) el.textContent = text;
  }
  function decode(payload) {
    return JSON.parse(pako.inflate(Uint8Array.from(atob(payload), c => c.charCodeAt(0)), {to:'string'}));
  }
  function encode(value) {
    const bytes = pako.gzip(JSON.stringify(value));
    let binary = '';
    for (let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
  }
  function renderLogin() {
    document.body.classList.add('pre-login');
    host.innerHTML = `<div class="login-hd"><span class="login-title">AI Balance Supply</span></div>
      <p class="login-sub">เข้าสู่ระบบด้วยอีเมลที่ผู้ดูแลอนุญาต</p>
      <form id="cloudLogin">
      <div class="login-field"><label for="cloudEmail">อีเมล</label><input id="cloudEmail" type="email" autocomplete="username" required></div>
      <div class="login-field"><label for="cloudPassword">รหัสผ่าน</label><input id="cloudPassword" type="password" autocomplete="current-password" minlength="8" required></div>
      <button class="btn primary" type="submit" style="width:100%;justify-content:center">เข้าสู่ระบบ</button>
      <button class="btn" id="cloudSignup" type="button" style="width:100%;justify-content:center;margin-top:10px">สร้างบัญชีครั้งแรก</button>
      </form><p id="cloudMessage" role="status" style="white-space:pre-wrap;margin-top:14px"></p>`;
    document.getElementById('cloudLogin').onsubmit = event => {event.preventDefault(); authenticate(false);};
    document.getElementById('cloudSignup').onclick = () => authenticate(true);
  }
  async function authenticate(signup) {
    const form = document.getElementById('cloudLogin');
    if (!form.reportValidity() || busy) return;
    busy = true;
    const email = document.getElementById('cloudEmail').value.trim().toLowerCase();
    const password = document.getElementById('cloudPassword').value;
    message('กำลังดำเนินการ…');
    try {
      const {data,error} = signup
        ? await client.auth.signUp({email,password,options:{emailRedirectTo:location.origin}})
        : await client.auth.signInWithPassword({email,password});
      if (error) throw error;
      if (signup && !data.session) message('สร้างบัญชีแล้ว กรุณายืนยันอีเมล จากนั้นกลับมาหน้านี้เพื่อเข้าสู่ระบบ');
      else await openApp(data.session);
    } catch(error) {message(error.message || 'เข้าสู่ระบบไม่สำเร็จ');}
    finally {busy=false;}
  }
  async function openApp(session) {
    if (!session || ready) return;
    message('กำลังโหลดข้อมูลแผน…');
    try {
      const {data:member,error:memberError} = await client.from('supply_members').select('display_name,role,factory').eq('email',session.user.email.toLowerCase()).maybeSingle();
      if (memberError) throw memberError;
      if (!member) throw new Error('บัญชีนี้ยังไม่ได้รับสิทธิ์ กรุณาติดต่อผู้ดูแลระบบ');
      const [baseline, master, plan] = await Promise.all([
        client.from('supply_datasets').select('payload_gzip,name').eq('id','baseline').single(),
        client.from('supply_datasets').select('payload_gzip').eq('id','master').single(),
        client.from('supply_plans').select('payload_gzip,revision').eq('owner_id',session.user.id).maybeSingle()
      ]);
      if (baseline.error) throw baseline.error;
      if (master.error) throw master.error;
      if (plan.error) throw plan.error;
      window.IW.loadFactoryMaster(decode(master.data.payload_gzip));
      EMBEDDED_DATA = decode(baseline.data.payload_gzip);
      buildModel();
      if (plan.data) {
        const saved = decode(plan.data.payload_gzip);
        if (saved.version !== 1) throw new Error('ไม่รองรับรุ่นของแผนที่บันทึก');
        model = saved.model;
        overrides = saved.overrides || {};
        headsReqs = saved.headsReqs || [];
        customRoutes = saved.customRoutes || [];
        crSeq = saved.crSeq || 1;
        simOverrides = saved.simOverrides || {};
        window.IW.importCloudState(saved.inputs);
        revision = plan.data.revision;
      }
      activeUser = session.user;
      sessionUserId = session.user.id;
      if (member.role === 'planner' && member.factory) {
        moFacSel = member.factory;
        loginFactory = member.factory;
        prodDailyMode = 'mine';
      }
      window.IW.applyRole(member.role);
      window.IW.resetToday();
      window.IW.resetLanding();
      // Roles come from the database, never from the demo role chooser.
      document.querySelectorAll('#iwRoleSwitch').forEach(el => el.style.display='none');
      renderAll();
      window.IW.go('iwOverview');
      document.body.classList.remove('pre-login');
      const badge = document.getElementById('loginBadge');
      if (badge) badge.style.display='inline-flex';
      const badgeText = document.getElementById('loginBadgeTx');
      if (badgeText) badgeText.textContent = member.display_name;
      const fileName = document.getElementById('fname');
      if (fileName) fileName.textContent=baseline.data.name;
      ready = true;
      status.style.display='block';
      statusText.textContent=plan.data?'โหลดแผนส่วนตัวแล้ว':'แผนตั้งต้น · ยังไม่บันทึกแผนส่วนตัว';
      host.replaceChildren();
    } catch(error) {
      message('โหลดแผนไม่สำเร็จ: '+error.message);
      ready = false;
      await client.auth.signOut({scope:'local'});
    }
  }
  async function savePlan() {
    if (!ready || busy || !activeUser) return;
    busy=true;
    saveButton.disabled=true;
    statusText.textContent='กำลังบันทึก…';
    try {
      const payload=encode({version:1,model,overrides,headsReqs,customRoutes,crSeq,simOverrides,inputs:window.IW.exportCloudState()});
      const {data,error}=await client.rpc('save_supply_plan',{payload,expected_revision:revision});
      if(error)throw error;
      revision=data;
      dirty=false;
      statusText.textContent='บันทึกแผนส่วนตัวแล้ว '+new Date().toLocaleTimeString('th-TH');
    } catch(error) {
      statusText.textContent=error.message.includes('PLAN_CONFLICT')?'มีแผนใหม่จากอีกหน้าต่าง กรุณารีเฟรชก่อนบันทึก':'บันทึกไม่สำเร็จ กรุณาลองอีกครั้ง';
      dirty=true;
    } finally {busy=false;saveButton.disabled=false;}
  }
  window.doLogout=async () => {
    if(dirty && !confirm('มีการเปลี่ยนแปลงที่ยังไม่บันทึก ต้องการออกจากระบบหรือไม่?'))return;
    ready=false;dirty=false;
    await client.auth.signOut({scope:'local'});
    location.reload();
  };
  document.addEventListener('change',()=>{if(ready){dirty=true;statusText.textContent='มีการเปลี่ยนแปลง · กดบันทึกแผนของฉัน';}});
  document.addEventListener('click',event=>{
    if(ready && !status.contains(event.target))dirty=true;
  });
  window.addEventListener('beforeunload',event=>{if(dirty){event.preventDefault();event.returnValue='';}});
  client.auth.onAuthStateChange((event,session)=>{
    if(ready && (!session || session.user.id!==sessionUserId)) {ready=false;dirty=false;location.reload();}
  });
  renderLogin();
  client.auth.getSession().then(({data,error})=>{
    if(error)message(error.message);
    else if(data.session)openApp(data.session);
  });
})();
