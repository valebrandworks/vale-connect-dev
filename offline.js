/* The offline screen's "Try again" button. In a file so the content security policy can forbid inline scripts. */
document.getElementById('retry')?.addEventListener('click',()=>location.reload());
