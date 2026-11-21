/* The report page (report.html): loads the reported card's public name through the public lookup. Moved out of the
   page so the content security policy can forbid inline scripts. */
(async()=>{'use strict';
const $=id=>document.getElementById(id);
// This web address's project (config.js). Any other address loads nothing.
const ENV=window.ValeConfig?.forHost(location.hostname)||null;
if(!ENV){$('status').textContent='This isn’t a VALE Connect address.';return}
const slug=new URLSearchParams(location.search).get('u')||'';
if(!window.ValeReportCore?.slugOk(slug)){$('status').textContent='This card link isn’t valid.';return}
if(!window.supabase){$('status').textContent='This page can’t load right now. Try again later.';return}
// The card is read only through the public lookup, which returns published cards and their public fields only.
const client=window.supabase.createClient(ENV.supabaseUrl,ENV.publishableKey,{auth:{persistSession:false,autoRefreshToken:false}});
try{
 const {data:found,error}=await client.rpc('get_public_card',{card_slug:slug});
 if(error)throw error;
 const card=found?.[0]||null;
 if(!card){$('status').textContent='This card is not available.';return}
 window.ValeReport.mount('report',{slug,card:{display_name:card.display_name}});
 $('status').hidden=true;$('report').hidden=false;
}catch(e){$('status').textContent='This page can’t load right now. Try again later.';console.error('Report page load failed',e)}
})();
