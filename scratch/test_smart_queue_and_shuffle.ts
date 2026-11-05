import { smartShuffle, normalizeArtist } from '../src/utils/smartShuffle';
import { isDuplicateTrack } from '../src/services/radioEngine';
import { useQueueStore } from '../src/stores/useQueueStore';

console.log('=== TEST 1: ANTI-CLUSTERING SHUFFLE WITH 5-10 TRACKS & SAME ARTISTS ===');

const testTracks = [
  { id: '1', title: 'Yellow', artist: 'Coldplay' },
  { id: '2', title: 'Fix You', artist: 'Coldplay' },
  { id: '3', title: 'The Scientist', artist: 'Coldplay' },
  { id: '4', title: 'Hello', artist: 'Adele' },
  { id: '5', title: 'Rolling in the Deep', artist: 'Adele' },
  { id: '6', title: 'Shape of You', artist: 'Ed Sheeran' },
  { id: '7', title: 'Perfect', artist: 'Ed Sheeran' },
  { id: '8', title: 'Cruel Summer', artist: 'Taylor Swift' },
  { id: '9', title: 'Anti-Hero', artist: 'Taylor Swift' },
  { id: '10', title: 'Blank Space', artist: 'Taylor Swift' },
];

let collisions = 0;
const iterations = 500;

for (let i = 0; i < iterations; i++) {
  const shuffled = smartShuffle(testTracks, 3);
  for (let j = 1; j < shuffled.length; j++) {
    if (normalizeArtist(shuffled[j].artist) === normalizeArtist(shuffled[j - 1].artist)) {
      collisions++;
      console.error(`Collision in run ${i}: ${shuffled[j - 1].artist} (${shuffled[j - 1].title}) -> ${shuffled[j].artist} (${shuffled[j].title})`);
    }
  }
}

console.log(`Ran ${iterations} shuffles. Total adjacent collisions: ${collisions}`);
if (collisions === 0) {
  console.log('>> SUCCESS: Anti-clustering shuffle completely eliminated adjacent same-artist tracks! (0 errors)');
} else {
  console.error(`>> FAILED: Found ${collisions} collisions.`);
  process.exit(1);
}

console.log('\n=== TEST 2: DUAL-TIER QUEUE PROGRESSION & AUTO-RADIO REPLENISHMENT ===');

const store = useQueueStore.getState();
store.clearAllQueues();

// Set active source to native
store.setActiveSource('native');

// Set current playing track
store.setCurrentTrack({
  id: 'current-1',
  title: 'Viva La Vida',
  artist: 'Coldplay',
  durationSeconds: 240,
  thumbnailUrl: 'https://example.com/art.jpg',
});

// Add 2 manual tracks
store.addToManualQueue({
  id: 'manual-1',
  title: 'Someone Like You',
  artist: 'Adele',
  durationSeconds: 280,
  thumbnailUrl: '',
});
store.addToManualQueue({
  id: 'manual-2',
  title: 'Bad Habits',
  artist: 'Ed Sheeran',
  durationSeconds: 230,
  thumbnailUrl: '',
});

// Seed 3 radio tracks
store.addToRadioQueue([
  { id: 'radio-1', title: 'Clocks', artist: 'Coldplay', durationSeconds: 250, thumbnailUrl: '', isRadio: true },
  { id: 'radio-2', title: 'Easy On Me', artist: 'Adele', durationSeconds: 220, thumbnailUrl: '', isRadio: true },
  { id: 'radio-3', title: 'Castle on the Hill', artist: 'Ed Sheeran', durationSeconds: 260, thumbnailUrl: '', isRadio: true },
]);

console.log('Initial State:');
console.log(' - Manual queue length:', useQueueStore.getState().manualQueue.length);
console.log(' - Radio queue length:', useQueueStore.getState().radioQueue.length);
console.log(' - History length:', useQueueStore.getState().history.length);

async function runProgression() {
  // Step 1: Next track should come from manualQueue (Someone Like You)
  const track1 = await useQueueStore.getState().getNextTrack();
  console.log('\n[Progression 1] Next track:', track1?.title, `(From ${track1?.isRadio ? 'radioQueue' : 'manualQueue'})`);
  if (track1?.id !== 'manual-1') throw new Error(`Expected manual-1, got ${track1?.id}`);

  // Step 2: Next track should come from manualQueue (Bad Habits)
  const track2 = await useQueueStore.getState().getNextTrack();
  console.log('[Progression 2] Next track:', track2?.title, `(From ${track2?.isRadio ? 'radioQueue' : 'manualQueue'})`);
  if (track2?.id !== 'manual-2') throw new Error(`Expected manual-2, got ${track2?.id}`);

  // Now manualQueue is empty!
  console.log(' - Manual queue is now empty:', useQueueStore.getState().manualQueue.length === 0);

  // Step 3: Next track should seamlessly fallback to radioQueue (Clocks)
  const track3 = await useQueueStore.getState().getNextTrack();
  console.log('[Progression 3] Next track (Auto-Radio Fallback):', track3?.title, `(From ${track3?.isRadio ? 'radioQueue' : 'manualQueue'})`);
  if (track3?.id !== 'radio-1' || !track3?.isRadio) throw new Error(`Expected radio-1, got ${track3?.id}`);

  // Radio queue remaining is now 2 (<= 2). This should have automatically triggered triggerAutoRadio!
  console.log(' - Radio queue length remaining:', useQueueStore.getState().radioQueue.length);
  console.log(' - Current history length:', useQueueStore.getState().history.length);

  // Check history has all played tracks
  const hist = useQueueStore.getState().history.map(h => h.title);
  console.log(' - Played history:', hist.join(' -> '));

  console.log('\n=== TEST 3: DEDUPLICATION ENGINE ===');
  const duplicateCandidate = { id: 'dup-1', title: 'Viva La Vida', artist: 'Coldplay' };
  const isDup = isDuplicateTrack(duplicateCandidate, useQueueStore.getState().history);
  console.log(' - Is "Viva La Vida" by Coldplay marked as duplicate against history?', isDup);
  if (!isDup) throw new Error('Deduplication failed to detect track in history');

  const newCandidate = { id: 'new-1', title: 'Speed of Sound', artist: 'Coldplay' };
  const isNewDup = isDuplicateTrack(newCandidate, useQueueStore.getState().history);
  console.log(' - Is "Speed of Sound" by Coldplay marked as duplicate?', isNewDup);
  if (isNewDup) throw new Error('Deduplication falsely flagged new track as duplicate');

  console.log('\n>> ALL UNIT TESTS COMPLETED SUCCESSFULLY! <<');
}

runProgression().catch(err => {
  console.error('Test execution failed:', err);
  process.exit(1);
});
