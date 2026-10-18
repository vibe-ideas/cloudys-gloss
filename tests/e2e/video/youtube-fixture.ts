/** Owned player fixture on a routed YouTube origin: exercises the production
 * content script + page-world bridge without depending on public video access. */
export const youtubeFixture = `<!doctype html><html dark><head><meta charset="utf-8"><title>Subtitle player fixture</title><style>
body{margin:30px;background:#111;color:#eee;font:16px system-ui}.html5-video-player{position:relative;width:900px;height:506px;background:linear-gradient(140deg,#27362f,#111b17);max-width:100%}video{width:100%;height:100%}.ytp-right-controls{position:absolute;bottom:0;right:10px;height:48px;z-index:70}.ytp-button{height:48px;border:0;background:transparent;color:white;cursor:pointer}.ytp-caption-window-container{position:absolute;bottom:80px;text-align:center;width:100%}.ytp-caption-segment{background:#0009}h1{font-size:24px}button{font:inherit}
</style></head><body><h1>Building software across languages</h1><div id="movie_player" class="html5-video-player"><video preload="auto" src="/timeline.webm"></video><div class="ytp-caption-window-container"><span class="ytp-caption-segment"></span></div><div class="ytp-right-controls"><button class="ytp-subtitles-button ytp-button" aria-pressed="false">CC</button><button class="ytp-button" id="fullscreen">全屏</button></div></div><p>Owned test player · Native subtitles and Cloudy’s Gloss share the playback clock.</p><script>
const player = document.getElementById('movie_player');
const video = player.querySelector('video');
window.setClock = value => { video.currentTime = value; };
window.advanceClock = value => { video.currentTime = value; };
player.getPlayerResponse = () => ({ videoDetails: { videoId: new URL(location.href).searchParams.get('v') }, captions: { playerCaptionsTracklistRenderer: { captionTracks: [{ baseUrl: 'https://www.youtube.com/api/timedtext?v=' + new URL(location.href).searchParams.get('v') + '&lang=en', languageCode: 'en' }] } } });
const cc = player.querySelector('.ytp-subtitles-button');
cc.onclick = () => {
  const on = cc.getAttribute('aria-pressed') !== 'true'; cc.setAttribute('aria-pressed', String(on));
  player.querySelector('.ytp-caption-segment').textContent = on ? 'Welcome to the video.' : '';
  if (on) fetch(player.getPlayerResponse().captions.playerCaptionsTracklistRenderer.captionTracks[0].baseUrl + '&fmt=json3&pot=fixture');
};
document.getElementById('fullscreen').onclick = () => player.requestFullscreen();
</script></body></html>`;
export const subtitleTrack = JSON.stringify({ events: Array.from({ length: 1000 }, (_, i) => ({ tStartMs: i * 5000, dDurationMs: 5000, segs: [{ utf8: i === 0 ? 'Welcome to the video.' : 'Sentence ' + i + '.' }] })) });

/** Desktop watch layout with a real right recommendation column. */
export const youtubeColumnFixture = youtubeFixture
  .replace('<div id="movie_player"', '<ytd-watch-flexy><div id="columns"><div id="primary"><div id="movie_player"')
  .replace('</div><p>Owned test player', '</div></div><aside id="secondary"><p>Recommendations</p></aside></div></ytd-watch-flexy><p>Owned test player')
  .replace('</style>', `
#columns{display:grid;grid-template-columns:minmax(0,1fr) 300px;gap:24px;max-width:1440px}#primary,#secondary{min-width:0}
.html5-video-player{width:100%;height:auto;aspect-ratio:16/9}.html5-video-player:fullscreen{width:100vw;height:100vh}
ytd-watch-flexy[theater] #columns{display:block}ytd-watch-flexy[theater] #secondary{display:none}
@media(max-width:800px){#columns{display:block}#secondary{display:none}}
</style>`);
