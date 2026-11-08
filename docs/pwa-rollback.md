# Development PWA rollback

Build 9 retires the worker at the former /vale-connect-dev/ path automatically. This procedure applies to retiring a worker at the current development address. Target only valebrandworks/vale-connect-dev and its sw.js. No production, database, card or browser localStorage deletion.

If an installed PWA release must be retired, first deploy a retirement worker at the same sw.js URL rather than just removing the registration script. Keep installable metadata/icons available until retirement is verified. This worker deliberately activates but does not navigate or reload open clients:

```javascript
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('vale-connect-dev-pwa-')) await caches.delete(key);
    }
    await self.registration.unregister();
  })());
});
```

It has no fetch interception and removes only static development PWA caches. Do not enumerate/unregister other app registrations. Do not clear localStorage, IndexedDB or authentication state.

Verify that new development navigations use the network and the retirement worker activates. Existing open tabs may need to be closed/reopened; save edits first. Revert the PWA UI/metadata source through a normal development history-preserving revert as appropriate. Removal of an installed OS shortcut is a separate user action, not performed automatically. No rollback worker has been deployed by this feature.

