/* In-page confirmation. Browser pop-ups can be blocked silently, and a blocked one reads as "Cancel". */
(()=>{
 'use strict';
 if(typeof document==='undefined')return;
 let open=null;
 window.ValeAsk=function(message,{confirmLabel='Continue',cancelLabel='Cancel',danger=false}={}){
  if(typeof HTMLDialogElement!=='function')return Promise.resolve(window.confirm(message));
  if(open)open(false);
  const dialog=document.createElement('dialog');dialog.className='ask';
  const text=document.createElement('p');text.textContent=message;
  const row=document.createElement('div');row.className='actions two';
  const no=document.createElement('button');no.type='button';no.className='btn';no.textContent=cancelLabel;
  const yes=document.createElement('button');yes.type='button';yes.className=danger?'btn danger':'btn primary';yes.textContent=confirmLabel;
  row.append(no,yes);dialog.append(text,row);document.body.append(dialog);
  return new Promise(resolve=>{
   const finish=value=>{if(!dialog.isConnected)return;open=null;dialog.close();dialog.remove();resolve(value)};
   open=finish;no.onclick=()=>finish(false);yes.onclick=()=>finish(true);dialog.addEventListener('cancel',e=>{e.preventDefault();finish(false)});
   dialog.showModal();no.focus();
  });
 };
})();
