function cleanTrackTitleForLyrics(rawTitle) {
  if (!rawTitle) return '';
  const title = rawTitle
    .replace(
      /\s*[\(\[](?:official\s*(?:music\s*)?video|official\s*audio|official\s*mv|music\s*video|official\s*lyric\s*video|official\s*lyrics\s*video|lyric\s*video|lyrics\s*video|visualizer|audio|hd|4k(?:\s*remaster(?:ed)?)?)[^\)\]]*[\)\]]/gi,
      ''
    )
    .replace(
      /\s*[\(\[](?:(?:easy\s*)?lyrics?|color\s*coded(?:\s*lyrics?)?|with\s*lyrics?|lirik\s*(?:lagu)?|eng\s*sub(?:titles?)?|indo\s*sub|sub\s*(?:indo|eng|esp|spa)|terjemahan|lyrics?\/[^\)\]]+|han\/rom\/eng|han\/rom\/ina)[^\)\]]*[\)\]]/gi,
      ''
    )
    .replace(
      /\s*[\(\[](?:slowed\s*(?:\+|&|and)?\s*reverb|slowed|reverb|sped\s*up|speed\s*up(?:\s*version)?|tiktok(?:\s*version)?|viral\s*tiktok|nightcore|8d\s*audio|3d\s*audio|bass\s*boosted)[^\)\]]*[\)\]]/gi,
      ''
    )
    .replace(
      /\s*[\(\[](?:(?:\d{4}\s*)?remaster(?:ed)?(?:\s*\d{4})?|explicit|clean|studio|deluxe(?:\s*edition)?|bonus(?:\s*track)?|radio\s*edit|mono|stereo|ver|version|single|ep|acoustic|album\s*version|performance\s*video|special\s*clip|karaoke|instrumental|backing\s*track|minus\s*one|live(?:\s+at[^\)\]]*)?)[^\)\]]*[\)\]]/gi,
      ''
    )
    .replace(
      /\s*(?:\|\s*|\/\/\s*|\s-\s*)(?:(?:\d{4}\s*)?remaster(?:ed)?(?:\s*\d{4})?|deluxe(?:\s*edition)?|bonus(?:\s*track)?|official\s*(?:music\s*)?video|music\s*video|official\s*audio|mv|m\/v|(?:easy\s*)?lyrics?|color\s*coded(?:\s*lyrics?)?|lirik\s*(?:lagu)?|audio|terjemahan|live(?:\s+at[^-–—|]+)?).*$/gi,
      ''
    )
    .replace(/\s+\b(?:m\/v|mv)\b$/gi, '')
    .replace(/\s*[\(\[](?:feat|ft|featuring|with)\b[^\)\]]*[\)\]]/gi, '')
    .replace(/\s*\b(?:feat|ft|featuring|with)\b.*$/gi, '')
    .replace(/\s*\[[^\]]*(?:mv|video|audio|4k|hd|clip|live|lyric|sub|ver|remaster)[^\]]*\]/gi, '')
    .replace(/\s*\([^)]*(?:mv|video|audio|4k|hd|clip|live|lyric|sub|ver|remaster)[^)]*\)/gi, '')
    .replace(/^[「『](.+)[」』]$/g, '$1')
    .replace(/^[“"'](.+)["”']$/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();

  return title || rawTitle.trim();
}

const tests = [
  ['Hotel California - 2013 Remaster', 'Hotel California'],
  ['Bohemian Rhapsody - Remastered 2011', 'Bohemian Rhapsody'],
  ['Starboy (feat. Daft Punk)', 'Starboy'],
  ['In The End [Official Music Video]', 'In The End'],
  ['Creep - Live at Reading', 'Creep'],
  ['Smells Like Teen Spirit (Remastered)', 'Smells Like Teen Spirit'],
  ['Fix You (Deluxe Edition)', 'Fix You']
];

let allPassed = true;
for (const [input, expected] of tests) {
  const res = cleanTrackTitleForLyrics(input);
  const pass = res === expected;
  if (!pass) allPassed = false;
  console.log(pass ? '✓ PASS:' : '✗ FAIL:', input, '=>', res, pass ? '' : `(Expected: ${expected})`);
}

if (allPassed) {
  console.log('\nAll title clean tests passed successfully!');
} else {
  process.exit(1);
}
