/* The public card page (p.html): loads one published card through the public lookup. Moved out of the page so the
   content security policy can forbid inline scripts. */
(async()=>{'use strict';
const $=id=>document.getElementById(id);
// This web address's project (config.js). Any other address loads nothing.
const ENV=window.ValeConfig?.forHost(location.hostname)||null;
if(!ENV){$('status').textContent='This isn’t a VALE Connect address.';return}
const slug=new URLSearchParams(location.search).get('u')||'';
if(!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)||slug.length<3||slug.length>60){$('status').textContent='This card link isn’t valid.';return}
if(!window.supabase){$('status').textContent='This card can’t load right now. Try again later.';return}
const client=window.supabase.createClient(ENV.supabaseUrl,ENV.publishableKey);
client.auth.getUser().then(({data})=>window.dispatchEvent(new CustomEvent('vale-account-ready',{detail:{client,user:data?.user||null}}))).catch(()=>{});
client.auth.onAuthStateChange((_event,session)=>window.dispatchEvent(new CustomEvent('vale-account-ready',{detail:{client,user:session?.user||null}})));
try{
 const {data:found,error}=await client.rpc('get_public_card',{card_slug:slug});
 if(error)throw error;
 const data=found?.[0]||null;
 if(!data){$('status').textContent='This card is not available.';return}
 const values=window.ValeCardTools.toEditor(data),images=window.ValeCardImages;
 const shown={photoUrl:null,logoUrl:null};
 const draw=()=>$('card').replaceChildren(window.ValeCardView.render(values,{preset:data.appearance,...shown}));
 draw();
 // Images are private storage: a visitor can download them only while this card is published.
 for(const [key,path] of [['photoUrl',data.photo_path],['logoUrl',data.logo_path]])if(path&&images)images.objectUrl(client,path).then(url=>{if(url){shown[key]=url;draw()}}).catch(()=>{});
 $('save-contact').onclick=async()=>{let photo='';if(data.photo_path&&images){try{photo=await images.contactPhoto(await images.blobOf(client,data.photo_path))}catch{}}const url=URL.createObjectURL(new Blob([window.ValeCardTools.vcard(values,photo)],{type:'text/vcard;charset=utf-8'}));const a=document.createElement('a');a.href=url;a.download=slug+'.vcf';document.body.append(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),2000)};
 // Sharing back is offered only if the owner allows it; the server checks this again.
 window.ValeShareBack?.mount('shareBack',{card:{id:data.id,display_name:data.display_name,accept_shares:data.accept_shares===true},slug});
 window.ValeCloudSave?.mount('publicCloudSave',values,{cardId:data.id,url:location.href});
 // A discreet way to report the card, shown only for a card that loaded (published cards only).
 $('report-link').href='report.html?u='+encodeURIComponent(slug);$('report-link-wrap').hidden=false;
 $('status').hidden=true;$('profile').hidden=false;document.title=data.display_name+' · VALE Connect';
}catch(e){$('status').textContent='This card can’t load right now. Try again later.';console.error('Public card load failed',e)}
})();
