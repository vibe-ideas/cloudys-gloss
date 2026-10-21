// A deterministic reading-view fixture, not a captured/logged-in X page.
// Models Draft.js blocks and a host ResizeObserver-driven virtual timeline.
export const xArticleFixture = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>X article layout fixture</title>
<style>
*{box-sizing:border-box}body{margin:0;background:#000;color:#e7e9ea;font:19px/1.55 system-ui}main{max-width:720px;margin:auto;border-inline:1px solid #303336;padding:20px}#timeline{position:relative} .cell{position:absolute;top:0;left:0;width:100%} .article{padding:8px 12px 24px}#title{display:block;font-size:36px;font-weight:750;line-height:1.2;margin:16px 0 30px} [data-block]{margin:22px 0}a{color:#61b5ef}blockquote{margin:24px 0;padding:16px;border:1px solid #303336;border-radius:14px}#next{padding:24px;background:#17191b}.overlay-stage{position:relative;height:110px;margin-top:32px}.overlay{position:absolute;top:4px;width:230px;height:36px}#overlay-two{top:60px}#late{margin-top:1100px}
</style></head><body><main><div id="timeline"><div id="article-cell" class="cell" data-testid="cellInnerDiv"><div class="article">
<span id="title" data-testid="twitter-article-title">The Complete Guide to pstack Pt. 2</span>
<div data-testid="twitterArticleReadView"><div data-testid="longformRichTextComponent" contenteditable="false">
<div data-block="true"><div id="intro"><span>In my last post, I showed you why <strong>verification</strong> is the foundation of everything I do with agents, and how to get started creating your own verification skills.</span></div></div>
<div data-block="true"><div id="lesson"><span>The key lesson was that if an agent cannot verify its own work, nothing else matters. Read <a href="#late">the next chapter</a> to learn more.</span></div></div>
<blockquote><div id="quote" data-testid="tweetText"><span>I am writing a guide to pstack! Here is part one.</span></div></blockquote>
<div class="overlay-stage"><div id="overlay-one" class="overlay">Fixed overlay label.</div><div id="overlay-two" class="overlay">Another overlay label.</div></div>
<div id="late"></div></div></div></div></div><div id="next" class="cell" data-testid="cellInnerDiv"><p>这是文章后面的评论，不应该被译文盖住。</p></div></div></main>
<script>
const row=document.querySelector('#article-cell'), next=document.querySelector('#next'), timeline=document.querySelector('#timeline');
new ResizeObserver(()=>{next.style.transform='translateY('+row.offsetHeight+'px)';timeline.style.height=(row.offsetHeight+next.offsetHeight)+'px';}).observe(row);
</script></body></html>`;
