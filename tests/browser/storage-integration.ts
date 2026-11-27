import { createFireMonkeyStorageAdapter } from '../../src/userscript/firemonkey-storage';
import { createHistoryLibrary } from '../../src/domain/history-library';

void (async () => {
  const storageA = createFireMonkeyStorageAdapter();
  const storageB = createFireMonkeyStorageAdapter();
  const order: string[] = [];
  await Promise.all([
    storageA.withExclusiveLock!(async () => {
      order.push('A entered');
      await new Promise(resolve => setTimeout(resolve, 100));
      order.push('A finished');
    }),
    storageB.withExclusiveLock!(async () => { order.push('B entered'); })
  ]);
  if (order.join(',') !== 'A entered,A finished,B entered') throw Error('Lock released early: ' + order);
  let propagated = false;
  try { await storageA.withExclusiveLock!(() => { throw Error('expected failure'); }); }
  catch (error) { propagated = String(error).includes('expected failure'); }
  if (!propagated) throw Error('Failure not propagated');
  const a = createHistoryLibrary(storageA);
  const b = createHistoryLibrary(storageB);
  const observation = (videoId: string) => ({videoId,title:videoId,accountId:'test',watchedAt:1700000000000,source:'live' as const,timestampPrecision:'exact' as const});
  await Promise.all([a.recordWatches([observation('one')]), b.recordWatches([observation('two')])]);
  await a.load();
  if (a.search('').totalMatches !== 2) throw Error('Lost watch');
  document.body.textContent = 'DONE: lock held through async work; error propagated; later lock acquired; both concurrent watches persisted through GM storage';
})().catch(error => { document.body.textContent = 'DONE: FAILED: ' + error; });
